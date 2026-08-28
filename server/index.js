import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { expandHome, publicTrack, scanLibrary } from "./library.js";
import { Recommender } from "./recommend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

function loadConfig() {
  const configPath = path.join(rootDir, "config.json");
  const fallback = { musicDir: "~/Desktop/music-resources", port: 8787 };
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

let tracks = [];
const byId = new Map();

function refreshLibrary() {
  tracks = scanLibrary(musicDir);
  byId.clear();
  for (const track of tracks) byId.set(track.id, track);
  return tracks;
}

refreshLibrary();

const recommender = new Recommender(path.join(rootDir, "data"));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    musicDir,
    exists: fs.existsSync(musicDir),
    trackCount: tracks.length,
  });
});

app.get("/api/library", (req, res) => {
  if (req.query.refresh === "1") refreshLibrary();
  res.json({
    musicDir,
    tracks: tracks.map(publicTrack),
  });
});

app.post("/api/rescan", (_req, res) => {
  refreshLibrary();
  res.json({
    musicDir,
    trackCount: tracks.length,
    tracks: tracks.map(publicTrack),
  });
});

app.post("/api/events", (req, res) => {
  const body = req.body || {};
  recommender.record(body);
  const metrics = recommender.train(tracks);
  res.json({ ok: true, metrics });
});

app.post("/api/feedback", (req, res) => {
  const { trackId, liked } = req.body || {};
  recommender.setLike(trackId, Boolean(liked));
  const metrics = recommender.train(tracks);
  res.json({ ok: true, liked: Boolean(liked), metrics });
});

app.get("/api/recommend", (req, res) => {
  const seedId = typeof req.query.seed === "string" ? req.query.seed : null;
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
  const exclude = typeof req.query.exclude === "string"
    ? req.query.exclude.split(",").filter(Boolean)
    : [];
  const result = recommender.recommend(tracks, { seedId, exclude, limit });
  const byTrack = new Map(tracks.map((t) => [t.id, publicTrack(t)]));
  res.json({
    ...result,
    items: result.items.map((item) => ({
      ...item,
      track: byTrack.get(item.id) || null,
    })),
    likes: Object.keys(recommender.likes),
  });
});

app.get("/api/stream/:id", (req, res) => {
  const track = byId.get(req.params.id);
  if (!track || !fs.existsSync(track.path)) {
    res.status(404).json({ error: "Track not found" });
    return;
  }

  const stat = fs.statSync(track.path);
  const mime =
    track.ext === "flac"
      ? "audio/flac"
      : track.ext === "mp3"
        ? "audio/mpeg"
        : track.ext === "wav"
          ? "audio/wav"
          : track.ext === "m4a"
            ? "audio/mp4"
            : "application/octet-stream";

  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=3600");

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(track.path).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.status(416).end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
    res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
    return;
  }

  const safeEnd = Math.min(end, stat.size - 1);
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${safeEnd}/${stat.size}`);
  res.setHeader("Content-Length", safeEnd - start + 1);
  fs.createReadStream(track.path, { start, end: safeEnd }).pipe(res);
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

app.listen(port, () => {
  console.log(`[唱机] library: ${musicDir}`);
  console.log(`[唱机] tracks:  ${tracks.length}`);
  console.log(`[唱机] api:     http://localhost:${port}/api/library`);
  if (fs.existsSync(distDir)) {
    console.log(`[唱机] app:     http://localhost:${port}`);
  }
});
