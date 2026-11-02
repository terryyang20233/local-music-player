import type {
  LibraryResponse,
  ListeningStats,
  ListenReport,
  Lyrics,
  Playlist,
  RecommendResponse,
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

export async function fetchLyrics(id: string, signal?: AbortSignal): Promise<Lyrics | null> {
  const res = await fetch(`/api/lyrics/${id}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("歌词加载失败");
  return res.json();
}

export async function fetchStats(): Promise<ListeningStats> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("统计加载失败");
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

export async function deletePlaylist(id: string): Promise<void> {
  await jsonRequest(`/api/playlists/${id}`, "DELETE");
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

export async function postFeedback(trackId: string, feedback: { liked: boolean } | { disliked: true }): Promise<void> {
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
