import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLibrary, fetchRecommend, postFeedback, postListen } from "./api";
import { PlayerBar } from "./components/PlayerBar";
import { RecommendPanel } from "./components/RecommendPanel";
import { Sidebar } from "./components/Sidebar";
import { UpcomingPanel } from "./components/UpcomingPanel";
import { TrackList } from "./components/TrackList";
import { IconRefresh, IconSearch } from "./components/Icons";
import { usePlayer } from "./hooks/usePlayer";
import type { RecommendItem, RecommendResponse, Track, ViewFilter } from "./types";

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
  const recsRef = useRef<RecommendItem[]>([]);

  const refreshRecs = useCallback(async (seed?: string | null) => {
    try {
      const data = await fetchRecommend({ seed, limit: 12, exclude: seed ? [seed] : [] });
      recsRef.current = data.items;
      setRecs(data.items);
      setLikes(data.likes || []);
      setMetrics(data.metrics);
    } catch {
      /* 推荐服务稍后重试 */
    }
  }, []);

  const player = usePlayer(tracks, {
    recommendItems: recs,
    previewSmart: filter.kind === "recommend",
    onListen: (report) => {
      void postListen(report).then(() => void refreshRecs(report.trackId));
    },
    pickSmartNext: (current, recent) => {
      const pool = recsRef.current.filter(
        (item) => item.track && item.id !== current.id && !recent.includes(item.id),
      );
      return pool[0]?.track ?? null;
    },
  });

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLibrary(refresh);
      setTracks(data.tracks);
      setMusicDir(data.musicDir);
    } catch (err) {
      setError(err instanceof Error ? err.message : "曲库加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (tracks.length === 0) return;
    void refreshRecs(player.current?.id ?? null);
  }, [tracks.length, player.current?.id, refreshRecs]);

  const artists = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) map.set(t.artist, (map.get(t.artist) || 0) + 1);
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  }, [tracks]);

  const albums = useMemo(() => {
    const map = new Map<string, { album: string; artist: string; count: number }>();
    for (const t of tracks) {
      const key = `${t.artist}|||${t.album}`;
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { album: t.album, artist: t.artist, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.album.localeCompare(b.album, "zh-CN"));
  }, [tracks]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracks.filter((t) => {
      if (filter.kind === "artist" && t.artist !== filter.artist) return false;
      if (filter.kind === "album" && (t.album !== filter.album || t.artist !== filter.artist)) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
      );
    });
  }, [tracks, filter, query]);

  const heading =
    filter.kind === "artist"
      ? filter.artist
      : filter.kind === "album"
        ? filter.album
        : filter.kind === "recommend"
          ? "为你推荐"
          : "全部歌曲";

  const sub =
    filter.kind === "album"
      ? filter.artist
      : filter.kind === "recommend"
        ? metrics?.trained
          ? `本地模型 · ${metrics.events} 条听歌记录`
          : "内容近邻冷启动 · 听得越多越准"
        : `${visible.length} 首${query ? " · 搜索结果" : ""}`;

  const playSmart = () => {
    player.setMode("smart");
    const first = recs[0]?.track || tracks[0];
    if (first) player.playTrack(first);
  };

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
            placeholder="搜索歌曲、歌手、专辑"
          />
        </label>

        <button className="ghost-btn" onClick={() => void load(true)} type="button">
          <IconRefresh size={16} />
          重新扫描
        </button>
      </header>

      <Sidebar
        artists={artists}
        albums={albums}
        filter={filter}
        onFilter={setFilter}
        musicDir={musicDir}
      />

      <main className="main">
        <div className="page-head">
          <div>
            <p className="kicker">
              {filter.kind === "all"
                ? "曲库"
                : filter.kind === "artist"
                  ? "歌手"
                  : filter.kind === "album"
                    ? "专辑"
                    : "机器学习"}
            </p>
            <h2>{heading}</h2>
            <p className="sub">{sub}</p>
          </div>
          {filter.kind !== "all" ? (
            <button className="ghost-btn" onClick={() => setFilter({ kind: "all" })} type="button">
              查看全部
            </button>
          ) : null}
        </div>

        {error ? <div className="empty error">{error}</div> : null}
        {loading && tracks.length === 0 ? <div className="empty">正在读取本地 FLAC…</div> : null}
        {!loading && tracks.length === 0 && !error ? (
          <div className="empty">
            没有找到音频文件。请把 FLAC 放到
            <code> ~/Desktop/music-resources </code>
            或修改 <code> config.json </code> 里的 <code>musicDir</code>。
          </div>
        ) : filter.kind === "recommend" ? (
          <RecommendPanel
            items={recs}
            metrics={metrics}
            currentId={player.current?.id ?? null}
            playing={player.playing}
            onPlay={player.playTrack}
            onPlaySmart={playSmart}
          />
        ) : (
          <TrackList
            tracks={visible}
            currentId={player.current?.id ?? null}
            playing={player.playing}
            onPlay={player.playTrack}
          />
        )}
      </main>

      <UpcomingPanel
        items={player.upcoming}
        mode={player.mode}
        smartPreview={filter.kind === "recommend"}
        hasCurrent={Boolean(player.current)}
        onPlay={(track) => {
          if (filter.kind === "recommend") player.setMode("smart");
          player.playTrack(track);
        }}
      />

      <PlayerBar
        current={player.current}
        playing={player.playing}
        currentTime={player.currentTime}
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
        levels={player.levels}
        onToggle={player.togglePlay}
        onNext={player.next}
        onPrev={player.prev}
        onSeek={player.seek}
        onSeekBy={player.seekBy}
        liked={Boolean(player.current && likes.includes(player.current.id))}
        onToggleLike={() => {
          const current = player.current;
          if (!current) return;
          const nextLiked = !likes.includes(current.id);
          void postFeedback(current.id, nextLiked).then(() => void refreshRecs(current.id));
        }}
      />
    </div>
  );
}
