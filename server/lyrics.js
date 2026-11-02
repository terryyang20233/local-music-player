import fsp from "node:fs/promises";

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * 解析 LRC。返回 { synced, lines }：synced 为 true 时每行带时间（秒），否则是纯文本歌词。
 * 支持一行多个时间标签和 [offset:±毫秒]。
 */
export function parseLrc(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  let offset = 0;
  const lines = [];
  const plain = [];

  for (const line of raw.split(/\r?\n/)) {
    const offsetTag = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(line);
    if (offsetTag) {
      offset = Number(offsetTag[1]) / 1000;
      continue;
    }
    TIME_TAG.lastIndex = 0;
    const times = [];
    let match;
    let end = 0;
    while ((match = TIME_TAG.exec(line)) && match.index === end) {
      const frac = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
      times.push(Number(match[1]) * 60 + Number(match[2]) + frac);
      end = TIME_TAG.lastIndex;
    }
    const content = line.slice(end).trim();
    if (times.length) {
      for (const t of times) lines.push({ time: t, text: content });
    } else if (content && !/^\[[a-z]+:.*\]$/i.test(content)) {
      plain.push(content);
    }
  }

  if (lines.length) {
    // offset 为正表示歌词提前出现
    const shifted = lines.map((l) => ({ time: Math.max(0, l.time - offset), text: l.text }));
    shifted.sort((a, b) => a.time - b.time);
    return { synced: true, lines: shifted };
  }
  return { synced: false, lines: plain.map((text) => ({ time: null, text })) };
}

/** 优先读同名 .lrc，没有再用内嵌的 LYRICS 标签。 */
export async function loadLyrics(track) {
  if (track.lyricsFile) {
    try {
      return parseLrc(await fsp.readFile(track.lyricsFile, "utf8"));
    } catch {
      /* 文件被删了就退回内嵌歌词 */
    }
  }
  if (track.embeddedLyrics) return parseLrc(track.embeddedLyrics);
  return null;
}
