import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { expandHome, legacyId, publicTrack, readEmbeddedCover, scanLibrary } from "./library.js";
import { LyricsService } from "./lyricsOnline.js";
import { Playlists } from "./playlists.js";
import { Recommender } from "./recommend.js";
import { listeningHistory, listeningStats } from "./stats.js";
import { readJson, writeJsonAtomic } from "./store.js";
import { streamTrack } from "./stream.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

function loadConfig() {
  const configPath = path.join(rootDir, "config.json");
  const fallback = { musicDir: "~/Desktop/music-resources", port: 8787, onlineLyrics: true };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ...fallback, ...raw };
  } catch {
    return fallback;
  }
}

const config = loadConfig();
const musicDir = expandHome(process.env.MUSIC_DIR || config.musicDir);
const port = Number(process.env.PORT || config.port || 8787);
const host = process.env.HOST || "127.0.0.1";
const dataDir = process.env.DATA_DIR ? expandHome(process.env.DATA_DIR) : path.join(rootDir, "data");

const recommender = new Recommender(dataDir);
const playlists = new Playlists(dataDir);
// 本地没有歌词时到 LRCLIB 查找；ONLINE_LYRICS=0 或 config.json 里 "onlineLyrics": false 可以关掉
const onlineLyrics = process.env.ONLINE_LYRICS != null
  ? !/^(0|false|no|off)$/i.test(process.env.ONLINE_LYRICS)
  : config.onlineLyrics !== false;
const lyricsService = new LyricsService(dataDir, { online: onlineLyrics });

// ---- 曲库 ----

const CACHE_VERSION = 2;
const cacheFile = path.join(dataDir, "library-cache.json");

function loadScanCache() {
  const raw = readJson(cacheFile, null);
  if (!raw || raw.version !== CACHE_VERSION || !Array.isArray(raw.entries)) return new Map();
  return new Map(raw.entries);
}

let scanCache = loadScanCache();
let tracks = [];
const byId = new Map();
let librarySignature = "";
let libraryVersion = 0;
let scanPromise = null;
let rescanQueued = false;

function applyTracks(next) {
  const signature = next
    .map((t) => `${t.id}:${t.relPath}:${t.mtime}:${t.hasCover ? 1 : 0}${t.hasLyrics ? 1 : 0}`)
    .join("|");
  if (signature === librarySignature) return; // 没变化就保留原数组，推荐模型不必重训
  librarySignature = signature;
  libraryVersion += 1;
  tracks = next;
  byId.clear();
  for (const track of tracks) byId.set(track.id, track);

  // 旧版本用绝对路径哈希当 ID，这里把听歌记录和歌单迁移到新 ID
  const idMap = new Map(tracks.map((t) => [legacyId(t.path), t.id]));
  const migrated = recommender.migrateIds(idMap) + playlists.migrateIds(idMap);
  if (migrated) console.log(`[唱机] 已把 ${migrated} 条记录迁移到新的歌曲 ID`);
}

/** 重新扫描曲库；扫描进行中再次调用会在本轮结束后补扫一次。 */
function refreshLibrary() {
  if (scanPromise) {
    rescanQueued = true;
    return scanPromise;
  }
  scanPromise = (async () => {
    try {
      do {
        rescanQueued = false;
        const result = await scanLibrary(musicDir, scanCache);
        scanCache = result.cache;
        try {
          writeJsonAtomic(cacheFile, { version: CACHE_VERSION, entries: [...scanCache] });
        } catch (err) {
          console.warn(`[唱机] 无法写入曲库缓存（${err.message}）`);
        }
        applyTracks(result.tracks);
      } while (rescanQueued);
      return tracks;
    } finally {
      scanPromise = null;
    }
  })();
  return scanPromise;
}

let watchTimer = null;

function watchLibrary() {
  if (!fs.existsSync(musicDir)) return;
  try {
    const watcher = fs.watch(musicDir, { recursive: true, persistent: false }, (_type, name) => {
      if (name && path.basename(String(name)).startsWith(".")) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        refreshLibrary().catch((err) => console.warn(`[唱机] 自动扫描失败（${err.message}）`));
      }, 1500);
    });
    watcher.on("error", (err) => console.warn(`[唱机] 曲库监听出错（${err.message}）`));
  } catch (err) {
    console.warn(`[唱机] 无法监听曲库目录变化，请手动重新扫描（${err.message}）`);
  }
}

// 先开始监听端口再扫描：曲库很大时启动器的健康检查也不会超时
const initialScan = refreshLibrary().catch((err) => {
  console.error(`[唱机] 曲库扫描失败（${err.message}）`);
});
watchLibrary();

// ---- HTTP ----

const app = express();
app.disable("x-powered-by");

// 只绑定回环地址时，拒绝 Host 不是本机的请求，防止 DNS rebinding 网页读取本地曲库
const LOOPBACK_BIND = ["127.0.0.1", "localhost", "::1"].includes(host);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
app.use((req, res, next) => {
  if (!LOOPBACK_BIND) return next();
  const hostname = String(req.headers.host || "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost")) return next();
  res.status(403).json({ error: "Forbidden host" });
});

app.use(express.json({ limit: "256kb" }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function libraryPayload() {
  return {
    musicDir,
    version: libraryVersion,
    trackCount: tracks.length,
    tracks: tracks.map(publicTrack),
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    musicDir,
    exists: fs.existsSync(musicDir),
    trackCount: tracks.length,
    version: libraryVersion,
    scanning: Boolean(scanPromise),
  });
});

app.get(
  "/api/library",
  asyncRoute(async (req, res) => {
    await initialScan;
    // ?refresh=1 只为兼容旧版界面；新界面用 POST /api/rescan
    if (req.query.refresh === "1") await refreshLibrary();
    res.json(libraryPayload());
  }),
);

app.post(
  "/api/rescan",
  asyncRoute(async (_req, res) => {
    await refreshLibrary();
    res.json(libraryPayload());
  }),
);

app.post("/api/events", (req, res) => {
  recommender.record(req.body || {});
  res.json({ ok: true });
});

app.post("/api/feedback", (req, res) => {
  const { trackId, liked, disliked } = req.body || {};
  if (typeof trackId !== "string") {
    res.status(400).json({ error: "trackId required" });
    return;
  }
  if (disliked === false) {
    // 撤销"不喜欢"，同时恢复标记前的喜欢状态
    recommender.clearDislike(trackId);
    if (liked) recommender.setLike(trackId, true);
  } else if (disliked) {
    recommender.setDislike(trackId);
  } else {
    recommender.setLike(trackId, Boolean(liked));
  }
  res.json({ ok: true, liked: Boolean(recommender.likes[trackId]), disliked: Boolean(recommender.dislikes[trackId]) });
});

/** 统计 / 记录的范围：?track=ID、?artist=名字 或 ?album=专辑&albumArtist=专辑艺人；都不传就是全部。 */
function statsFilter(query) {
  if (typeof query.track === "string" && query.track) return { trackId: query.track };
  if (typeof query.artist === "string") return { artist: query.artist };
  if (typeof query.album === "string") {
    return { album: query.album, albumArtist: typeof query.albumArtist === "string" ? query.albumArtist : undefined };
  }
  return null;
}

const queryNumber = (value) => {
  const n = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
};

app.get("/api/stats", (req, res) => {
  res.json(
    listeningStats(recommender.events, tracks, {
      range: typeof req.query.range === "string" ? req.query.range : "30d",
      filter: statsFilter(req.query),
    }),
  );
});

app.get("/api/history", (req, res) => {
  res.json(
    listeningHistory(recommender.events, tracks, {
      from: queryNumber(req.query.from) ?? -Infinity,
      to: queryNumber(req.query.to) ?? Infinity,
      before: queryNumber(req.query.before),
      limit: Math.min(200, Math.max(1, queryNumber(req.query.limit) ?? 50)),
      hideSkips: req.query.hideSkips === "1",
      filter: statsFilter(req.query),
    }),
  );
});

// ---- 封面 / 歌词 ----

const coverCache = new Map();
const COVER_CACHE_SIZE = 64;

async function loadCover(track) {
  if (track.picture?.offset != null) {
    const fh = await fs.promises.open(track.path, "r");
    try {
      const data = Buffer.alloc(track.picture.length);
      await fh.read(data, 0, track.picture.length, track.picture.offset);
      return { mime: track.picture.mime, data };
    } finally {
      await fh.close();
    }
  }
  if (track.picture?.embedded) {
    const embedded = await readEmbeddedCover(track.path);
    if (embedded) return embedded;
  }
  if (track.folderCover) {
    const ext = path.extname(track.folderCover).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { mime, data: await fs.promises.readFile(track.folderCover) };
  }
  return null;
}

app.get(
  "/api/cover/:id",
  asyncRoute(async (req, res) => {
    const track = byId.get(req.params.id);
    if (!track?.hasCover) {
      res.status(404).end();
      return;
    }
    const key = `${track.id}:${track.mtime}`;
    let cover = coverCache.get(key);
    if (!cover) {
      cover = await loadCover(track).catch(() => null);
      if (!cover) {
        res.status(404).end();
        return;
      }
      coverCache.set(key, cover);
      if (coverCache.size > COVER_CACHE_SIZE) coverCache.delete(coverCache.keys().next().value);
    }
    res.setHeader("Content-Type", cover.mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(cover.data);
  }),
);

app.get(
  "/api/lyrics/:id",
  asyncRoute(async (req, res) => {
    const track = byId.get(req.params.id);
    if (!track) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.json(await lyricsService.get(track, { refresh: req.query.refresh === "1" }));
  }),
);

// ---- 歌单 ----

app.get("/api/playlists", (_req, res) => {
  res.json({ playlists: playlists.list() });
});

app.post("/api/playlists", (req, res) => {
  const playlist = playlists.create(req.body?.name);
  if (!playlist) {
    res.status(400).json({ error: "name required" });
    return;
  }
  if (typeof req.body?.trackId === "string") playlists.addTrack(playlist.id, req.body.trackId);
  res.json({ playlist });
});

// 撤销删除：按原 ID 放回原位置
app.post("/api/playlists/restore", (req, res) => {
  const playlist = playlists.restore(req.body?.playlist, req.body?.index);
  if (!playlist) {
    res.status(400).json({ error: "invalid playlist" });
    return;
  }
  res.json({ playlist });
});

app.patch("/api/playlists/:id", (req, res) => {
  const playlist = playlists.update(req.params.id, req.body || {});
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ playlist });
});

app.delete("/api/playlists/:id", (req, res) => {
  res.json({ ok: playlists.remove(req.params.id) });
});

app.post("/api/playlists/:id/tracks", (req, res) => {
  const playlist = playlists.addTrack(req.params.id, req.body?.trackId);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ playlist });
});

app.delete("/api/playlists/:id/tracks/:trackId", (req, res) => {
  const playlist = playlists.removeTrack(req.params.id, req.params.trackId);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ playlist });
});

app.get(
  "/api/recommend",
  asyncRoute(async (req, res) => {
    await initialScan;
    const seedId = typeof req.query.seed === "string" ? req.query.seed : null;
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
    const exclude = typeof req.query.exclude === "string"
      ? req.query.exclude.split(",").filter(Boolean)
      : [];
    const result = recommender.recommend(tracks, { seedId, exclude, limit });
    res.json({
      ...result,
      items: result.items.map((item) => ({
        ...item,
        track: byId.has(item.id) ? publicTrack(byId.get(item.id)) : null,
      })),
      likes: Object.keys(recommender.likes),
      dislikes: Object.keys(recommender.dislikes),
    });
  }),
);

app.get("/api/stream/:id", (req, res) => {
  streamTrack(req, res, byId.get(req.params.id));
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error("[唱机]", err);
  if (!res.headersSent) res.status(500).json({ error: "Internal error" });
});

app.listen(port, host, () => {
  const origin = `http://${host === "127.0.0.1" ? "localhost" : host}:${port}`;
  console.log(`[唱机] library: ${musicDir}`);
  console.log(`[唱机] bind:    ${host}:${port}`);
  void initialScan.then(() => console.log(`[唱机] tracks:  ${tracks.length}`));
  console.log(`[唱机] api:     ${origin}/api/library`);
  if (fs.existsSync(distDir)) {
    console.log(`[唱机] app:     ${origin}`);
  }
});
