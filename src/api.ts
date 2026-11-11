import type {
  HistoryPage,
  LibraryResponse,
  ListeningStats,
  ListenReport,
  LyricsResult,
  Playlist,
  RecommendResponse,
  StatsFilter,
  StatsRange,
} from "./types";

export async function fetchLibrary(): Promise<LibraryResponse> {
  const res = await fetch("/api/library");
  if (!res.ok) {
    throw new Error("无法读取曲库");
  }
  return res.json();
}

export async function rescanLibrary(): Promise<LibraryResponse> {
  const res = await fetch("/api/rescan", { method: "POST" });
  if (!res.ok) {
    throw new Error("重新扫描失败");
  }
  return res.json();
}

/** 曲库版本号：服务端监听到文件变化重扫后会递增。 */
export async function fetchLibraryVersion(): Promise<number | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: number };
    return typeof data.version === "number" ? data.version : null;
  } catch {
    return null;
  }
}

export function streamUrl(id: string): string {
  return `/api/stream/${id}`;
}

export function coverUrl(id: string): string {
  return `/api/cover/${id}`;
}

const LYRICS_CACHE_SIZE = 100;
const lyricsCache = new Map<string, Promise<LyricsResult>>();

/**
 * 歌词。同一首歌只请求一次（切歌时预取，打开歌词页时直接用）；
 * 出错或暂时连不上歌词库的结果不缓存，下次重新请求。refresh 让服务端忽略缓存重新查找。
 */
export function fetchLyrics(id: string, { refresh = false } = {}): Promise<LyricsResult> {
  const hit = refresh ? undefined : lyricsCache.get(id);
  if (hit) return hit;
  const job = fetch(`/api/lyrics/${id}${refresh ? "?refresh=1" : ""}`).then(async (res) => {
    if (!res.ok) throw new Error("歌词加载失败");
    return (await res.json()) as LyricsResult;
  });
  lyricsCache.delete(id);
  lyricsCache.set(id, job);
  if (lyricsCache.size > LYRICS_CACHE_SIZE) lyricsCache.delete(lyricsCache.keys().next().value!);
  job.then(
    (result) => {
      if (result.status === "error" && lyricsCache.get(id) === job) lyricsCache.delete(id);
    },
    () => {
      if (lyricsCache.get(id) === job) lyricsCache.delete(id);
    },
  );
  return job;
}

function setFilterParams(params: URLSearchParams, filter?: StatsFilter | null) {
  if (!filter) return;
  if ("trackId" in filter) params.set("track", filter.trackId);
  else if ("artist" in filter) params.set("artist", filter.artist);
  else {
    params.set("album", filter.album);
    params.set("albumArtist", filter.albumArtist);
  }
}

export async function fetchStats(range: StatsRange, filter?: StatsFilter | null): Promise<ListeningStats> {
  const params = new URLSearchParams({ range });
  setFilterParams(params, filter);
  const res = await fetch(`/api/stats?${params}`);
  if (!res.ok) throw new Error("统计加载失败");
  return res.json();
}

/** 听歌记录明细，新的在前；before 传上一页的 next 翻页。 */
export async function fetchHistory(opts: {
  from?: number;
  to?: number;
  before?: number | null;
  limit?: number;
  hideSkips?: boolean;
  filter?: StatsFilter | null;
}): Promise<HistoryPage> {
  const params = new URLSearchParams();
  if (opts.from != null) params.set("from", String(opts.from));
  if (opts.to != null) params.set("to", String(opts.to));
  if (opts.before != null) params.set("before", String(opts.before));
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.hideSkips) params.set("hideSkips", "1");
  setFilterParams(params, opts.filter);
  const res = await fetch(`/api/history?${params}`);
  if (!res.ok) throw new Error("听歌记录加载失败");
  return res.json();
}

async function jsonRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error("请求失败");
  return res.json();
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  const data = await jsonRequest<{ playlists: Playlist[] }>("/api/playlists", "GET");
  return data.playlists;
}

export async function createPlaylist(name: string, trackId?: string): Promise<Playlist> {
  const data = await jsonRequest<{ playlist: Playlist }>("/api/playlists", "POST", { name, trackId });
  return data.playlist;
}

export async function renamePlaylist(id: string, name: string): Promise<Playlist> {
  const data = await jsonRequest<{ playlist: Playlist }>(`/api/playlists/${id}`, "PATCH", { name });
  return data.playlist;
}

/** 整体替换歌单曲目（撤销"从歌单移除"时用，可以放回原位置）。 */
export async function setPlaylistTracks(id: string, trackIds: string[]): Promise<Playlist> {
  const data = await jsonRequest<{ playlist: Playlist }>(`/api/playlists/${id}`, "PATCH", { trackIds });
  return data.playlist;
}

export async function deletePlaylist(id: string): Promise<void> {
  await jsonRequest(`/api/playlists/${id}`, "DELETE");
}

/** 撤销删除：按原 ID 放回原来的位置。 */
export async function restorePlaylist(playlist: Playlist, index: number): Promise<Playlist> {
  const data = await jsonRequest<{ playlist: Playlist }>("/api/playlists/restore", "POST", { playlist, index });
  return data.playlist;
}

export async function addToPlaylist(id: string, trackId: string): Promise<Playlist> {
  const data = await jsonRequest<{ playlist: Playlist }>(`/api/playlists/${id}/tracks`, "POST", { trackId });
  return data.playlist;
}

export async function removeFromPlaylist(id: string, trackId: string): Promise<Playlist> {
  const data = await jsonRequest<{ playlist: Playlist }>(`/api/playlists/${id}/tracks/${trackId}`, "DELETE");
  return data.playlist;
}

export async function postListen(event: ListenReport): Promise<void> {
  await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "listen", ...event, ts: Date.now() }),
    keepalive: true,
  }).catch(() => undefined);
}

/** 喜欢 / 取消喜欢；标记不喜欢；或撤销"不喜欢"并恢复原来的喜欢状态。 */
export type Feedback = { liked: boolean } | { disliked: true } | { disliked: false; liked: boolean };

export async function postFeedback(trackId: string, feedback: Feedback): Promise<void> {
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, ...feedback }),
  });
}

export function formatDuration(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours >= 10) return `${hours.toFixed(1)} 小时`;
  const h = Math.floor(hours);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return h === 0 ? `${minutes} 分钟` : `${h} 小时 ${minutes} 分`;
}

export async function fetchRecommend(opts: {
  seed?: string | null;
  limit?: number;
  exclude?: string[];
} = {}): Promise<RecommendResponse> {
  const params = new URLSearchParams();
  if (opts.seed) params.set("seed", opts.seed);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.exclude?.length) params.set("exclude", opts.exclude.join(","));
  const res = await fetch(`/api/recommend?${params}`);
  if (!res.ok) throw new Error("推荐服务不可用");
  return res.json();
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatHiFi(track: { sampleRate: number; bitsPerSample: number }): string | null {
  if (!track.sampleRate || !track.bitsPerSample) return null;
  const khz = track.sampleRate % 1000 === 0
    ? `${track.sampleRate / 1000}`
    : (track.sampleRate / 1000).toFixed(1);
  return `${track.bitsPerSample}-bit / ${khz} kHz`;
}
