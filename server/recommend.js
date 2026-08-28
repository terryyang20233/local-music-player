import fs from "node:fs";
import path from "node:path";
import {
  Item2Vec,
  LogisticRegression,
  cosine,
  hashInto,
  zeros,
} from "./ml.js";

const ARTIST_DIM = 12;
const ALBUM_DIM = 8;
const NUMERIC_DIM = 4;
const AFFINITY_DIM = 4;
const BEHAVIOR_DIM = 4;
const CONTEXT_DIM = 3;
export const FEATURE_DIM =
  ARTIST_DIM + ALBUM_DIM + NUMERIC_DIM + AFFINITY_DIM + BEHAVIOR_DIM + CONTEXT_DIM;

const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_EVENTS = 2500;

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function labelFromListen(event) {
  if (event.type === "like") return 1;
  if (event.type === "dislike") return 0;
  const progress = clamp01(event.progress);
  if (event.reason === "ended" || progress >= 0.8) return 1;
  if (progress < 0.22 && (event.seconds || 0) < 25) return 0;
  if (progress >= 0.55) return 0.7;
  return null;
}

export class Recommender {
  constructor(dataDir) {
    this.dataPath = path.join(dataDir, "listens.json");
    this.events = [];
    this.likes = {};
    this.model = new LogisticRegression(FEATURE_DIM);
    this.item2vec = new Item2Vec(16);
    this.metrics = { trained: false, positives: 0, negatives: 0, loss: 0, events: 0 };
    this.#load();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
      this.events = Array.isArray(raw.events) ? raw.events : [];
      this.likes = raw.likes && typeof raw.likes === "object" ? raw.likes : {};
    } catch {
      this.events = [];
      this.likes = {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    fs.writeFileSync(
      this.dataPath,
      JSON.stringify({ events: this.events.slice(-MAX_EVENTS), likes: this.likes }, null, 2),
    );
  }

  record(event) {
    const row = {
      type: event.type || "listen",
      trackId: event.trackId,
      progress: clamp01(Number(event.progress) || 0),
      seconds: Number(event.seconds) || 0,
      duration: Number(event.duration) || 0,
      reason: event.reason || "unknown",
      ts: Number(event.ts) || Date.now(),
    };
    if (!row.trackId) return this.metrics;
    this.events.push(row);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    this.save();
    return this.metrics;
  }

  setLike(trackId, liked) {
    if (!trackId) return;
    if (liked) this.likes[trackId] = Date.now();
    else delete this.likes[trackId];
    this.record({
      type: liked ? "like" : "dislike",
      trackId,
      progress: liked ? 1 : 0,
      seconds: 0,
      duration: 0,
      reason: "feedback",
      ts: Date.now(),
    });
  }

  #stats(tracks) {
    const byTrack = new Map();
    const byArtist = new Map();
    const byAlbum = new Map();
    const artistOf = new Map(tracks.map((t) => [t.id, t.artist]));
    const albumOf = new Map(tracks.map((t) => [t.id, t.album]));

    const bump = (map, key, field) => {
      if (!key) return;
      const row = map.get(key) || { play: 0, complete: 0, skip: 0, last: 0 };
      row[field] += 1;
      map.set(key, row);
    };

    for (const event of this.events) {
      const label = labelFromListen(event);
      const stats = byTrack.get(event.trackId) || {
        play: 0,
        complete: 0,
        skip: 0,
        last: 0,
      };
      stats.play += 1;
      stats.last = Math.max(stats.last, event.ts || 0);
      if (label === 1 || label === 0.7) stats.complete += 1;
      if (label === 0) stats.skip += 1;
      byTrack.set(event.trackId, stats);

      const artist = artistOf.get(event.trackId);
      const album = albumOf.get(event.trackId);
      bump(byArtist, artist, "play");
      bump(byAlbum, album, "play");
      if (label === 1 || label === 0.7) {
        bump(byArtist, artist, "complete");
        bump(byAlbum, album, "complete");
      }
      if (label === 0) {
        bump(byArtist, artist, "skip");
        bump(byAlbum, album, "skip");
      }
      const a = byArtist.get(artist);
      const b = byAlbum.get(album);
      if (a) a.last = Math.max(a.last, event.ts || 0);
      if (b) b.last = Math.max(b.last, event.ts || 0);
    }

    for (const id of Object.keys(this.likes)) {
      const stats = byTrack.get(id) || { play: 0, complete: 0, skip: 0, last: 0 };
      stats.complete += 2;
      stats.last = Math.max(stats.last, this.likes[id]);
      byTrack.set(id, stats);
    }

    const totalPlays = [...byArtist.values()].reduce((s, r) => s + r.play, 0) || 1;
    return { byTrack, byArtist, byAlbum, totalPlays };
  }

  contentVector(track) {
    const v = zeros(ARTIST_DIM + ALBUM_DIM + NUMERIC_DIM);
    hashInto(v, 0, ARTIST_DIM, track.artist || "", "artist");
    hashInto(v, ARTIST_DIM, ALBUM_DIM, track.album || "", "album");
    const d = Number(track.duration) || 0;
    const off = ARTIST_DIM + ALBUM_DIM;
    v[off] = Math.min(d / 420, 1.5);
    v[off + 1] = Math.log1p(d) / 7;
    v[off + 2] = (Number(track.sampleRate) || 44100) / 96000;
    v[off + 3] = (Number(track.bitsPerSample) || 16) / 24;
    return v;
  }

  featureVector(track, stats, now = Date.now()) {
    const x = zeros(FEATURE_DIM);
    const content = this.contentVector(track);
    x.set(content, 0);

    const tStats = stats.byTrack.get(track.id) || { play: 0, complete: 0, skip: 0, last: 0 };
    const aStats = stats.byArtist.get(track.artist) || { play: 0, complete: 0, skip: 0, last: 0 };
    const alStats = stats.byAlbum.get(track.album) || { play: 0, complete: 0, skip: 0, last: 0 };

    let i = ARTIST_DIM + ALBUM_DIM + NUMERIC_DIM;
    x[i++] = aStats.play ? aStats.complete / aStats.play : 0.35;
    x[i++] = alStats.play ? alStats.complete / alStats.play : 0.35;
    x[i++] = aStats.play / Math.max(1, stats.totalPlays);
    x[i++] = tStats.play === 0 ? 1 : 0;

    x[i++] = Math.min(tStats.play / 8, 1.5);
    x[i++] = tStats.play ? tStats.skip / tStats.play : 0;
    x[i++] = tStats.play ? tStats.complete / tStats.play : 0;
    const hours = tStats.last ? (now - tStats.last) / 3600000 : 72;
    x[i++] = Math.exp(-hours / 36);

    const date = new Date(now);
    const hour = date.getHours();
    x[i++] = Math.sin((2 * Math.PI * hour) / 24);
    x[i++] = Math.cos((2 * Math.PI * hour) / 24);
    x[i++] = date.getDay() === 0 || date.getDay() === 6 ? 1 : 0;
    return x;
  }

  #sessions() {
    const plays = this.events
      .filter((e) => e.type !== "dislike")
      .sort((a, b) => a.ts - b.ts);
    const sessions = [];
    let current = [];
    let lastTs = 0;
    let lastId = null;
    for (const event of plays) {
      if (!event.trackId) continue;
      if (current.length && event.ts - lastTs > SESSION_GAP_MS) {
        if (current.length >= 2) sessions.push(current);
        current = [];
        lastId = null;
      }
      if (event.trackId !== lastId) current.push(event.trackId);
      lastId = event.trackId;
      lastTs = event.ts;
    }
    if (current.length >= 2) sessions.push(current);
    return sessions;
  }

  train(tracks) {
    const stats = this.#stats(tracks);
    const samples = [];
    for (const event of this.events) {
      const track = tracks.find((t) => t.id === event.trackId);
      if (!track) continue;
      const y = labelFromListen(event);
      if (y == null) continue;
      samples.push({ x: this.featureVector(track, stats, event.ts), y: y >= 0.7 ? 1 : 0 });
    }

    const positives = samples.filter((s) => s.y === 1).length;
    const negatives = samples.filter((s) => s.y === 0).length;

    if (positives > 0 && negatives === 0) {
      const likedArtists = new Set(
        this.events
          .filter((e) => labelFromListen(e) === 1)
          .map((e) => tracks.find((t) => t.id === e.trackId)?.artist)
          .filter(Boolean),
      );
      const unused = tracks.filter((t) => !likedArtists.has(t.artist)).slice(0, 8);
      for (const track of unused) {
        samples.push({ x: this.featureVector(track, stats), y: 0 });
      }
    }

    this.model = new LogisticRegression(FEATURE_DIM);
    let loss = 0;
    if (samples.length >= 3 && samples.some((s) => s.y === 1) && samples.some((s) => s.y === 0)) {
      ({ loss } = this.model.fit(samples, 80));
    }

    this.item2vec = new Item2Vec(16);
    this.item2vec.trainSessions(this.#sessions());

    this.metrics = {
      trained: samples.length >= 3,
      positives,
      negatives: samples.filter((s) => s.y === 0).length,
      loss: Number(loss.toFixed(4)),
      events: this.events.length,
      likes: Object.keys(this.likes).length,
    };
    return this.metrics;
  }

  recommend(tracks, { seedId = null, exclude = [], limit = 12 } = {}) {
    const stats = this.#stats(tracks);
    this.train(tracks);
    const now = Date.now();
    const seed = tracks.find((t) => t.id === seedId) || null;
    const seedContent = seed ? this.contentVector(seed) : null;

    const completedIds = this.events.filter((e) => labelFromListen(e) === 1).map((e) => e.trackId);
    const userEmb = zeros(this.item2vec.dim);
    let embCount = 0;
    for (const id of completedIds) {
      const v = this.item2vec.vectors.get(id);
      if (!v) continue;
      for (let i = 0; i < v.length; i += 1) userEmb[i] += v[i];
      embCount += 1;
    }
    if (embCount) {
      for (let i = 0; i < userEmb.length; i += 1) userEmb[i] /= embCount;
    }

    const excluded = new Set(exclude);
    if (seed) excluded.add(seed.id);

    const scored = tracks
      .filter((t) => !excluded.has(t.id))
      .map((track) => {
        const x = this.featureVector(track, stats, now);
        const pLike = this.metrics.trained ? this.model.predict(x) : 0.5;
        const contentSim = seedContent ? clamp01((cosine(seedContent, this.contentVector(track)) + 1) / 2) : 0.5;
        const itemVec = this.item2vec.vectors.get(track.id);
        const seqSim = embCount && itemVec ? clamp01((cosine(userEmb, itemVec) + 1) / 2) : 0.5;
        const tStats = stats.byTrack.get(track.id) || { play: 0, skip: 0 };
        const novelty = tStats.play === 0 ? 0.08 : 0;
        const fatigue = Math.min(tStats.play, 6) * 0.03;
        const likeBoost = this.likes[track.id] ? 0.12 : 0;
        const score = 0.46 * pLike + 0.24 * seqSim + 0.22 * contentSim + novelty + likeBoost - fatigue;
        return { track, pLike, contentSim, seqSim, score };
      })
      .sort((a, b) => b.score - a.score);

    const picked = [];
    while (picked.length < limit && scored.length) {
      let bestIdx = 0;
      let bestVal = -Infinity;
      for (let i = 0; i < scored.length; i += 1) {
        const cand = scored[i];
        let overlap = 0;
        for (const prev of picked) {
          overlap = Math.max(overlap, clamp01((cosine(this.contentVector(prev.track), this.contentVector(cand.track)) + 1) / 2));
        }
        const mmr = 0.72 * cand.score - 0.28 * overlap;
        if (mmr > bestVal) {
          bestVal = mmr;
          bestIdx = i;
        }
      }
      picked.push(scored.splice(bestIdx, 1)[0]);
    }

    return {
      metrics: this.metrics,
      items: picked.map((row) => ({
        id: row.track.id,
        score: Number(row.score.toFixed(4)),
        pLike: Number(row.pLike.toFixed(4)),
        reason: this.#reason(row, seed),
      })),
    };
  }

  #reason(row, seed) {
    const pct = Math.round(row.pLike * 100);
    if (seed && row.track.artist === seed.artist && row.contentSim > 0.55) {
      return `同一歌手 · ${row.track.artist}`;
    }
    if (row.seqSim > 0.62 && this.metrics.positives >= 3) {
      return seed ? `常和《${seed.title}》连着听` : "和你最近的听歌序列相近";
    }
    if (this.metrics.trained && row.pLike >= 0.58) {
      return `口味匹配 ${pct}%`;
    }
    if (seed) return `和《${seed.title}》内容相近`;
    return this.metrics.trained ? `口味匹配 ${pct}%` : "先听几首，模型会跟上你的口味";
  }

  nextTrack(tracks, { seedId, exclude = [] } = {}) {
    const rec = this.recommend(tracks, { seedId, exclude, limit: 6 });
    return rec.items[0] || null;
  }
}
