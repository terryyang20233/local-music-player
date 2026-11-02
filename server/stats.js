import { labelFromListen } from "./recommend.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 听歌统计：总量、最近 30 天每天的播放数、最常听的歌手和歌曲。 */
export function listeningStats(events, tracks, { now = Date.now(), days = 30, top = 10 } = {}) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const listens = events.filter((e) => e.trackId && (!e.type || e.type === "listen"));

  let seconds = 0;
  let completed = 0;
  let skipped = 0;
  const trackPlays = new Map();
  const artistPlays = new Map();
  const perDay = new Map();
  const since = now - days * DAY_MS;

  for (const e of listens) {
    seconds += Number(e.seconds) || 0;
    const label = labelFromListen(e);
    if (label != null && label >= 0.7) completed += 1;
    if (label === 0) skipped += 1;
    trackPlays.set(e.trackId, (trackPlays.get(e.trackId) || 0) + 1);
    const track = byId.get(e.trackId);
    if (track) artistPlays.set(track.artist, (artistPlays.get(track.artist) || 0) + 1);
    if (e.ts >= since) perDay.set(dayKey(e.ts), (perDay.get(dayKey(e.ts)) || 0) + 1);
  }

  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(now - i * DAY_MS);
    daily.push({ day: key, plays: perDay.get(key) || 0 });
  }

  const topTracks = [...trackPlays.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([id, plays]) => ({ id, plays }));
  const topArtists = [...artistPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([artist, plays]) => ({ artist, plays }));

  return {
    totalPlays: listens.length,
    totalSeconds: Math.round(seconds),
    completionRate: listens.length ? completed / listens.length : 0,
    skipRate: listens.length ? skipped / listens.length : 0,
    distinctTracks: trackPlays.size,
    firstListen: listens.length ? Math.min(...listens.map((e) => e.ts)) : null,
    daily,
    topTracks,
    topArtists,
  };
}
