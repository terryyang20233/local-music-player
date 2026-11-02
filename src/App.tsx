import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  fetchLibrary,
  fetchLibraryVersion,
  fetchPlaylists,
  fetchRecommend,
  postFeedback,
  postListen,
  removeFromPlaylist,
  renamePlaylist,
  rescanLibrary,
} from "./api";
import { PlayerBar } from "./components/PlayerBar";
import { RecommendPanel } from "./components/RecommendPanel";
import { Sidebar } from "./components/Sidebar";
import { StatsPanel } from "./components/StatsPanel";
import { TrackMenu, type MenuActions, type MenuState } from "./components/TrackMenu";
import { UpcomingPanel } from "./components/UpcomingPanel";
import { TrackList } from "./components/TrackList";
import { IconRefresh, IconSearch } from "./components/Icons";
import { usePlayer } from "./hooks/usePlayer";
import type { LibraryResponse, Playlist, RecommendItem, RecommendResponse, Track, ViewFilter } from "./types";

/** 换歌、上报、点喜欢可能在同一瞬间触发多次刷新，合并成一次请求。 */
const RECS_DEBOUNCE_MS = 120;
/** 智能模式偶尔不选第一名，而是从前几名里随机挑一首，避免总在同几首歌里打转。 */
const EXPLORE_RATE = 0.15;
const EXPLORE_TOP = 5;
const TOAST_MS = 4000;

/** 搜索：原文、全拼、首字母都能命中；拼音匹配时忽略空格。 */
function matchesQuery(track: Track, q: string): boolean {
  if (!q) return true;
  const key = track.search || `${track.title} ${track.artist} ${track.album}`.toLowerCase();
  return key.includes(q) || key.replace(/\s+/g, "").includes(q.replace(/\s+/g, ""));
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [musicDir, setMusicDir] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ViewFilter>({ kind: "all" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState<RecommendItem[]>([]);
  const [likes, setLikes] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<RecommendResponse["metrics"] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const recsRef = useRef<RecommendItem[]>([]);
  const recsSeqRef = useRef(0);
  const recsTimerRef = useRef<number | undefined>(undefined);
  const pendingPostRef = useRef<Promise<unknown>>(Promise.resolve());
  const recentRef = useRef<string[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const libraryVersionRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
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
  }, [activePlaylist, filter, likes, query, tracks, tracksById]);

  const player = usePlayer(tracks, {
    recommendItems: recs,
    browseTracks: visible,
    onError: showToast,
    onListen: (report) => {
      pendingPostRef.current = postListen(report);
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

  const load = useCallback(async (request: () => Promise<LibraryResponse> = fetchLibrary) => {
    setLoading(true);
    setError(null);
    try {
      const data = await request();
      libraryVersionRef.current = data.version ?? null;
      setTracks(data.tracks);
      setMusicDir(data.musicDir);
    } catch (err) {
      setError(err instanceof Error ? err.message : "曲库加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => {
    setRenaming(null);
    setConfirmDelete(false);
  }, [filter]);

  const { playTrack, setMode, next, playNext, addToQueue, removeFromQueue } = player;
  const playFromList = useCallback((track: Track) => playTrack(track, { context: visible }), [playTrack, visible]);
  const playSingle = useCallback((track: Track) => playTrack(track), [playTrack]);

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
    setLikes((prev) => prev.filter((id) => id !== track.id));
    pendingPostRef.current = postFeedback(track.id, { disliked: true }).catch(() => undefined);
    refreshRecs();
    if (currentIdRef.current === track.id) next();
    showToast(`已标记不喜欢《${track.title}》，之后会少推荐这类歌`);
  }, [next, refreshRecs, showToast]);

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
      removeFromPlaylist(id, track.id)
        .then(upsertPlaylist)
        .catch(() => showToast("移除失败"));
    },
    removeFromQueue: (track) => removeFromQueue(track.id),
  }), [addToQueue, dislike, playNext, playSingle, removeFromQueue, showToast, toggleLike, upsertPlaylist]);

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
    recommend: "机器学习",
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
          ? `本地模型 · ${metrics.events} 条听歌记录`
          : "内容近邻冷启动 · 听得越多越准"
        : filter.kind === "stats"
          ? "全部在本机统计"
          : `${visible.length} 首${query ? " · 搜索结果" : ""}`;

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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲、歌手、专辑，支持拼音"
            aria-label="搜索"
          />
        </label>

        <button className="ghost-btn" onClick={() => void load(rescanLibrary)} type="button">
          <IconRefresh size={16} />
          重新扫描
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

      <main className="main">
        <div className="page-head">
          <div>
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
          </div>
          <div className="page-actions">
            {activePlaylist ? (
              <>
                <button className="ghost-btn" type="button" onClick={() => setRenaming(activePlaylist.name)}>
                  重命名
                </button>
                <button
                  className={`ghost-btn ${confirmDelete ? "is-danger" : ""}`}
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    const { id, name } = activePlaylist;
                    deletePlaylist(id)
                      .then(() => {
                        setPlaylists((prev) => prev.filter((p) => p.id !== id));
                        setFilter({ kind: "all" });
                        showToast(`已删除歌单「${name}」`);
                      })
                      .catch(() => showToast("删除失败"));
                  }}
                  onBlur={() => setConfirmDelete(false)}
                >
                  {confirmDelete ? "再点一次确认删除" : "删除歌单"}
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
        {loading && tracks.length === 0 ? <div className="empty">正在读取本地曲库…</div> : null}
        {!loading && tracks.length === 0 && !error ? (
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
            onPlay={playSingle}
            onSelectArtist={(artist) => setFilter({ kind: "artist", artist })}
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
          <div className="toast" key={toast.id}>
            {toast.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}
