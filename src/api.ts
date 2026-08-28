import type { LibraryResponse, ListenReport, RecommendResponse } from "./types";

export async function fetchLibrary(refresh = false): Promise<LibraryResponse> {
  const url = refresh ? "/api/library?refresh=1" : "/api/library";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("无法读取曲库");
  }
  return res.json();
}

export function streamUrl(id: string): string {
  return `/api/stream/${id}`;
}

export async function postListen(event: ListenReport): Promise<void> {
  await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "listen", ...event, ts: Date.now() }),
    keepalive: true,
  }).catch(() => undefined);
}

export async function postFeedback(trackId: string, liked: boolean): Promise<void> {
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, liked }),
  });
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
