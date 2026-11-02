/**
 * 离线评估：按时间把听歌记录切成前 80% 训练、后 20% 测试，
 * 看测试集里每一次"完整听完"的歌，是否出现在以上一首为种子的推荐前 10 名里（hit@10）。
 *
 *   npm run eval            # 用 data/ 里的记录
 *   node server/eval.js DIR # 指定数据目录
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome, scanLibrary } from "./library.js";
import { Recommender, labelFromListen } from "./recommend.js";
import { readJson } from "./store.js";

const K = 10;
const SESSION_GAP_MS = 30 * 60 * 1000;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.argv[2] || path.join(rootDir, "data"));
const config = readJson(path.join(rootDir, "config.json"), {});
const musicDir = expandHome(process.env.MUSIC_DIR || config.musicDir || "~/Desktop/music-resources");

const raw = readJson(path.join(dataDir, "listens.json"), {});
const events = (raw.events || []).filter((e) => e.trackId).sort((a, b) => a.ts - b.ts);
if (events.length < 50) {
  console.log(`听歌记录只有 ${events.length} 条，至少需要 50 条才能评估。`);
  process.exit(0);
}

const cacheFile = path.join(dataDir, "library-cache.json");
const cacheRaw = fs.existsSync(cacheFile) ? readJson(cacheFile, null) : null;
const cache = new Map(Array.isArray(cacheRaw?.entries) ? cacheRaw.entries : []);
const { tracks } = await scanLibrary(musicDir, cache);
const known = new Set(tracks.map((t) => t.id));

const split = Math.floor(events.length * 0.8);
const train = events.slice(0, split);
const test = events.slice(split);

// 测试样本：完整听完的歌 + 同一 session 里的上一首作为种子
const cases = [];
for (let i = 1; i < test.length; i += 1) {
  const cur = test[i];
  const prev = test[i - 1];
  if (cur.type && cur.type !== "listen") continue;
  if (!(labelFromListen(cur) >= 0.7)) continue;
  if (cur.ts - prev.ts > SESSION_GAP_MS || prev.trackId === cur.trackId) continue;
  if (!known.has(cur.trackId) || !known.has(prev.trackId)) continue;
  cases.push({ seed: prev.trackId, target: cur.trackId, ts: cur.ts });
}

const rec = new Recommender(null);
rec.events = train;
rec.likes = {};
rec.train(tracks);

const plays = new Map();
for (const e of train) plays.set(e.trackId, (plays.get(e.trackId) || 0) + 1);
const byPop = [...tracks].sort((a, b) => (plays.get(b.id) || 0) - (plays.get(a.id) || 0));
const artistOf = new Map(tracks.map((t) => [t.id, t.artist]));

let hitModel = 0;
let hitPop = 0;
let hitArtist = 0;
for (const { seed, target, ts } of cases) {
  const top = rec.recommend(tracks, { seedId: seed, limit: K, now: ts }).items.map((i) => i.id);
  if (top.includes(target)) hitModel += 1;

  const pop = byPop.filter((t) => t.id !== seed).slice(0, K).map((t) => t.id);
  if (pop.includes(target)) hitPop += 1;

  const sameArtist = byPop.filter((t) => t.id !== seed && t.artist === artistOf.get(seed));
  const artistTop = [...sameArtist, ...byPop.filter((t) => t.id !== seed && t.artist !== artistOf.get(seed))]
    .slice(0, K)
    .map((t) => t.id);
  if (artistTop.includes(target)) hitArtist += 1;
}

const pct = (n) => `${((n / Math.max(1, cases.length)) * 100).toFixed(1)}%`;
console.log(`曲库 ${tracks.length} 首 · 训练 ${train.length} 条 · 测试样本 ${cases.length} 个`);
console.log(`模型指标：${JSON.stringify(rec.metrics)}`);
console.log(`hit@${K}`);
console.log(`  本地模型     ${pct(hitModel)}`);
console.log(`  热门基线     ${pct(hitPop)}`);
console.log(`  同歌手基线   ${pct(hitArtist)}`);
console.log(`  随机期望     ${((K / Math.max(1, tracks.length - 1)) * 100).toFixed(1)}%`);
