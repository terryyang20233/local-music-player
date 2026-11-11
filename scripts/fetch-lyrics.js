#!/usr/bin/env node
/**
 * 给整个曲库下载歌词：逐首请求正在运行的唱机服务（/api/lyrics/:id），
 * 结果和播放时自动查到的一样缓存在 data/lyrics/，之后离线也能显示。
 *
 *   npm run lyrics              只查还没有歌词的歌
 *   npm run lyrics -- --retry   之前没找到、标记为纯音乐或只有纯文本的也重新查一遍
 *
 * 需要唱机正在运行（Dock 上的唱机、npm start 或 npm run dev 都可以）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
} catch {
  /* 用默认端口 */
}
const port = Number(process.env.PORT || config.port || 8787);
const base = `http://localhost:${port}`;
const retry = process.argv.includes("--retry");
/** 真正联网查找的请求之间稍微停一下，对歌词库客气一点。 */
const PAUSE_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function lyricsFor(track, refresh) {
  const started = Date.now();
  const result = await getJson(`${base}/api/lyrics/${track.id}${refresh ? "?refresh=1" : ""}`);
  // 很快返回的是缓存，不用停
  if (Date.now() - started > 50) await sleep(PAUSE_MS);
  return result;
}

let tracks;
try {
  tracks = (await getJson(`${base}/api/library`)).tracks;
} catch {
  console.error(`[唱机] 连不上 ${base}，请先打开唱机（或运行 npm start）再试。`);
  process.exit(1);
}

const counts = { synced: 0, plain: 0, local: 0, instrumental: 0, missing: 0, error: 0 };
const missing = [];
const instrumental = [];
const failed = [];

for (const [i, track] of tracks.entries()) {
  process.stdout.write(`\r[唱机] 歌词 ${i + 1}/${tracks.length}`);
  let result;
  try {
    result = await lyricsFor(track, false);
    const plainOnline = result.status === "found" && result.source === "lrclib" && !result.synced;
    if (retry && (result.status === "missing" || result.status === "instrumental" || plainOnline)) {
      result = await lyricsFor(track, true);
    }
    if (result.status === "error") {
      // 网络抖动：等一会儿强制重查一次
      await sleep(3000);
      result = await lyricsFor(track, true);
    }
  } catch {
    result = { status: "error" };
  }
  const name = `${track.title} — ${track.artist}`;
  if (result.status === "found") {
    if (result.source !== "lrclib") counts.local += 1;
    else if (result.synced) counts.synced += 1;
    else counts.plain += 1;
  } else if (result.status === "instrumental") {
    counts.instrumental += 1;
    instrumental.push(name);
  } else if (result.status === "error") {
    counts.error += 1;
    failed.push(name);
  } else {
    counts.missing += 1;
    missing.push(name);
  }
}

process.stdout.write("\n");
console.log(
  `[唱机] 共 ${tracks.length} 首：带时间轴 ${counts.synced}，纯文本 ${counts.plain}，本地 .lrc / 内嵌 ${counts.local}，` +
    `标记为纯音乐 ${counts.instrumental}，没找到 ${counts.missing}，查找失败 ${counts.error}`,
);
const list = (title, items) => {
  if (!items.length) return;
  console.log(`\n${title}`);
  for (const item of items) console.log(`  - ${item}`);
};
list("没找到歌词（可以把同名 .lrc 放在音频旁边）：", missing);
list("歌词库标记为纯音乐（如果不对，同样可以放 .lrc）：", instrumental);
list("查找失败（多半是网络问题，稍后再运行一次）：", failed);
