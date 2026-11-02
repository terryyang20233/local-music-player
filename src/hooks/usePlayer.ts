import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { coverUrl, streamUrl } from "../api";
import { loadSession, replayGainFactor, saveSession } from "../audio";
import { buildQueue, buildUpcoming, pushId, sameIdSet, shuffleIds, stepInQueue } from "../queue";
import type { ListenReport, PlayMode, RecommendItem, Track, UpcomingItem } from "../types";
import { useShortcuts } from "./useShortcuts";

const UPCOMING_COUNT = 8;
const RECENT_LIMIT = 12;
const HISTORY_LIMIT = 40;
/** 两次 timeupdate 之间超过这个跨度视为拖动进度条，不计入实际收听时长。 */
const MAX_PLAY_DELTA = 1.5;

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const MODE_KEY = "changji.mode";
const RATE_KEY = "changji.rate";
const VOLUME_KEY = "changji.volume";
const RG_KEY = "changji.replaygain";
/** 连续这么多首播放失败就停下，避免整个队列都坏掉时无限跳歌。 */
const MAX_ERROR_STREAK = 3;
/** 播放中每隔这么多秒保存一次进度，用于下次打开时恢复。 */
const SAVE_EVERY_SECONDS = 5;

function loadNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 一首歌的收听会话。started 表示真正开始播放过；没播放过的不上报。 */
type Session = { trackId: string | null; listened: number; lastPos: number; started: boolean };

const emptySession = (): Session => ({ trackId: null, listened: 0, lastPos: 0, started: false });
const newSession = (trackId: string, lastPos = 0): Session => ({ trackId, listened: 0, lastPos, started: false });

export type PlayOptions = {
  autoplay?: boolean;
  /** 从哪个列表点播；之后的上一首 / 下一首都在这个列表里走。 */
  context?: Track[];
  /** 由"上一首"回到历史曲目时为 true，此时不把当前曲目压回历史。 */
  fromHistory?: boolean;
};

type PlayerOptions = {
  onListen?: (report: ListenReport) => void;
  pickSmartNext?: (current: Track, recentIds: string[]) => Track | null;
  recommendItems?: RecommendItem[];
  /** 尚未播放时按空格，从这个列表的第一首开始。 */
  browseTracks?: Track[];
  /** 播放失败时的提示。 */
  onError?: (message: string) => void;
};

export function usePlayer(tracks: Track[], options: PlayerOptions = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const onListenRef = useRef(options.onListen);
  const pickSmartRef = useRef(options.pickSmartNext);
  const sessionRef = useRef<Session>(emptySession());
  const loadedIdRef = useRef<string | null>(null);
  const recentRef = useRef<string[]>([]);
  const historyRef = useRef<string[]>([]);
  const onErrorRef = useRef(options.onError);
  const errorStreakRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  onListenRef.current = options.onListen;
  pickSmartRef.current = options.pickSmartNext;
  onErrorRef.current = options.onError;
  const [currentId, setCurrentId] = useState<string | null>(null);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  // 播放进度每秒更新好几次，放在 React state 之外，只让进度条订阅
  const timeRef = useRef(0);
  const timeListenersRef = useRef(new Set<() => void>());
  const setTime = useCallback((t: number) => {
    timeRef.current = t;
    for (const listener of timeListenersRef.current) listener();
  }, []);
  const subscribeTime = useCallback((listener: () => void) => {
    timeListenersRef.current.add(listener);
    return () => {
      timeListenersRef.current.delete(listener);
    };
  }, []);
  const getTime = useCallback(() => timeRef.current, []);
  const [mode, setMode] = useState<PlayMode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    if (
      saved === "repeat-one" ||
      saved === "repeat-artist" ||
      saved === "shuffle" ||
      saved === "repeat-all" ||
      saved === "smart"
    ) {
      return saved;
    }
    return "repeat-all";
  });
  const [rate, setRate] = useState(() => {
    const n = loadNumber(RATE_KEY, 1);
    return RATES.includes(n) ? n : 1;
  });
  const [volume, setVolumeState] = useState(() => Math.min(1, Math.max(0, loadNumber(VOLUME_KEY, 0.9))));
  const [muted, setMuted] = useState(false);
  const [replayGain, setReplayGain] = useState(() => localStorage.getItem(RG_KEY) === "1");
  const outputRef = useRef({ rate, volume, muted });
  outputRef.current = { rate, volume, muted };
  const [contextIds, setContextIds] = useState<string[] | null>(null);
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  // 手动队列："下一首播放 / 加入队列"，优先于正常顺序
  const [userQueue, setUserQueueState] = useState<string[]>([]);
  const userQueueRef = useRef<string[]>([]);
  const setUserQueue = useCallback((update: (q: string[]) => string[]) => {
    const next = update(userQueueRef.current);
    userQueueRef.current = next;
    setUserQueueState(next);
  }, []);

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const current = currentId ? byId.get(currentId) ?? null : null;

  const contextTracks = useMemo(() => {
    if (!contextIds) return tracks;
    const list = contextIds.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
    return list.length ? list : tracks;
  }, [byId, contextIds, tracks]);

  const queue = useMemo(
    () => buildQueue({ tracks, contextTracks, current, mode, shuffleOrder, byId }),
    [byId, contextTracks, current, mode, shuffleOrder, tracks],
  );

  const recommendItems = options.recommendItems;

  const upcoming = useMemo((): UpcomingItem[] => {
    const queued = userQueue
      .map((id) => byId.get(id))
      .filter((t): t is Track => Boolean(t))
      .map((track) => ({ track, reason: "已加入队列", queued: true }));
    const rest = buildUpcoming({ queue, current, mode, recommendItems, recentIds, count: UPCOMING_COUNT });
    return [...queued, ...rest.filter((item) => !userQueue.includes(item.track.id))].slice(
      0,
      Math.max(UPCOMING_COUNT, queued.length),
    );
  }, [byId, current, mode, queue, recentIds, recommendItems, userQueue]);

  // ReplayGain：音频图里的增益节点按当前曲目的标签调整
  const applyGainRef = useRef(() => {});
  applyGainRef.current = () => {
    if (gainRef.current) gainRef.current.gain.value = replayGain ? replayGainFactor(current?.replayGain) : 1;
  };
  useEffect(() => {
    applyGainRef.current();
    localStorage.setItem(RG_KEY, replayGain ? "1" : "0");
  }, [current, replayGain]);

  const attachGraph = useCallback((audio: HTMLAudioElement) => {
    if (sourceRef.current) return;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    sourceRef.current = source;
    gainRef.current = gain;
    analyserRef.current = analyser;
    applyGainRef.current();
  }, []);

  const getAnalyser = useCallback(() => analyserRef.current, []);


  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    return audio;
  }, []);

  /** 结束当前曲目的收听会话：上报实际收听时长，并记入最近 / 历史。 */
  const flushListen = useCallback((reason: string, pushHistory = true) => {
    const session = sessionRef.current;
    if (!session.trackId) return;
    if (!session.started) {
      // 从没真正播放过（比如恢复上次会话后直接换歌），不算一次收听
      sessionRef.current = emptySession();
      return;
    }
    const audio = audioRef.current;
    const track = byId.get(session.trackId);
    const duration = audio?.duration || track?.duration || 0;
    const seconds = session.listened;
    const progress = duration > 0 ? Math.min(1, seconds / duration) : 0;
    onListenRef.current?.({
      trackId: session.trackId,
      progress,
      seconds,
      duration,
      reason,
    });

    const nextRecent = pushId(recentRef.current, session.trackId, RECENT_LIMIT);
    recentRef.current = nextRecent;
    setRecentIds(nextRecent);
    if (pushHistory) historyRef.current = pushId(historyRef.current, session.trackId, HISTORY_LIMIT);
    sessionRef.current = emptySession();
  }, [byId]);

  const flushListenRef = useRef(flushListen);
  flushListenRef.current = flushListen;

  const playTrack = useCallback((track: Track, opts: PlayOptions = {}) => {
    const { autoplay = true, context, fromHistory = false } = opts;
    const audio = ensureAudio();
    const already = loadedIdRef.current === track.id;
    if (sessionRef.current.trackId && sessionRef.current.trackId !== track.id) {
      flushListen("pick", !fromHistory);
    }
    if (context) setContextIds(context.map((t) => t.id));
    if (userQueueRef.current.includes(track.id)) setUserQueue((q) => q.filter((id) => id !== track.id));
    setCurrentId(track.id);
    if (sessionRef.current.trackId !== track.id) {
      sessionRef.current = newSession(track.id, already ? audio.currentTime || 0 : 0);
    }
    const output = outputRef.current;
    audio.playbackRate = output.rate;
    audio.volume = output.muted ? 0 : output.volume;

    const start = () => {
      if (!autoplay) return;
      attachGraph(audio);
      void ctxRef.current?.resume();
      void audio.play().catch(() => setPlaying(false));
    };

    if (already) {
      if (audio.ended) {
        audio.currentTime = 0;
        sessionRef.current.lastPos = 0;
      }
      if (audio.paused || audio.ended) start();
      return;
    }

    loadedIdRef.current = track.id;
    audio.src = streamUrl(track.id);
    // 新曲目的元数据到达前先用曲库里的时长，避免进度条显示上一首的总长
    setDuration(track.duration || 0);
    setTime(0);
    start();
  }, [attachGraph, ensureAudio, flushListen, setTime, setUserQueue]);

  const playNext = useCallback((track: Track) => {
    setUserQueue((q) => [track.id, ...q.filter((id) => id !== track.id)]);
  }, [setUserQueue]);
  const addToQueue = useCallback((track: Track) => {
    setUserQueue((q) => (q.includes(track.id) ? q : [...q, track.id]));
  }, [setUserQueue]);
  const removeFromQueue = useCallback((id: string) => {
    setUserQueue((q) => q.filter((x) => x !== id));
  }, [setUserQueue]);

  const browseRef = useRef(options.browseTracks);
  browseRef.current = options.browseTracks;

  const togglePlay = useCallback(() => {
    const audio = ensureAudio();
    if (!current) {
      const list = browseRef.current?.length ? browseRef.current : tracks;
      const first = list[0];
      if (first) playTrack(first, { context: list });
      return;
    }
    if (audio.paused) {
      attachGraph(audio);
      void ctxRef.current?.resume();
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [attachGraph, current, ensureAudio, playTrack, tracks]);

  const step = useCallback((delta: number) => {
    if (!current || queue.length === 0) return;
    if (delta > 0) {
      const queuedId = userQueueRef.current.find((id) => byId.has(id));
      if (queuedId) {
        playTrack(byId.get(queuedId)!);
        return;
      }
    }
    if (mode === "smart" && delta > 0) {
      const picked = pickSmartRef.current?.(current, recentRef.current);
      if (picked) {
        playTrack(picked);
        return;
      }
    }
    if (mode === "smart" && delta < 0) {
      const prevId = historyRef.current.pop();
      const prevTrack = prevId ? byId.get(prevId) : null;
      if (prevTrack) {
        playTrack(prevTrack, { fromHistory: true });
        return;
      }
    }
    const next = stepInQueue(queue, current.id, delta);
    if (next) playTrack(next);
  }, [byId, current, mode, playTrack, queue]);

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    step(-1);
  }, [step]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(time, 0), audio.duration);
    setTime(audio.currentTime);
  }, [setTime]);

  const seekBy = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const base = Number.isFinite(audio.duration) ? audio.duration : duration;
    seek(Math.min(Math.max((audio.currentTime || 0) + delta, 0), base || 0));
  }, [duration, seek]);

  const cycleRate = useCallback(() => {
    setRate((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length] || 1);
  }, []);

  const setVolume = useCallback((v: number) => {
    const next = Math.min(1, Math.max(0, v));
    setVolumeState(next);
    if (next > 0) setMuted(false);
  }, []);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(RATE_KEY, String(rate));
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    if (mode !== "shuffle") return;
    setShuffleOrder((prev) => {
      const ids = contextTracks.map((t) => t.id);
      return sameIdSet(prev, ids) ? prev : shuffleIds(ids, currentIdRef.current);
    });
  }, [mode, contextTracks]);

  useEffect(() => {
    const audio = ensureAudio();

    const onTime = () => {
      const t = audio.currentTime || 0;
      setTime(t);
      const session = sessionRef.current;
      if (session.trackId) {
        const delta = t - session.lastPos;
        if (delta > 0 && delta < MAX_PLAY_DELTA) session.listened += delta;
        session.lastPos = t;
        // 真正播放了一秒以上才算恢复正常
        if (session.listened > 1) errorStreakRef.current = 0;
      }
      if (Math.abs(t - lastSaveRef.current) >= SAVE_EVERY_SECONDS) {
        lastSaveRef.current = t;
        persistRef.current();
        updatePositionState(audio);
      }
    };
    const onMeta = () => {
      setDuration(audio.duration || 0);
      if (pendingSeekRef.current != null && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(pendingSeekRef.current, Math.max(0, audio.duration - 1));
        pendingSeekRef.current = null;
        setTime(audio.currentTime);
      }
      updatePositionState(audio);
    };
    const onPlay = () => {
      setPlaying(true);
      if (sessionRef.current.trackId === loadedIdRef.current) sessionRef.current.started = true;
    };
    const onPause = () => {
      setPlaying(false);
      persistRef.current();
    };
    const onEnded = () => {
      flushListen("ended");
      if (mode === "repeat-one" && current) {
        sessionRef.current = newSession(current.id);
        audio.currentTime = 0;
        void audio.play();
        return;
      }
      next();
    };
    const onError = () => {
      const id = loadedIdRef.current;
      if (!id) return;
      const track = byId.get(id);
      setPlaying(false);
      sessionRef.current = emptySession();
      // 记入"最近"，智能模式不会马上又选中这首坏掉的歌
      recentRef.current = pushId(recentRef.current, id, RECENT_LIMIT);
      setRecentIds(recentRef.current);
      errorStreakRef.current += 1;
      const giveUp = errorStreakRef.current >= MAX_ERROR_STREAK || mode === "repeat-one";
      onErrorRef.current?.(
        `无法播放《${track?.title ?? "未知歌曲"}》${giveUp ? "" : "，已跳到下一首"}`,
      );
      if (!giveUp) next();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [byId, current, ensureAudio, flushListen, mode, next, setTime]);

  // ---- 记住播放进度，下次打开时恢复 ----

  const persistRef = useRef(() => {});
  persistRef.current = () => {
    const id = currentIdRef.current;
    if (!id) return;
    saveSession({
      trackId: id,
      position: audioRef.current?.currentTime || pendingSeekRef.current || 0,
      contextIds,
      queue: userQueueRef.current,
    });
  };
  useEffect(() => {
    persistRef.current();
  }, [currentId, contextIds, userQueue]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || tracks.length === 0) return;
    restoredRef.current = true;
    const saved = loadSession();
    const track = saved ? byId.get(saved.trackId) : null;
    if (!saved || !track || currentIdRef.current) return;
    if (saved.contextIds) setContextIds(saved.contextIds);
    setUserQueue(() => saved.queue.filter((id) => byId.has(id)));
    pendingSeekRef.current = saved.position;
    playTrack(track, { autoplay: false });
  }, [byId, playTrack, setUserQueue, tracks.length]);

  // 关闭或刷新页面时上报当前曲目（React 卸载清理在关标签页时不会执行）
  useEffect(() => {
    const onHide = () => {
      persistRef.current();
      flushListenRef.current("unload", false);
    };
    const onShow = (e: PageTransitionEvent) => {
      const audio = audioRef.current;
      const id = currentIdRef.current;
      if (e.persisted && id && audio && !sessionRef.current.trackId) {
        sessionRef.current = { ...newSession(id, audio.currentTime || 0), started: !audio.paused };
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  // ---- 系统媒体控制：键盘媒体键、耳机线控、控制中心"正在播放" ----

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist,
          album: current.album,
          artwork: current.hasCover
            ? [{ src: new URL(coverUrl(current.id), window.location.href).href, sizes: "512x512" }]
            : [],
        })
      : null;
  }, [current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = current ? (playing ? "playing" : "paused") : "none";
  }, [current, playing]);

  const mediaRef = useRef({ togglePlay, next, prev, seekBy, seek });
  mediaRef.current = { togglePlay, next, prev, seekBy, seek };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => audioRef.current?.paused && mediaRef.current.togglePlay()],
      ["pause", () => audioRef.current && !audioRef.current.paused && mediaRef.current.togglePlay()],
      ["nexttrack", () => mediaRef.current.next()],
      ["previoustrack", () => mediaRef.current.prev()],
      ["seekbackward", (d) => mediaRef.current.seekBy(-(d.seekOffset || 10))],
      ["seekforward", (d) => mediaRef.current.seekBy(d.seekOffset || 10)],
      ["seekto", (d) => d.seekTime != null && mediaRef.current.seek(d.seekTime)],
    ];
    for (const [action, handler] of actions) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* 浏览器不支持这个动作 */
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  useShortcuts({
    togglePlay,
    seekBy,
    volumeBy: (delta) => setVolume(volume + delta),
    next,
    prev,
    toggleMute: () => setMuted((v) => !v),
  });

  return {
    current,
    playing,
    subscribeTime,
    getTime,
    duration: duration || current?.duration || 0,
    mode,
    setMode,
    rate,
    setRate,
    rates: RATES,
    cycleRate,
    volume,
    setVolume,
    muted,
    setMuted,
    getAnalyser,
    queue,
    upcoming,
    recentIds,
    userQueue,
    playNext,
    addToQueue,
    removeFromQueue,
    replayGain,
    setReplayGain,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    seekBy,
  };
}

/** 订阅播放进度；只有调用它的组件会随进度重渲染。 */
export function usePlaybackTime(subscribe: (listener: () => void) => () => void, getTime: () => number): number {
  return useSyncExternalStore(subscribe, getTime);
}

function updatePositionState(audio: HTMLAudioElement) {
  if (!("mediaSession" in navigator) || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime || 0, audio.duration),
    });
  } catch {
    /* 部分浏览器不支持 */
  }
}
