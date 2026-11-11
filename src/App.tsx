import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  fetchLibrary,
  fetchLibraryVersion,
  fetchLyrics,
  fetchPlaylists,
  fetchRecommend,
  postFeedback,
  postListen,
  removeFromPlaylist,
  renamePlaylist,
  rescanLibrary,
  restorePlaylist,
  setPlaylistTracks,
} from "./api";
import { PlayerBar } from "./components/PlayerBar";
import { RecommendPanel } from "./components/RecommendPanel";
import { Sidebar } from "./components/Sidebar";
import { StatsPanel } from "./components/StatsPanel";
import { TrackMenu, type MenuActions, type MenuState } from "./components/TrackMenu";
import { UpcomingPanel } from "./components/UpcomingPanel";
import { TrackList } from "./components/TrackList";
import { IconClose, IconPlay, IconRefresh, IconSearch, IconShuffle } from "./components/Icons";
import { usePlayer } from "./hooks/usePlayer";
import { isTypingTarget } from "./hooks/useShortcuts";
import type { LibraryResponse, Playlist, RecommendItem, RecommendResponse, Track, ViewFilter } from "./types";

/** 换歌、上报、点喜欢可能在同一瞬间触发多次刷新，合并成一次请求。 */
const RECS_DEBOUNCE_MS = 120;
/** 智能模式偶尔不选第一名，而是从前几名里随机挑一首，避免总在同几首歌里打转。 */
const EXPLORE_RATE = 0.15;
const EXPLORE_TOP = 5;
const TOAST_MS = 4000;
/** 带"撤销"的提示多停留一会儿，来得及点。 */
const TOAST_ACTION_MS = 7000;
const BASE_TITLE = "唱机 — Local Player";
const UNDO_KEY_HINT = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? "⌘Z" : "Ctrl+Z";

type ToastAction = { label: string; run: () => void };
type Toast = { id: number; text: string; action?: ToastAction };

/** 搜索：原文、全拼、首字母都能命中；拼音匹配时忽略空格。 */
function matchesQuery(track: Track, q: string): boolean {
  if (!q) return true;
  const key = track.search || `${track.title} ${track.artist} ${track.album}`.toLowerCase();
  return key.includes(q) || key.replace(/\s+/g, "").includes(q.replace(/\s+/g, ""));
}

/** 重新扫描前后对比，告诉用户新增、移除了几首。 */
function scanSummary(before: Track[], after: Track[]): string {
  const prev = new Set(before.map((t) => t.id));
  const next = new Set(after.map((t) => t.id));
  let added = 0;
  for (const id of next) if (!prev.has(id)) added += 1;
  let removed = 0;
  for (const id of prev) if (!next.has(id)) removed += 1;
  if (!added && !removed) return `扫描完成，共 ${after.length} 首，没有变化`;
  const parts = [added ? `新增 ${added} 首` : "", removed ? `移除 ${removed} 首` : ""].filter(Boolean);
  return `扫描完成：${parts.join("，")}`;
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [musicDir, setMusicDir] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ViewFilter>({ kind: "all" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [recs, setRecs] = useState<RecommendItem[]>([]);
  const [likes, setLikes] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<RecommendResponse["metrics"] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [toastPaused, setToastPaused] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 每上报一次收听加一，统计页据此刷新。 */
  const [listenVersion, setListenVersion] = useState(0);
  const recsRef = useRef<RecommendItem[]>([]);
  const recsSeqRef = useRef(0);
  const recsTimerRef = useRef<number | undefined>(undefined);
  const pendingPostRef = useRef<Promise<unknown>>(Promise.resolve());
  const recentRef = useRef<string[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const libraryVersionRef = useRef<number | null>(null);
  const toastSeqRef = useRef(0);
  const toastRef = useRef<Toast | null>(null);
  toastRef.current = toast;
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;
  const playlistsRef = useRef<Playlist[]>([]);
  playlistsRef.current = playlists;
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const showToast = useCallback((text: string, action?: ToastAction) => {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, text, action });
    setToastPaused(false);
  }, []);

  // 鼠标停在提示条上时暂停计时
  useEffect(() => {
    if (!toast || toastPaused) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? TOAST_ACTION_MS : TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, toastPaused]);

  const runToastAction = useCallback(() => {
    const current = toastRef.current;
    if (!current?.action) return;
    setToast(null);
    setToastPaused(false);
    current.action.run();
  }, []);

  /** 以当前曲目为种子刷新推荐。会等待尚未完成的反馈上报，保证结果包含最新反馈。 */
  const refreshRecs = useCallback(() => {
    window.clearTimeout(recsTimerRef.current);
    recsTimerRef.current = window.setTimeout(async () => {
      // 只采用最后一次请求的结果，避免慢响应覆盖新结果
      const seq = ++recsSeqRef.current;
      await pendingPostRef.current.catch(() => undefined);
      const seed = currentIdRef.current;
      const exclude = [...new Set([...(seed ? [seed] : []), ...recentRef.current])];
      try {
        const data = await fetchRecommend({ seed, limit: 12, exclude });
        if (seq !== recsSeqRef.current) return;
        recsRef.current = data.items;
        setRecs(data.items);
        setLikes(data.likes || []);
        setMetrics(data.metrics);
      } catch {
        /* 推荐服务稍后重试 */
      }
    }, RECS_DEBOUNCE_MS);
  }, []);

  const tracksById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const activePlaylist = filter.kind === "playlist" ? playlists.find((p) => p.id === filter.id) ?? null : null;
  // 曲库很大时，输入框先跟手，列表过滤稍后跟上
  const deferredQuery = useDeferredValue(query);

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let base: Track[];
    if (filter.kind === "liked") {
      const liked = new Set(likes);
      base = tracks.filter((t) => liked.has(t.id));
    } else if (filter.kind === "playlist") {
      // 歌单按加入顺序显示
      base = (activePlaylist?.trackIds ?? []).map((id) => tracksById.get(id)).filter((t): t is Track => Boolean(t));
    } else {
      base = tracks.filter((t) => {
        if (filter.kind === "artist") return t.artist === filter.artist;
        if (filter.kind === "album") return t.album === filter.album && t.albumArtist === filter.artist;
        return true;
      });
    }
    return q ? base.filter((t) => matchesQuery(t, q)) : base;
  }, [activePlaylist, deferredQuery, filter, likes, tracks, tracksById]);

  const player = usePlayer(tracks, {
    recommendItems: recs,
    browseTracks: visible,
    onError: showToast,
    onListen: (report) => {
      pendingPostRef.current = postListen(report).then(() => setListenVersion((v) => v + 1));
      refreshRecs();
    },
    pickSmartNext: (current, recent) => {
      const pool = recsRef.current.filter(
        (item) => item.track && item.id !== current.id && !recent.includes(item.id),
      );
      if (pool.length > 1 && Math.random() < EXPLORE_RATE) {
        const pick = 1 + Math.floor(Math.random() * Math.min(EXPLORE_TOP - 1, pool.length - 1));
        return pool[pick].track;
      }
      return pool[0]?.track ?? null;
    },
  });
  recentRef.current = player.recentIds;
  currentIdRef.current = player.current?.id ?? null;

  const applyLibrary = useCallback((data: LibraryResponse) => {
    libraryVersionRef.current = data.version ?? null;
    setTracks(data.tracks);
    setMusicDir(data.musicDir);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyLibrary(await fetchLibrary());
    } catch (err) {
      setError(err instanceof Error ? err.message : "曲库加载失败");
    } finally {
      setLoading(false);
    }
  }, [applyLibrary]);

  const rescan = useCallback(async () => {
    const before = tracksRef.current;
    setScanning(true);
    setError(null);
    try {
      const data = await rescanLibrary();
      applyLibrary(data);
      showToast(scanSummary(before, data.tracks));
    } catch (err) {
      const message = err instanceof Error ? err.message : "重新扫描失败";
      // 曲库是空的就直接显示在页面里，否则不打断正在看的列表
      if (before.length === 0) setError(message);
      else showToast(message);
    } finally {
      setScanning(false);
    }
  }, [applyLibrary, showToast]);

  useEffect(() => {
    void load();
    fetchPlaylists()
      .then(setPlaylists)
      .catch(() => undefined);
  }, [load]);

  // 服务端监听到曲库文件变化会自动重扫；切回窗口时检查版本号，有变化就重新拉取
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const version = await fetchLibraryVersion();
      if (version != null && libraryVersionRef.current != null && version !== libraryVersionRef.current) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [load]);

  useEffect(() => {
    if (tracks.length === 0) return;
    refreshRecs();
  }, [tracks, player.current?.id, refreshRecs]);

  // 标签页标题显示正在播放的歌
  const nowPlaying = player.current;
  const isPlaying = player.playing;
  useEffect(() => {
    document.title = nowPlaying
      ? `${isPlaying ? "▶ " : ""}${nowPlaying.title} · ${nowPlaying.artist} — 唱机`
      : BASE_TITLE;
  }, [isPlaying, nowPlaying]);

  // 切歌时在后台预取歌词，打开歌词页时不用再等在线查找
  const nowPlayingId = nowPlaying?.id ?? null;
  useEffect(() => {
    if (nowPlayingId) fetchLyrics(nowPlayingId).catch(() => undefined);
  }, [nowPlayingId]);

  // 换页面时退出重命名，并回到顶部
  useEffect(() => {
    setRenaming(null);
    mainRef.current?.scrollTo({ top: 0 });
  }, [filter]);

  // "/" 或 ⌘K 聚焦搜索；有"撤销"提示时 ⌘Z 撤销
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (mod && key === "z" && toastRef.current?.action) {
        e.preventDefault();
        runToastAction();
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runToastAction]);

  const { playTrack, setMode, next, playNext, addToQueue, removeFromQueue, insertIntoQueue, getTime } = player;
  const playFromList = useCallback((track: Track) => playTrack(track, { context: visible }), [playTrack, visible]);
  const playSingle = useCallback((track: Track) => playTrack(track), [playTrack]);

  /** "播放全部"按列表顺序从第一首开始；随机、智能、单曲循环下点它会切回顺序播放。 */
  const playAll = useCallback(() => {
    if (!visible.length) return;
    setMode("repeat-all");
    playTrack(visible[0], { context: visible, startAt: 0 });
  }, [playTrack, setMode, visible]);

  const shuffleAll = useCallback(() => {
    if (!visible.length) return;
    setMode("shuffle");
    playTrack(visible[Math.floor(Math.random() * visible.length)], { context: visible });
  }, [playTrack, setMode, visible]);

  const goArtist = useCallback((artist: string) => {
    setQuery("");
    setFilter({ kind: "artist", artist });
  }, []);
  const goAlbum = useCallback((track: Track) => {
    setQuery("");
    setFilter({ kind: "album", album: track.album, artist: track.albumArtist });
  }, []);

  const onSearch = (value: string) => {
    setQuery(value);
    // 推荐页、统计页不显示曲目列表，开始搜索时切到全部歌曲
    if (value.trim() && (filter.kind === "recommend" || filter.kind === "stats")) setFilter({ kind: "all" });
  };

  const openMenu = useCallback((e: React.MouseEvent, track: Track, queued = false) => {
    e.preventDefault();
    // 键盘（菜单键 / Shift+F10）打开时没有鼠标坐标，贴着元素弹出
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX || rect.left + 24;
    const y = e.clientY || rect.bottom;
    setMenu({ track, x, y, queued, playlistId: filter.kind === "playlist" ? filter.id : undefined });
  }, [filter]);
  const closeMenu = useCallback(() => setMenu(null), []);

  const toggleLike = useCallback((track: Track) => {
    const nextLiked = !likes.includes(track.id);
    setLikes((prev) => (nextLiked ? [...prev, track.id] : prev.filter((id) => id !== track.id)));
    pendingPostRef.current = postFeedback(track.id, { liked: nextLiked }).catch(() => undefined);
    refreshRecs();
  }, [likes, refreshRecs]);

  const dislike = useCallback((track: Track) => {
    const wasLiked = likes.includes(track.id);
    const wasCurrent = currentIdRef.current === track.id;
    const position = wasCurrent ? getTime() : 0;
    setLikes((prev) => prev.filter((id) => id !== track.id));
    pendingPostRef.current = postFeedback(track.id, { disliked: true }).catch(() => undefined);
    refreshRecs();
    if (wasCurrent) next();
    showToast(`已标记不喜欢《${track.title}》，之后会少推荐这类歌`, {
      label: "撤销",
      run: () => {
        if (wasLiked) setLikes((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
        // 排在"不喜欢"的上报之后，保证服务端先标记、再撤销
        pendingPostRef.current = pendingPostRef.current
          .catch(() => undefined)
          .then(() => postFeedback(track.id, { disliked: false, liked: wasLiked }))
          .catch(() => undefined);
        refreshRecs();
        // 回到原曲原位置；刚切过去的那首不算一次跳过
        if (wasCurrent) playTrack(track, { startAt: position, skipReport: true });
      },
    });
  }, [getTime, likes, next, playTrack, refreshRecs, showToast]);

  const upsertPlaylist = useCallback((playlist: Playlist) => {
    setPlaylists((prev) =>
      prev.some((p) => p.id === playlist.id) ? prev.map((p) => (p.id === playlist.id ? playlist : p)) : [...prev, playlist],
    );
  }, []);

  const onCreatePlaylist = useCallback((name: string) => {
    createPlaylist(name)
      .then((p) => {
        upsertPlaylist(p);
        setFilter({ kind: "playlist", id: p.id });
      })
      .catch(() => showToast("新建歌单失败"));
  }, [showToast, upsertPlaylist]);

  const onDeletePlaylist = useCallback((playlist: Playlist) => {
    const index = playlistsRef.current.findIndex((p) => p.id === playlist.id);
    deletePlaylist(playlist.id)
      .then(() => {
        setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
        setFilter({ kind: "all" });
        showToast(`已删除歌单「${playlist.name}」`, {
          label: "撤销",
          run: () => {
            restorePlaylist(playlist, index)
              .then((restored) => {
                setPlaylists((prev) => {
                  if (prev.some((p) => p.id === restored.id)) return prev;
                  const list = [...prev];
                  list.splice(Math.max(0, Math.min(index, list.length)), 0, restored);
                  return list;
                });
                setFilter({ kind: "playlist", id: restored.id });
              })
              .catch(() => showToast("撤销失败"));
          },
        });
      })
      .catch(() => showToast("删除失败"));
  }, [showToast]);

  const menuActions = useMemo((): MenuActions => ({
    play: playSingle,
    playNext: (track) => {
      playNext(track);
      showToast(`《${track.title}》将在下一首播放`);
    },
    addToQueue: (track) => {
      addToQueue(track);
      showToast(`已把《${track.title}》加入队列`);
    },
    toggleLike,
    dislike,
    addToPlaylist: (id, track) => {
      addToPlaylist(id, track.id)
        .then((p) => {
          upsertPlaylist(p);
          showToast(`已添加到「${p.name}」`);
        })
        .catch(() => showToast("添加失败"));
    },
    createPlaylistWith: (name, track) => {
      createPlaylist(name, track.id)
        .then((p) => {
          upsertPlaylist(p);
          showToast(`已新建歌单「${p.name}」`);
        })
        .catch(() => showToast("新建歌单失败"));
    },
    removeFromPlaylist: (id, track) => {
      const index = playlistsRef.current.find((p) => p.id === id)?.trackIds.indexOf(track.id) ?? -1;
      removeFromPlaylist(id, track.id)
        .then((p) => {
          upsertPlaylist(p);
          showToast(`已从「${p.name}」移除《${track.title}》`, {
            label: "撤销",
            run: () => {
              // 以最新的歌单为准放回原位置，期间新加的歌不会丢
              const latest = playlistsRef.current.find((x) => x.id === id);
              if (!latest) return;
              const ids = latest.trackIds.filter((t) => t !== track.id);
              ids.splice(index < 0 ? ids.length : Math.min(index, ids.length), 0, track.id);
              setPlaylistTracks(id, ids)
                .then(upsertPlaylist)
                .catch(() => showToast("撤销失败"));
            },
          });
        })
        .catch(() => showToast("移除失败"));
    },
    removeFromQueue: (track) => {
      const index = removeFromQueue(track.id);
      if (index < 0) return;
      showToast(`已从队列移除《${track.title}》`, { label: "撤销", run: () => insertIntoQueue(track, index) });
    },
    goArtist: (track) => goArtist(track.artist),
    goAlbum,
  }), [
    addToQueue,
    dislike,
    goAlbum,
    goArtist,
    insertIntoQueue,
    playNext,
    playSingle,
    removeFromQueue,
    showToast,
    toggleLike,
    upsertPlaylist,
  ]);

  const artists = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) map.set(t.artist, (map.get(t.artist) || 0) + 1);
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  }, [tracks]);

  const albums = useMemo(() => {
    // 按专辑艺人分组，合辑不会被拆成每位歌手一张
    const map = new Map<string, { album: string; artist: string; count: number }>();
    for (const t of tracks) {
      const key = `${t.albumArtist}|||${t.album}`;
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { album: t.album, artist: t.albumArtist, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.album.localeCompare(b.album, "zh-CN"));
  }, [tracks]);

  const kicker = {
    all: "曲库",
    artist: "歌手",
    album: "专辑",
    recommend: "推荐",
    liked: "收藏",
    playlist: "歌单",
    stats: "统计",
  }[filter.kind];

  const heading =
    filter.kind === "artist"
      ? filter.artist
      : filter.kind === "album"
        ? filter.album
        : filter.kind === "recommend"
          ? "为你推荐"
          : filter.kind === "liked"
            ? "我喜欢"
            : filter.kind === "playlist"
              ? activePlaylist?.name ?? "歌单"
              : filter.kind === "stats"
                ? "听歌统计"
                : "全部歌曲";

  const sub =
    filter.kind === "album"
      ? filter.artist
      : filter.kind === "recommend"
        ? metrics?.trained
          ? `根据 ${metrics.events} 条听歌记录挑选 · 只在本机计算`
          : "听得越多，推荐越准"
        : filter.kind === "stats"
          ? "全部在本机统计"
          : `${visible.length} 首${query ? " · 搜索结果" : ""}`;

  // 推荐页、统计页没有曲目列表，不显示"播放全部"
  const listView = filter.kind !== "recommend" && filter.kind !== "stats";

  const playSmart = useCallback(() => {
    setMode("smart");
    const first = recs[0]?.track || tracks[0];
    if (first) playTrack(first);
  }, [playTrack, recs, setMode, tracks]);

  const emptyHint =
    filter.kind === "liked"
      ? "还没有喜欢的歌。点播放条上的 ♡，或右键歌曲选「喜欢」。"
      : filter.kind === "playlist"
        ? "歌单是空的。右键任意歌曲，选「添加到歌单」。"
        : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">唱</span>
          <div>
            <h1>唱机</h1>
            <p>Local Hi-Fi Player</p>
          </div>
        </div>

        <label className="search">
          <IconSearch size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              // 输入法候选框里的 Esc 只用来取消拼写
              if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (query) setQuery("");
              else e.currentTarget.blur();
            }}
            placeholder="搜索歌曲、歌手、专辑，支持拼音"
            aria-label="搜索"
            aria-keyshortcuts="/ Meta+K Control+K"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query ? (
            <button
              className="search-clear"
              type="button"
              aria-label="清空搜索"
              title="清空搜索  Esc"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <IconClose size={14} />
            </button>
          ) : (
            <kbd className="search-kbd" title="按 / 或 ⌘K 搜索" aria-hidden>
              /
            </kbd>
          )}
        </label>

        <button
          className="ghost-btn"
          onClick={() => void rescan()}
          type="button"
          disabled={scanning}
          aria-busy={scanning}
        >
          <IconRefresh size={16} className={scanning ? "spin-icon" : undefined} />
          {scanning ? "扫描中…" : "重新扫描"}
        </button>
      </header>

      <Sidebar
        artists={artists}
        albums={albums}
        playlists={playlists}
        likedCount={likes.length}
        filter={filter}
        onFilter={setFilter}
        onCreatePlaylist={onCreatePlaylist}
        musicDir={musicDir}
      />

      <main className="main" ref={mainRef}>
        <div className="page-head">
          <div className="page-title">
            <p className="kicker">{kicker}</p>
            {renaming != null && activePlaylist ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = renaming.trim();
                  setRenaming(null);
                  if (!name || name === activePlaylist.name) return;
                  renamePlaylist(activePlaylist.id, name)
                    .then(upsertPlaylist)
                    .catch(() => showToast("重命名失败"));
                }}
              >
                <input
                  className="rename-input"
                  autoFocus
                  value={renaming}
                  maxLength={60}
                  aria-label="歌单名称"
                  onChange={(e) => setRenaming(e.target.value)}
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                />
              </form>
            ) : (
              <h2>{heading}</h2>
            )}
            <p className="sub">{sub}</p>
            {listView && visible.length > 0 ? (
              <div className="page-play">
                <button className="primary-btn" type="button" onClick={playAll}>
                  <IconPlay size={14} />
                  播放全部
                </button>
                <button className="ghost-btn" type="button" onClick={shuffleAll}>
                  <IconShuffle size={16} />
                  随机播放
                </button>
              </div>
            ) : null}
          </div>
          <div className="page-actions">
            {activePlaylist ? (
              <>
                <button className="ghost-btn" type="button" onClick={() => setRenaming(activePlaylist.name)}>
                  重命名
                </button>
                <button className="ghost-btn" type="button" onClick={() => onDeletePlaylist(activePlaylist)}>
                  删除歌单
                </button>
              </>
            ) : null}
            {filter.kind !== "all" ? (
              <button className="ghost-btn" onClick={() => setFilter({ kind: "all" })} type="button">
                查看全部
              </button>
            ) : null}
          </div>
        </div>

        {error ? <div className="empty error">{error}</div> : null}
        {(loading || scanning) && tracks.length === 0 ? <div className="empty">正在读取本地曲库…</div> : null}
        {!loading && !scanning && tracks.length === 0 && !error ? (
          <div className="empty">
            没有找到音频文件。请把 FLAC 放到
            <code> {musicDir || "~/Desktop/music-resources"} </code>
            或修改 <code> config.json </code> 里的 <code>musicDir</code>。
          </div>
        ) : tracks.length === 0 ? null : filter.kind === "recommend" ? (
          <RecommendPanel
            items={recs}
            metrics={metrics}
            currentId={player.current?.id ?? null}
            playing={player.playing}
            onPlay={playSingle}
            onPlaySmart={playSmart}
            onMenu={openMenu}
          />
        ) : filter.kind === "stats" ? (
          <StatsPanel
            tracksById={tracksById}
            version={listenVersion}
            onPlay={playSingle}
            onSelectArtist={goArtist}
            onSelectAlbum={goAlbum}
          />
        ) : visible.length === 0 && emptyHint && !query ? (
          <div className="empty">{emptyHint}</div>
        ) : (
          <TrackList
            tracks={visible}
            currentId={player.current?.id ?? null}
            playing={player.playing}
            onPlay={playFromList}
            onMenu={openMenu}
            onSelectArtist={goArtist}
            onSelectAlbum={goAlbum}
          />
        )}
      </main>

      <UpcomingPanel
        items={player.upcoming}
        mode={player.mode}
        current={player.current}
        onPlay={playSingle}
        onMenu={openMenu}
        subscribeTime={player.subscribeTime}
        getTime={player.getTime}
        onSeek={player.seek}
      />

      <PlayerBar
        current={player.current}
        playing={player.playing}
        subscribeTime={player.subscribeTime}
        getTime={player.getTime}
        duration={player.duration}
        mode={player.mode}
        setMode={player.setMode}
        rate={player.rate}
        rates={player.rates}
        setRate={player.setRate}
        cycleRate={player.cycleRate}
        volume={player.volume}
        setVolume={player.setVolume}
        muted={player.muted}
        setMuted={player.setMuted}
        getAnalyser={player.getAnalyser}
        onToggle={player.togglePlay}
        onNext={player.next}
        onPrev={player.prev}
        onSeek={player.seek}
        onSeekBy={player.seekBy}
        liked={Boolean(player.current && likes.includes(player.current.id))}
        onToggleLike={() => player.current && toggleLike(player.current)}
        onDislike={() => player.current && dislike(player.current)}
        replayGain={player.replayGain}
        onToggleReplayGain={() => player.setReplayGain((v) => !v)}
        onSelectArtist={goArtist}
        onSelectAlbum={goAlbum}
      />

      {menu ? (
        <TrackMenu
          menu={menu}
          playlists={playlists}
          liked={likes.includes(menu.track.id)}
          actions={menuActions}
          onClose={closeMenu}
        />
      ) : null}

      <div className="toast-region" role="status" aria-live="polite">
        {toast ? (
          <div
            className="toast"
            key={toast.id}
            onMouseEnter={() => setToastPaused(true)}
            onMouseLeave={() => setToastPaused(false)}
            onFocus={() => setToastPaused(true)}
            onBlur={() => setToastPaused(false)}
          >
            <span>{toast.text}</span>
            {toast.action ? (
              <button className="toast-action" type="button" onClick={runToastAction} title={UNDO_KEY_HINT}>
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
