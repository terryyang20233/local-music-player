import crypto from "node:crypto";
import path from "node:path";
import * as OpenCCToTraditional from "opencc-js/cn2t";
import * as OpenCC from "opencc-js/t2cn";
import { pinyin } from "pinyin-pro";
import { loadLyrics, parseLrc } from "./lyrics.js";
import { readJson, writeJsonAtomic } from "./store.js";

/**
 * 歌词：本地 .lrc / 内嵌标签优先；都没有时到 LRCLIB（https://lrclib.net，开放、免注册的歌词库）查找，
 * 结果缓存在 data/lyrics/，之后离线也能显示。只发送歌名、歌手、专辑和时长，不涉及听歌记录。
 */

const API = "https://lrclib.net/api";
const USER_AGENT = "Changji Local Music Player (https://github.com/terryyang20233/local-music-player)";
const TIMEOUT_MS = 8000;
/** 没找到的歌隔一段时间再查，歌词库可能已经有人补上。 */
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** 网络出错后短时间内不再重试，避免离线时每次切歌都要等超时。 */
const ERROR_COOLDOWN_MS = 60 * 1000;
/** 候选歌词与本地音频的时长最多差几秒，超过就认为是别的版本。 */
const MAX_DURATION_DIFF = 3;

const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const toTraditionalText = OpenCCToTraditional.Converter({ from: "cn", to: "tw" });
const HAN = /[\u3400-\u9fff]/;

/** 繁体写法：歌词库里不少台湾、香港歌手的歌只有繁体歌名（愛人錯過、單車）。 */
function toTraditional(text) {
  const value = String(text ?? "");
  return HAN.test(value) && !/[\u3040-\u30ff]/.test(value) ? toTraditionalText(value) : value;
}

/**
 * 歌词库里不少中文歌词是繁体，界面和标签是简体，统一转成简体。
 * 含假名的（日文）不转，免得把日文汉字改坏。
 */
export function simplify(text) {
  const value = String(text ?? "");
  if (!/[\u3400-\u9fff]/.test(value) || /[\u3040-\u30ff]/.test(value)) return value;
  return toSimplified(value);
}

/** 去掉空白和标点，统一全角半角、大小写。 */
function compact(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 拼音形式：繁简体（汪苏泷 / 汪蘇瀧）得到同样的结果。 */
function pinyinKey(text) {
  const value = String(text ?? "");
  if (!/[㐀-鿿]/.test(value)) return compact(value);
  return compact(pinyin(value, { toneType: "none", type: "array", nonZh: "consecutive" }).join(""));
}

/** 比较用的歌名：统一成简体，去掉括号里的版本说明和 " - 副标题"。「句号 - Full Stop」→「句号」。 */
function titleKey(title) {
  const text = simplify(String(title ?? "").normalize("NFKC"));
  const base = text
    .replace(/[(（[【].*?[)）\]】]/g, " ")
    .split(/\s+[-–—]\s+/)[0];
  return compact(base) || compact(text);
}

/** 搜索用的歌名：去掉括号里的说明。「Don't Stop Believing(Complete version…)」→「Don't Stop Believing」。 */
function searchTitle(title) {
  const text = String(title ?? "");
  return text.replace(/[(（[【《].*?[)）\]】》]/g, " ").replace(/\s+/g, " ").trim() || text.trim();
}

/** 歌名后面紧跟这些字符时，算作同一首歌加了副标题。 */
const SUBTITLE_START = /^[\s\-–—_~·:：(（[【《/|]/;

function sameTitle(a, b) {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || pinyinKey(ka) === pinyinKey(kb)) return true;
  // 一边多了副标题：「偏爱-《仙剑奇侠传3》电视剧插曲」和「偏爱」
  const na = simplify(searchTitle(a).normalize("NFKC")).toLowerCase();
  const nb = simplify(searchTitle(b).normalize("NFKC")).toLowerCase();
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length > 0 && long.startsWith(short) && SUBTITLE_START.test(long.slice(short.length));
}

/** 多位歌手时的第一位："Hardwell/Sound Rush" → "Hardwell"。 */
function firstArtist(name) {
  return String(name ?? "").split(/\s*(?:[,，、&/;；]|\bfeat\.?|\bft\.?)\s*/i)[0].trim();
}

/** 拆分歌手名时忽略的常见词，免得 "The Script" 靠一个 "the" 就和别的歌手对上。 */
const ARTIST_STOPWORDS = new Set(["the", "and", "band", "with"]);

/** 歌手名拆成几段：合唱、feat.、"G.E.M. 邓紫棋" 这种中英混写都能对上。 */
function artistParts(name) {
  const text = simplify(String(name ?? "").normalize("NFKC"));
  const parts = text
    .split(/\s*(?:[,，、&/;；]|\bfeat\.?|\bft\.?|\s)\s*/i)
    .map(compact)
    .filter((p) => p.length >= 2 && !ARTIST_STOPWORDS.has(p));
  return [...new Set([compact(text), ...parts])].filter(Boolean);
}

export function artistMatches(ours, theirs) {
  const theirText = simplify(String(theirs ?? "").normalize("NFKC"));
  const theirCompact = compact(theirText);
  const theirPinyin = pinyinKey(theirText);
  if (theirCompact.length < 2) return false;
  return artistParts(ours).some((part) => {
    const py = pinyinKey(part);
    return (
      theirCompact.includes(part) ||
      part.includes(theirCompact) ||
      (py.length >= 4 && (theirPinyin.includes(py) || py.includes(theirPinyin)))
    );
  });
}

/**
 * 从 LRCLIB 的候选里挑一份：歌名相同、时长相差不超过 3 秒；有时间轴的优先，其次纯文本，最后才是"纯音乐"标记。
 * requireArtist 为 true 时（只按歌名搜到的结果）还要求歌手对得上。
 */
export function pickLyrics(candidates, track, { requireArtist = false } = {}) {
  const duration = Number(track.duration) || 0;
  let best = null;
  let bestRank = -1;
  let bestDiff = Infinity;
  for (const c of candidates) {
    if (!c || !sameTitle(track.title, c.trackName)) continue;
    const diff = duration && c.duration ? Math.abs(c.duration - duration) : 0;
    if (diff > MAX_DURATION_DIFF) continue;
    if (requireArtist && !artistMatches(track.artist, c.artistName)) continue;
    const rank = c.syncedLyrics ? 3 : c.plainLyrics ? 2 : c.instrumental ? 1 : 0;
    if (rank === 0) continue;
    if (rank > bestRank || (rank === bestRank && diff < bestDiff)) {
      best = c;
      bestRank = rank;
      bestDiff = diff;
    }
  }
  return best;
}

const hasText = (c) => Boolean(c?.syncedLyrics || c?.plainLyrics);

/** 标签里没有歌名或歌手的歌（只能从文件名猜）不去网上查，免得配错。 */
function canLookup(track) {
  return Boolean(track.title && track.artist && track.artist !== "未知歌手");
}

export class LyricsService {
  /**
   * @param {string | null} dataDir
   * @param {{ online?: boolean, fetchImpl?: typeof fetch, now?: () => number }} [options]
   */
  constructor(dataDir, { online = true, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.dir = dataDir ? path.join(dataDir, "lyrics") : null;
    this.online = online;
    this.fetch = fetchImpl;
    this.now = now;
    this.pending = new Map();
    this.errors = new Map();
  }

  #file(id) {
    const safe = /^[\w-]{1,64}$/.test(id) ? id : crypto.createHash("sha1").update(id).digest("hex");
    return path.join(this.dir, `${safe}.json`);
  }

  #readCache(id) {
    return this.dir ? readJson(this.#file(id), null) : null;
  }

  #writeCache(id, entry) {
    if (!this.dir) return;
    try {
      writeJsonAtomic(this.#file(id), entry);
    } catch (err) {
      console.warn(`[唱机] 歌词缓存写入失败：${err.message}`);
    }
  }

  #fresh(entry) {
    if (!entry || typeof entry.status !== "string") return false;
    if (entry.status === "missing") return this.now() - (Number(entry.fetchedAt) || 0) < MISS_TTL_MS;
    return entry.status === "found" || entry.status === "instrumental";
  }

  #toResult(entry) {
    if (entry.status === "found") {
      const parsed = parseLrc(simplify(entry.text));
      if (parsed.lines.length) return { status: "found", source: "lrclib", ...parsed };
      return { status: "missing", online: true };
    }
    if (entry.status === "instrumental") return { status: "instrumental", source: "lrclib", online: true };
    return { status: "missing", online: true };
  }

  /**
   * get 找不到时返回 null，search 总是返回数组。
   * @param {"get" | "search"} kind
   * @param {Record<string, string>} params
   * @returns {Promise<any>}
   */
  async #request(kind, params) {
    const res = await this.fetch(`${API}/${kind}?${new URLSearchParams(params)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return kind === "get" ? null : [];
    if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
    const data = await res.json();
    return kind === "search" ? (Array.isArray(data) ? data : []) : data;
  }

  /**
   * 先精确匹配；拿不到带时间轴的歌词，就依次换几种搜法，找到带时间轴的就停：
   * 歌名 + 歌手 → 繁体歌名 + 繁体歌手 → 只用第一位歌手 → 只按歌名（要求歌手对得上）→ 只按繁体歌名。
   * 都只有纯文本时返回纯文本；只有"纯音乐"标记时返回该标记。
   */
  async lookup(track) {
    const title = searchTitle(track.title);
    const artist = String(track.artist ?? "");
    const duration = Math.round(Number(track.duration) || 0);
    // strict：搜索时已经按歌手筛过；loose：只按歌名搜到的，还要检查歌手
    const strict = [];
    const loose = [];
    const best = () => {
      const winners = [pickLyrics(strict, track), pickLyrics(loose, track, { requireArtist: true })];
      return pickLyrics(winners.filter(Boolean), track);
    };

    if (track.album && duration) {
      const exact = await this.#request("get", {
        track_name: track.title,
        artist_name: artist,
        album_name: track.album,
        duration: String(duration),
      });
      if (exact?.syncedLyrics) return exact;
      if (exact) strict.push(exact);
    }

    const tradTitle = toTraditional(title);
    const tradArtist = toTraditional(artist);
    const first = firstArtist(artist);
    /** @type {[Record<string, string>, any[]][]} */
    const searches = [[{ track_name: title, artist_name: artist }, strict]];
    if (tradTitle !== title || tradArtist !== artist) searches.push([{ track_name: tradTitle, artist_name: tradArtist }, strict]);
    if (first && first !== artist) searches.push([{ track_name: title, artist_name: first }, strict]);
    searches.push([{ track_name: title }, loose]);
    if (tradTitle !== title) searches.push([{ track_name: tradTitle }, loose]);

    for (const [params, pool] of searches) {
      pool.push(...(await this.#request("search", params)));
      const found = best();
      if (found?.syncedLyrics) return found;
    }
    return best();
  }

  async #fetchAndStore(track) {
    try {
      const match = await this.lookup(track);
      const fetchedAt = this.now();
      let entry;
      if (hasText(match)) {
        entry = {
          status: "found",
          synced: Boolean(match.syncedLyrics),
          text: match.syncedLyrics || match.plainLyrics,
          fetchedAt,
          match: { id: match.id, trackName: match.trackName, artistName: match.artistName, albumName: match.albumName, duration: match.duration },
        };
      } else if (match?.instrumental) {
        entry = { status: "instrumental", fetchedAt, match: { id: match.id, trackName: match.trackName, artistName: match.artistName } };
      } else {
        entry = { status: "missing", fetchedAt };
      }
      this.errors.delete(track.id);
      this.#writeCache(track.id, entry);
      return this.#toResult(entry);
    } catch (err) {
      this.errors.set(track.id, this.now());
      console.warn(`[唱机] 在线歌词查找失败：${track.title}（${err.message}）`);
      return { status: "error", online: true };
    }
  }

  /**
   * 返回 { status: "found", source, synced, lines } 或 { status: "instrumental" | "missing" | "error" }。
   * refresh 为 true 时忽略缓存重新查找。
   */
  async get(track, { refresh = false } = {}) {
    const local = await loadLyrics(track);
    if (local) return { status: "found", ...local };
    if (!this.online) return { status: "missing", online: false };

    const cached = refresh ? null : this.#readCache(track.id);
    if (this.#fresh(cached)) return this.#toResult(cached);
    if (!canLookup(track)) return { status: "missing", online: true };

    const failedAt = this.errors.get(track.id);
    if (!refresh && failedAt != null && this.now() - failedAt < ERROR_COOLDOWN_MS) return { status: "error", online: true };

    let job = this.pending.get(track.id);
    if (!job) {
      job = this.#fetchAndStore(track).finally(() => this.pending.delete(track.id));
      this.pending.set(track.id, job);
    }
    return job;
  }
}
