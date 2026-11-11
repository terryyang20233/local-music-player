import { labelFromListen } from "./recommend.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RANGES = ["7d", "30d", "90d", "year", "all"];
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

const pad = (n) => String(n).padStart(2, "0");

/** 本地日期 "2026-11-03"。服务跑在用户自己的机器上，本地时区就是用户的时区。 */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 用日期运算而不是加减 24 小时，跨夏令时也对得上。 */
function addDays(ts, days) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/**
 * 一条收听记录的结果，和推荐模型的标签同一套标准：
 * completed 完播 / most 听了大半 / partial 听了一部分 / skipped 跳过（不到 22% 且不到 25 秒）。
 * "播放次数"不算跳过，免得切歌时一闪而过的记录把排行冲乱。
 */
export function outcomeOf(event) {
  const label = labelFromListen(event);
  if (label === 1) return "completed";
  if (label === 0) return "skipped";
  if (label === 0.7) return "most";
  return "partial";
}

const isListen = (e) => Boolean(e?.trackId) && (!e.type || e.type === "listen") && Number.isFinite(e.ts);

/** 范围名换成 [from, to)：from 对齐到当天 0 点，to 是明天 0 点。 */
export function resolveRange(range, { now = Date.now(), firstListen = null } = {}) {
  const key = RANGES.includes(range) ? range : "30d";
  const to = addDays(startOfDay(now), 1);
  let from;
  if (key === "all") from = startOfDay(firstListen ?? now);
  else if (key === "year") from = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  else from = addDays(startOfDay(now), -(RANGE_DAYS[key] - 1));
  return { range: key, from, to };
}

/** 时间轴的粒度：四个月以内按天，两年多以内按周，再长按月。 */
function unitFor(from, to) {
  const days = Math.round((to - from) / DAY_MS);
  if (days <= 120) return "day";
  if (days <= 800) return "week";
  return "month";
}

function bucketStart(ts, unit) {
  const d = new Date(ts);
  if (unit === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const day = startOfDay(ts);
  // 一周从周一开始
  return unit === "week" ? addDays(day, -((new Date(day).getDay() + 6) % 7)) : day;
}

function nextBucket(start, unit) {
  if (unit === "month") {
    const d = new Date(start);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  }
  return addDays(start, unit === "week" ? 7 : 1);
}

/** 统计范围：某首歌、某位歌手或某张专辑；不传就是全部。 */
function makeFilter(filter, byId) {
  if (!filter) return () => true;
  if (filter.trackId) return (e) => e.trackId === filter.trackId;
  if (typeof filter.artist === "string") return (e) => byId.get(e.trackId)?.artist === filter.artist;
  if (typeof filter.album === "string") {
    return (e) => {
      const t = byId.get(e.trackId);
      return Boolean(t) && t.album === filter.album && t.albumArtist === (filter.albumArtist ?? t.albumArtist);
    };
  }
  return () => true;
}

const byPlays = (a, b) => b.plays - a.plays || b.seconds - a.seconds;
const roundSeconds = (row) => ({ ...row, seconds: Math.round(row.seconds) });

/**
 * 听歌统计。range: 7d / 30d / 90d / year / all；filter 见 makeFilter。
 * 返回总量、时间轴（按天 / 周 / 月）、一天中的时段和星期分布、歌曲 / 歌手 / 专辑排行和最常跳过的歌。
 */
export function listeningStats(events, tracks, { range = "30d", filter = null, now = Date.now(), top = 50 } = {}) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const match = makeFilter(filter, byId);
  const all = events.filter((e) => isListen(e) && match(e));

  let firstListen = null;
  let lastListen = null;
  for (const e of all) {
    if (firstListen == null || e.ts < firstListen) firstListen = e.ts;
    if (lastListen == null || e.ts > lastListen) lastListen = e.ts;
  }

  const { range: key, from, to } = resolveRange(range, { now, firstListen });
  const unit = unitFor(from, to);
  const timeline = [];
  for (let start = bucketStart(from, unit); start < to; start = nextBucket(start, unit)) {
    timeline.push({ start: Math.max(start, from), end: Math.min(nextBucket(start, unit), to), plays: 0, skips: 0, seconds: 0 });
  }
  const bucketAt = (ts) => {
    let lo = 0;
    let hi = timeline.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ts < timeline[mid].start) hi = mid - 1;
      else if (ts >= timeline[mid].end) lo = mid + 1;
      else return timeline[mid];
    }
    return null;
  };

  const hours = Array.from({ length: 24 }, () => ({ plays: 0, seconds: 0 }));
  const weekdays = Array.from({ length: 7 }, () => ({ plays: 0, seconds: 0 }));
  const trackRows = new Map();
  const artistRows = new Map();
  const albumRows = new Map();
  const activeDays = new Set();
  let listens = 0;
  let plays = 0;
  let skips = 0;
  let completed = 0;
  let seconds = 0;

  for (const e of all) {
    if (e.ts < from || e.ts >= to) continue;
    const outcome = outcomeOf(e);
    const skipped = outcome === "skipped";
    const secs = Number(e.seconds) || 0;
    listens += 1;
    seconds += secs;
    if (skipped) skips += 1;
    else plays += 1;
    if (outcome === "completed" || outcome === "most") completed += 1;

    const bucket = bucketAt(e.ts);
    if (bucket) {
      if (skipped) bucket.skips += 1;
      else bucket.plays += 1;
      bucket.seconds += secs;
    }

    let row = trackRows.get(e.trackId);
    if (!row) {
      row = { id: e.trackId, plays: 0, skips: 0, completed: 0, seconds: 0, lastPlayed: 0 };
      trackRows.set(e.trackId, row);
    }
    row.seconds += secs;
    row.lastPlayed = Math.max(row.lastPlayed, e.ts);
    if (skipped) row.skips += 1;
    else row.plays += 1;
    if (outcome === "completed" || outcome === "most") row.completed += 1;

    if (skipped) continue;
    const d = new Date(e.ts);
    hours[d.getHours()].plays += 1;
    hours[d.getHours()].seconds += secs;
    weekdays[(d.getDay() + 6) % 7].plays += 1;
    weekdays[(d.getDay() + 6) % 7].seconds += secs;
    activeDays.add(dayKey(e.ts));

    const track = byId.get(e.trackId);
    if (!track) continue;
    let artist = artistRows.get(track.artist);
    if (!artist) {
      artist = { artist: track.artist, plays: 0, seconds: 0, tracks: new Set() };
      artistRows.set(track.artist, artist);
    }
    artist.plays += 1;
    artist.seconds += secs;
    artist.tracks.add(track.id);

    const albumKey = `${track.albumArtist}\u0000${track.album}`;
    let album = albumRows.get(albumKey);
    if (!album) {
      album = { album: track.album, artist: track.albumArtist, plays: 0, seconds: 0, coverId: null };
      albumRows.set(albumKey, album);
    }
    album.plays += 1;
    album.seconds += secs;
    if (!album.coverId && track.hasCover) album.coverId = track.id;
  }

  const rows = [...trackRows.values()].filter((r) => byId.has(r.id));
  const played = rows.filter((r) => r.plays > 0);

  return {
    range: key,
    from,
    to,
    unit,
    totals: {
      listens,
      plays,
      skips,
      completed,
      seconds: Math.round(seconds),
      completionRate: listens ? completed / listens : 0,
      skipRate: listens ? skips / listens : 0,
      distinctTracks: played.length,
      distinctArtists: artistRows.size,
      activeDays: activeDays.size,
    },
    firstListen,
    lastListen,
    timeline: timeline.map(roundSeconds),
    hours: hours.map(roundSeconds),
    weekdays: weekdays.map(roundSeconds),
    topTracks: played.sort(byPlays).slice(0, top).map(roundSeconds),
    topArtists: [...artistRows.values()]
      .sort(byPlays)
      .slice(0, top)
      .map(({ tracks: ids, ...row }) => roundSeconds({ ...row, tracks: ids.size })),
    topAlbums: [...albumRows.values()].sort(byPlays).slice(0, top).map(roundSeconds),
    mostSkipped: rows
      .filter((r) => r.skips >= 2)
      .sort((a, b) => b.skips - a.skips || a.plays - b.plays)
      .slice(0, 20)
      .map(roundSeconds),
  };
}

/**
 * 听歌记录明细，新的在前。from / to 限定时间，before 用来翻页（传上一页最后一条的时间）。
 * hideSkips 隐藏跳过的记录。total 是不分页时的总条数。
 */
export function listeningHistory(
  events,
  tracks,
  { from = -Infinity, to = Infinity, filter = null, before = null, limit = 50, hideSkips = false } = {},
) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const match = makeFilter(filter, byId);
  const rows = [];
  for (const e of events) {
    if (!isListen(e) || e.ts < from || e.ts >= to || !match(e)) continue;
    const outcome = outcomeOf(e);
    if (hideSkips && outcome === "skipped") continue;
    rows.push({
      ts: e.ts,
      trackId: e.trackId,
      seconds: Math.round((Number(e.seconds) || 0) * 10) / 10,
      duration: Math.round((Number(e.duration) || 0) * 10) / 10,
      progress: Number(e.progress) || 0,
      outcome,
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  const page = before == null ? rows : rows.filter((r) => r.ts < before);
  const items = page.slice(0, limit);
  return { items, total: rows.length, next: page.length > limit ? items[items.length - 1].ts : null };
}
