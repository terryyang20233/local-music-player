import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamUrl } from "../api";
import type { ListenReport, PlayMode, Track } from "../types";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const MODE_KEY = "changji.mode";
const RATE_KEY = "changji.rate";
const VOLUME_KEY = "changji.volume";

function loadNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function shuffleIds(ids: string[], currentId?: string | null): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  if (currentId) {
    const idx = copy.indexOf(currentId);
    if (idx > 0) {
      copy.splice(idx, 1);
      copy.unshift(currentId);
    }
  }
  return copy;
}

type PlayerOptions = {
  onListen?: (report: ListenReport) => void;
  pickSmartNext?: (current: Track, recentIds: string[]) => Track | null;
};

export function usePlayer(tracks: Track[], options: PlayerOptions = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const onListenRef = useRef(options.onListen);
  const pickSmartRef = useRef(options.pickSmartNext);
  const sessionRef = useRef<{ trackId: string | null; maxTime: number }>({ trackId: null, maxTime: 0 });
  const recentRef = useRef<string[]>([]);
  const historyRef = useRef<string[]>([]);
  onListenRef.current = options.onListen;
  pickSmartRef.current = options.pickSmartNext;
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [levels, setLevels] = useState<number[]>(() => Array(16).fill(0));

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const current = currentId ? byId.get(currentId) ?? null : null;

  const queue = useMemo(() => {
    if (!current) return tracks;
    if (mode === "repeat-artist") {
      return tracks.filter((t) => t.artist === current.artist);
    }
    if (mode === "shuffle") {
      const map = new Map(tracks.map((t) => [t.id, t]));
      const ordered = shuffleOrder.map((id) => map.get(id)).filter((t): t is Track => Boolean(t));
      return ordered.length ? ordered : tracks;
    }
    return tracks;
  }, [tracks, current, mode, shuffleOrder]);

  const attachGraph = useCallback((audio: HTMLAudioElement) => {
    if (sourceRef.current) return;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    sourceRef.current = source;
    analyserRef.current = analyser;
  }, []);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    return audio;
  }, []);

  const flushListen = useCallback((reason: string) => {
    const session = sessionRef.current;
    if (!session.trackId) return;
    const audio = audioRef.current;
    const track = byId.get(session.trackId);
    const duration = audio?.duration || track?.duration || 0;
    const seconds = Math.max(session.maxTime, audio?.currentTime || 0);
    const progress = duration > 0 ? seconds / duration : 0;
    onListenRef.current?.({
      trackId: session.trackId,
      progress,
      seconds,
      duration,
      reason,
    });
    sessionRef.current = { trackId: null, maxTime: 0 };
  }, [byId]);

  const playTrack = useCallback((track: Track, autoplay = true) => {
    const audio = ensureAudio();
    const nextSrc = streamUrl(track.id);
    const already = audio.src.includes(track.id);
    if (sessionRef.current.trackId && sessionRef.current.trackId !== track.id) {
      recentRef.current = [...recentRef.current, sessionRef.current.trackId].slice(-12);
      historyRef.current = [...historyRef.current, sessionRef.current.trackId].slice(-40);
      flushListen("pick");
    }
    setCurrentId(track.id);
    sessionRef.current = { trackId: track.id, maxTime: already ? audio.currentTime || 0 : 0 };
    audio.playbackRate = rate;
    audio.volume = muted ? 0 : volume;

    const start = () => {
      if (!autoplay) return;
      attachGraph(audio);
      void ctxRef.current?.resume();
      void audio.play().catch(() => setPlaying(false));
    };

    if (already) {
      if (audio.ended) audio.currentTime = 0;
      if (audio.paused || audio.ended) start();
      return;
    }

    audio.src = nextSrc;
    start();
  }, [attachGraph, ensureAudio, flushListen, muted, rate, volume]);

  const togglePlay = useCallback(() => {
    const audio = ensureAudio();
    if (!current) {
      const first = tracks[0];
      if (first) playTrack(first);
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
        playTrack(prevTrack);
        return;
      }
    }
    const idx = queue.findIndex((t) => t.id === current.id);
    const next = queue[(idx + delta + queue.length) % queue.length];
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
    setCurrentTime(audio.currentTime);
  }, []);

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
      const ids = tracks.map((t) => t.id);
      const same =
        prev.length === ids.length && ids.every((id) => prev.includes(id));
      if (same) return prev;
      return shuffleIds(ids, currentId);
    });
  }, [mode, tracks, currentId]);

  useEffect(() => {
    const audio = ensureAudio();

    const onTime = () => {
      const t = audio.currentTime || 0;
      setCurrentTime(t);
      if (sessionRef.current.trackId) {
        sessionRef.current.maxTime = Math.max(sessionRef.current.maxTime, t);
      }
    };
    const onMeta = () => setDuration(audio.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      flushListen("ended");
      if (mode === "repeat-one" && current) {
        sessionRef.current = { trackId: current.id, maxTime: 0 };
        audio.currentTime = 0;
        void audio.play();
        return;
      }
      next();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [current, ensureAudio, flushListen, mode, next]);

  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (!session.trackId) return;
      const audio = audioRef.current;
      onListenRef.current?.({
        trackId: session.trackId,
        progress: 0,
        seconds: session.maxTime,
        duration: audio?.duration || 0,
        reason: "unload",
      });
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser && playing) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = 16;
        const nextLevels: number[] = [];
        const slice = Math.max(1, Math.floor(data.length / bars));
        for (let i = 0; i < bars; i += 1) {
          let sum = 0;
          for (let j = 0; j < slice; j += 1) sum += data[i * slice + j] || 0;
          nextLevels.push(sum / slice / 255);
        }
        setLevels(nextLevels);
      } else {
        setLevels((prev) => prev.map((n) => n * 0.86));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekBy(e.shiftKey ? 30 : 10);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekBy(e.shiftKey ? -30 : -10);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        setVolume((audioRef.current?.volume ?? volume) + 0.05);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        setVolume((audioRef.current?.volume ?? volume) - 0.05);
      } else if (e.key === "n" || e.key === "N") {
        next();
      } else if (e.key === "p" || e.key === "P") {
        prev();
      } else if (e.key === "m" || e.key === "M") {
        setMuted((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, seekBy, setVolume, togglePlay, volume]);

  return {
    current,
    playing,
    currentTime,
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
    levels,
    queue,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    seekBy,
  };
}
