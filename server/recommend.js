import path from "node:path";
import {
  Item2Vec,
  LogisticRegression,
  cosine,
  fnv1a,
  hashInto,
  mulberry32,
  zeros,
} from "./ml.js";
import { readJson, writeJsonAtomic } from "./store.js";

const ARTIST_DIM = 32;
const ALBUM_DIM = 16;
const GENRE_DIM = 8;
const NUMERIC_DIM = 4;
const CONTENT_DIM = ARTIST_DIM + ALBUM_DIM + GENRE_DIM + NUMERIC_DIM;
const AFFINITY_DIM = 4;
const BEHAVIOR_DIM = 4;
// 不再放"几点钟 / 是否周末"这类情境特征：线性模型里它们对所有候选曲都一样，不影响排序
export const FEATURE_DIM = CONTENT_DIM + AFFINITY_DIM + BEHAVIOR_DIM;

/** 音频格式参数和口味关系不大，降低它们在内容相似度里的分量。 */
const NUMERIC_WEIGHT = 0.35;
const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_EVENTS = 10000;
const EVENT_TYPES = new Set(["listen", "like", "unlike", "dislike"]);
const MAX_CLASS_WEIGHT = 5;

/**
 * 打分权重。由 `npm run eval` 的离线评估（hit@10）辅助选定：
 * 偏好、序列、热度和内容四项加权，再减去"刚听过"的疲劳度。
 */
export const WEIGHTS = {
  pref: 0.2,
  seq: 0.5,
  pop: 0.15,
  content: 0.1,
  recent: 0.3,
  like: 0.12,
  dislike: 0.6,
  novelty: 0.02,
};
/** 刚听过的歌按这个时间常数（小时）衰减疲劳度。 */
const RECENT_HALF_HOURS = 6;

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function labelFromListen(event) {
  if (event.type === "like") return 1;
  if (event.type === "dislike") return 0;
  if (event.type && event.type !== "listen") return null;
  const progress = clamp01(event.progress);
  // progress 是实际收听时长占比；拖到结尾触发的 ended 不算完播
  if (progress >= 0.8 || (event.reason === "ended" && progress >= 0.5)) return 1;
  if (progress < 0.22 && (event.seconds || 0) < 25) return 0;
  if (progress >= 0.55) return 0.7;
  return null;
}

const emptyRow = () => ({ play: 0, complete: 0, skip: 0, last: 0 });

/** 按歌曲 / 歌手 / 专辑累计的收听统计。只统计真实收听，不含喜欢、取消喜欢等反馈事件。 */
export class ListenStats {
  constructor(tracks) {
    this.tracksById = new Map(tracks.map((t) => [t.id, t]));
    this.byTrack = new Map();
    this.byArtist = new Map();
    this.byAlbum = new Map();
    this.totalPlays = 0;
    this.maxTrackPlays = 0;
  }

  add(event) {
    if (!event.trackId || (event.type && event.type !== "listen")) return;
    const label = labelFromListen(event);
    const track = this.tracksById.get(event.trackId);
    const ts = event.ts || 0;
    const rows = [[this.byTrack, event.trackId]];
    if (track) {
      rows.push([this.byArtist, track.artist], [this.byAlbum, track.album]);
      this.totalPlays += 1;
    }
    for (const [map, key] of rows) {
      const row = map.get(key) || emptyRow();
      row.play += 1;
      if (label != null && label >= 0.7) row.complete += 1;
      if (label === 0) row.skip += 1;
      row.last = Math.max(row.last, ts);
      map.set(key, row);
    }
    const trackRow = this.byTrack.get(event.trackId);
    if (trackRow.play > this.maxTrackPlays) this.maxTrackPlays = trackRow.play;
  }
}

/** 把听歌记录按 30 分钟空档切成 session，返回曲目 ID 序列（去掉连续重复）。 */
export function splitSessions(events) {
  const plays = events
    .filter((e) => e.trackId && (!e.type || e.type === "listen"))
    .sort((a, b) => a.ts - b.ts);
  const sessions = [];
  let current = [];
  let lastTs = 0;
  for (const event of plays) {
    if (current.length && event.ts - lastTs > SESSION_GAP_MS) {
      if (current.length >= 2) sessions.push(current);
      current = [];
    }
    if (current[current.length - 1] !== event.trackId) current.push(event.trackId);
    lastTs = event.ts;
  }
  if (current.length >= 2) sessions.push(current);
  return sessions;
}

/** 一阶转移计数：A 之后紧接着（或隔一首）听了 B 的次数。 */
function buildTransitions(sessions) {
  const trans = new Map();
  const bump = (from, to, w) => {
    if (from === to) return;
    let row = trans.get(from);
    if (!row) {
      row = { total: 0, next: new Map() };
      trans.set(from, row);
    }
    row.total += w;
    row.next.set(to, (row.next.get(to) || 0) + w);
  };
  for (const seq of sessions) {
    for (let i = 0; i < seq.length - 1; i += 1) {
      bump(seq[i], seq[i + 1], 1);
      if (i + 2 < seq.length) bump(seq[i], seq[i + 2], 0.5);
    }
  }
  return trans;
}

export class Recommender {
  /** dataDir 为 null 时只在内存里运行，不读写文件（离线评估用）。 */
  constructor(dataDir) {
    this.dataPath = dataDir ? path.join(dataDir, "listens.json") : null;
    this.model = new LogisticRegression(FEATURE_DIM);
    this.item2vec = new Item2Vec(16);
    this.transitions = new Map();
    this.metrics = { trained: false, positives: 0, negatives: 0, loss: 0, events: 0, likes: 0 };
    // 模型只在有新反馈或曲库变化后才重训，推荐请求直接复用
    this.dirty = true;
    this.trainedTracks = null;
    this.stats = null;
    this.contentCache = new Map();
    const raw = this.dataPath ? readJson(this.dataPath, {}) : {};
    this.events = Array.isArray(raw.events) ? raw.events : [];
    this.likes = raw.likes && typeof raw.likes === "object" ? raw.likes : {};
    this.dislikes = raw.dislikes && typeof raw.dislikes === "object" ? raw.dislikes : {};
  }

  save() {
    if (!this.dataPath) return;
    writeJsonAtomic(this.dataPath, {
      events: this.events.slice(-MAX_EVENTS),
      likes: this.likes,
      dislikes: this.dislikes,
    });
  }

  record(event) {
    const now = Date.now();
    const row = {
      type: EVENT_TYPES.has(event.type) ? event.type : "listen",
      trackId: typeof event.trackId === "string" ? event.trackId : null,
      progress: clamp01(Number(event.progress) || 0),
      seconds: Math.max(0, Number(event.seconds) || 0),
      duration: Math.max(0, Number(event.duration) || 0),
      reason: typeof event.reason === "string" ? event.reason.slice(0, 32) : "unknown",
      ts: Math.min(Number(event.ts) || now, now),
    };
    if (!row.trackId) return;
    this.events.push(row);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    this.dirty = true;
    this.save();
  }

  /**
   * 把听歌记录里的旧 ID 换成新 ID（ID 规则升级后调用）。
   * idMap: Map(oldId → newId)。返回改写的条目数；没有改动时不写盘。
   */
  migrateIds(idMap) {
    let changed = 0;
    for (const event of this.events) {
      const next = idMap.get(event.trackId);
      if (next && next !== event.trackId) {
        event.trackId = next;
        changed += 1;
      }
    }
    for (const map of [this.likes, this.dislikes]) {
      for (const [oldId, ts] of Object.entries(map)) {
        const next = idMap.get(oldId);
        if (next && next !== oldId) {
          delete map[oldId];
          map[next] = Math.max(map[next] || 0, ts);
          changed += 1;
        }
      }
    }
    if (changed) {
      this.dirty = true;
      this.save();
    }
    return changed;
  }

  /** 喜欢 / 取消喜欢。喜欢会清掉"不喜欢"。 */
  setLike(trackId, liked) {
    if (!trackId) return;
    if (liked) {
      this.likes[trackId] = Date.now();
      delete this.dislikes[trackId];
    } else {
      delete this.likes[trackId];
    }
    // 取消喜欢只是撤销，不等于"不喜欢"，记为中性事件
    this.record({ type: liked ? "like" : "unlike", trackId, progress: liked ? 1 : 0, reason: "feedback" });
  }

  /** 明确的"不喜欢"：作为负样本，并在推荐里大幅降权。 */
  setDislike(trackId) {
    if (!trackId) return;
    this.dislikes[trackId] = Date.now();
    delete this.likes[trackId];
    this.record({ type: "dislike", trackId, progress: 0, reason: "feedback" });
  }

  /** 撤销"不喜欢"。之前记下的 dislike 事件会因为不在 dislikes 里而不再当样本。 */
  clearDislike(trackId) {
    if (!trackId || !this.dislikes[trackId]) return;
    delete this.dislikes[trackId];
    this.dirty = true;
    this.save();
  }

  /** 训练标签；已经撤销的"喜欢 / 不喜欢"不再当样本。 */
  #label(event) {
    if (event.type === "like" && !this.likes[event.trackId]) return null;
    if (event.type === "dislike" && !this.dislikes[event.trackId]) return null;
    return labelFromListen(event);
  }

  contentVector(track) {
    const cached = this.contentCache.get(track.id);
    if (cached) return cached;
    const v = zeros(CONTENT_DIM);
    hashInto(v, 0, ARTIST_DIM, track.artist || "", "artist");
    hashInto(v, ARTIST_DIM, ALBUM_DIM, `${track.albumArtist || track.artist}|${track.album || ""}`, "album");
    if (track.genre) hashInto(v, ARTIST_DIM + ALBUM_DIM, GENRE_DIM, track.genre.toLowerCase(), "genre");
    const d = Number(track.duration) || 0;
    const off = ARTIST_DIM + ALBUM_DIM + GENRE_DIM;
    v[off] = NUMERIC_WEIGHT * Math.min(d / 420, 1.5);
    v[off + 1] = NUMERIC_WEIGHT * (Math.log1p(d) / 7);
    v[off + 2] = NUMERIC_WEIGHT * ((Number(track.sampleRate) || 44100) / 96000);
    v[off + 3] = NUMERIC_WEIGHT * ((Number(track.bitsPerSample) || 16) / 24);
    this.contentCache.set(track.id, v);
    return v;
  }

  featureVector(track, stats, now = Date.now()) {
    const x = zeros(FEATURE_DIM);
    x.set(this.contentVector(track), 0);

    const tStats = stats.byTrack.get(track.id) || emptyRow();
    const aStats = stats.byArtist.get(track.artist) || emptyRow();
    const alStats = stats.byAlbum.get(track.album) || emptyRow();

    let i = CONTENT_DIM;
    x[i++] = aStats.play ? aStats.complete / aStats.play : 0.35;
    x[i++] = alStats.play ? alStats.complete / alStats.play : 0.35;
    x[i++] = aStats.play / Math.max(1, stats.totalPlays);
    x[i++] = tStats.play === 0 ? 1 : 0;

    x[i++] = Math.min(tStats.play / 8, 1.5);
    x[i++] = tStats.play ? tStats.skip / tStats.play : 0;
    x[i++] = tStats.play ? tStats.complete / tStats.play : 0;
    const hours = tStats.last ? Math.max(0, (now - tStats.last) / 3600000) : 72;
    x[i++] = Math.exp(-hours / 36);
    return x;
  }

  train(tracks) {
    // 固定随机种子：同样的听歌记录训练出同样的模型，推荐列表不会无故抖动
    const rng = mulberry32(fnv1a(`${this.events.length}|${tracks.length}`));

    // 按时间顺序回放：每条样本只用它之前的统计量，避免把未来和标签本身泄漏进特征
    const stats = new ListenStats(tracks);
    const byId = stats.tracksById;
    /** @type {{ x: Float64Array, y: number, w?: number }[]} */
    const samples = [];
    const ordered = [...this.events].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const event of ordered) {
      const track = byId.get(event.trackId);
      const y = track ? this.#label(event) : null;
      // 0.7 的"弱正样本"直接作为软标签参与训练
      if (y != null) samples.push({ x: this.featureVector(track, stats, event.ts), y });
      stats.add(event);
    }

    const positives = samples.filter((s) => s.y >= 0.5).length;

    if (positives > 0 && positives === samples.length) {
      // 只有正样本时，从没听过的歌手里随机抽几首当负样本，避免模型塌成全 1
      const heardArtists = new Set(ordered.map((e) => byId.get(e.trackId)?.artist).filter(Boolean));
      const pool = tracks.filter((t) => !heardArtists.has(t.artist));
      for (let k = 0; k < Math.min(8, pool.length); k += 1) {
        const track = pool[Math.floor(rng() * pool.length)];
        samples.push({ x: this.featureVector(track, stats), y: 0 });
      }
    }
    const negatives = samples.length - positives;

    // 类别加权：完播远多于跳过时，不让模型只学会"全部预测喜欢"
    const n = samples.length;
    const wPos = Math.min(MAX_CLASS_WEIGHT, n / (2 * Math.max(1, positives)));
    const wNeg = Math.min(MAX_CLASS_WEIGHT, n / (2 * Math.max(1, negatives)));
    for (const s of samples) s.w = s.y >= 0.5 ? wPos : wNeg;

    this.model = new LogisticRegression(FEATURE_DIM);
    let loss = 0;
    const fitted = n >= 3 && positives > 0 && negatives > 0;
    if (fitted) {
      ({ loss } = this.model.fit(samples, 80, rng));
    }

    const sessions = splitSessions(this.events);
    this.item2vec = new Item2Vec(16, { rng });
    this.item2vec.trainSessions(sessions);
    this.transitions = buildTransitions(sessions);

    this.metrics = {
      trained: fitted,
      positives,
      negatives,
      loss: Number(loss.toFixed(4)),
      events: this.events.length,
      likes: Object.keys(this.likes).length,
    };
    // 回放完所有事件后的统计量就是当前的全量统计，推荐时直接用
    this.stats = stats;
    this.trainedTracks = tracks;
    this.dirty = false;
    return this.metrics;
  }

  /** 有新反馈或曲库换了一份时才重训。 */
  ensureTrained(tracks) {
    if (this.trainedTracks !== tracks) this.contentCache.clear();
    if (this.dirty || this.trainedTracks !== tracks) this.train(tracks);
  }

  #userEmbedding() {
    const userEmb = zeros(this.item2vec.dim);
    let count = 0;
    for (const event of this.events) {
      if (this.#label(event) !== 1) continue;
      const v = this.item2vec.vectors.get(event.trackId);
      if (!v) continue;
      for (let i = 0; i < v.length; i += 1) userEmb[i] += v[i];
      count += 1;
    }
    return count ? userEmb : null;
  }

  recommend(tracks, { seedId = null, exclude = [], limit = 12, now = Date.now() } = {}) {
    this.ensureTrained(tracks);
    const stats = this.stats;
    const seed = (seedId && stats.tracksById.get(seedId)) || null;
    const seedContent = seed ? this.contentVector(seed) : null;
    const seedVec = seed ? this.item2vec.vectors.get(seed.id) : null;
    const seedTrans = seed ? this.transitions.get(seed.id) : null;
    const transMax = seedTrans ? Math.max(...seedTrans.next.values()) : 0;
    const userEmb = seedVec ? null : this.#userEmbedding();
    const popNorm = Math.log1p(stats.maxTrackPlays || 0) || 1;

    const excluded = new Set(exclude);
    if (seed) excluded.add(seed.id);

    const scored = [];
    for (const track of tracks) {
      if (excluded.has(track.id)) continue;
      const tStats = stats.byTrack.get(track.id) || emptyRow();
      const pLike = this.metrics.trained ? this.model.predict(this.featureVector(track, stats, now)) : 0.5;
      const contentSim = seedContent ? clamp01((cosine(seedContent, this.contentVector(track)) + 1) / 2) : 0.5;

      // 序列：有种子时看"听完种子之后常接着听什么"，没有种子时看整体听歌序列
      const itemVec = this.item2vec.vectors.get(track.id);
      const anchor = seedVec || userEmb;
      const embSim = itemVec && anchor ? clamp01((cosine(anchor, itemVec) + 1) / 2) : 0.5;
      const transSim = seedTrans ? (seedTrans.next.get(track.id) || 0) / transMax : 0;
      const seqSim = seedTrans ? 0.5 * transSim + 0.5 * embSim : embSim;

      // 自己反复听的歌是偏好信号，不是惩罚；只对"刚听过"的歌降权
      const pop = Math.log1p(tStats.play) / popNorm;
      const hoursSince = tStats.last ? Math.max(0, (now - tStats.last) / 3600000) : Infinity;
      const recent = Number.isFinite(hoursSince) ? Math.exp(-hoursSince / RECENT_HALF_HOURS) : 0;

      const score =
        WEIGHTS.pref * pLike +
        WEIGHTS.seq * seqSim +
        WEIGHTS.pop * pop +
        WEIGHTS.content * contentSim -
        WEIGHTS.recent * recent +
        (tStats.play === 0 ? WEIGHTS.novelty : 0) +
        (this.likes[track.id] ? WEIGHTS.like : 0) -
        (this.dislikes[track.id] ? WEIGHTS.dislike : 0);
      scored.push({ track, pLike, contentSim, seqSim, transSim, score });
    }
    scored.sort((a, b) => b.score - a.score);

    // MMR：逐首挑选，每选一首就更新候选与已选集合的最大相似度（增量维护，O(limit × N)）
    const picked = [];
    const overlap = new Float64Array(scored.length);
    const taken = new Uint8Array(scored.length);
    while (picked.length < Math.min(limit, scored.length)) {
      let bestIdx = -1;
      let bestVal = -Infinity;
      for (let i = 0; i < scored.length; i += 1) {
        if (taken[i]) continue;
        const mmr = 0.8 * scored[i].score - 0.2 * overlap[i];
        if (mmr > bestVal) {
          bestVal = mmr;
          bestIdx = i;
        }
      }
      taken[bestIdx] = 1;
      const chosen = scored[bestIdx];
      picked.push(chosen);
      const chosenVec = this.contentVector(chosen.track);
      for (let i = 0; i < scored.length; i += 1) {
        if (taken[i]) continue;
        const sim = clamp01((cosine(chosenVec, this.contentVector(scored[i].track)) + 1) / 2);
        if (sim > overlap[i]) overlap[i] = sim;
      }
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
    if (seed && row.transSim >= 0.5) return `常和《${seed.title}》连着听`;
    if (seed && row.track.artist === seed.artist) return `同一歌手 · ${row.track.artist}`;
    if (!seed && row.seqSim > 0.62 && this.metrics.positives >= 3) return "和你最近常听的歌相近";
    if (this.metrics.trained && row.pLike >= 0.58) return "符合你的口味";
    if (seed) return `和《${seed.title}》风格相近`;
    return this.metrics.trained ? "符合你的口味" : "多听几首，推荐会越来越准";
  }
}
