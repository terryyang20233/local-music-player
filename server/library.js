import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const AUDIO_EXT = new Set([".flac", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus"]);

export function expandHome(p) {
  if (!p) return p;
  if (p.startsWith("~" + path.sep) || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function readBlock(fd, pos, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, pos);
  return n === length ? buf : buf.subarray(0, n);
}

export function parseFlacMetadata(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const sig = readBlock(fd, 0, 4);
    if (sig.toString("ascii") !== "fLaC") return null;

    let pos = 4;
    const tags = {};
    let sampleRate = 0;
    let samples = 0;
    let bitsPerSample = 0;
    let channels = 0;

    for (let i = 0; i < 32; i += 1) {
      const header = readBlock(fd, pos, 4);
      if (header.length < 4) break;
      pos += 4;
      const isLast = (header[0] & 0x80) !== 0;
      const type = header[0] & 0x7f;
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      const data = readBlock(fd, pos, length);
      pos += length;

      if (type === 0 && data.length >= 18) {
        sampleRate = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4);
        channels = ((data[12] >> 1) & 0x07) + 1;
        bitsPerSample = (((data[12] & 0x01) << 4) | (data[13] >> 4)) + 1;
        samples = (data[13] & 0x0f) * 0x100000000 + data.readUIntBE(14, 4);
      } else if (type === 4 && data.length >= 8) {
        let offset = 0;
        const vendorLen = data.readUInt32LE(offset);
        offset += 4 + vendorLen;
        if (offset + 4 > data.length) break;
        const count = data.readUInt32LE(offset);
        offset += 4;
        for (let c = 0; c < count; c += 1) {
          if (offset + 4 > data.length) break;
          const clen = data.readUInt32LE(offset);
          offset += 4;
          const comment = data.subarray(offset, offset + clen).toString("utf8");
          offset += clen;
          const eq = comment.indexOf("=");
          if (eq > 0) {
            const key = comment.slice(0, eq).toUpperCase();
            const value = comment.slice(eq + 1);
            if (!tags[key]) tags[key] = [];
            tags[key].push(value);
          }
        }
      }

      if (isLast) break;
    }

    const title = tags.TITLE?.[0]?.trim() || null;
    let artist = tags.ARTIST?.[0]?.trim() || tags.ALBUMARTIST?.[0]?.trim() || "";
    let displayTitle = title;
    if (!artist && title?.includes(" - ")) {
      const parts = title.split(" - ");
      artist = parts[parts.length - 1].replace(/\[.*?\]/g, "").trim();
      displayTitle = parts.slice(0, -1).join(" - ").trim() || title;
    }

    const duration = sampleRate && samples ? samples / sampleRate : 0;

    return {
      title: displayTitle,
      artist: artist || null,
      album: tags.ALBUM?.[0]?.trim() || null,
      duration,
      sampleRate,
      bitsPerSample,
      channels,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function listAudioFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAudioFiles(full));
    } else if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

function inferFromName(name) {
  if (!name.includes(" - ")) return null;
  const parts = name.split(" - ");
  const artist = parts[parts.length - 1].replace(/\[.*?\]/g, "").trim();
  const title = parts.slice(0, -1).join(" - ").trim();
  if (!artist || !title) return null;
  return { artist, title };
}

export function scanLibrary(musicDir) {
  const files = listAudioFiles(musicDir);
  const tracks = files.map((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const id = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
    const parsed = ext === ".flac" ? parseFlacMetadata(filePath) : null;
    const fallbackTitle = path.basename(filePath, ext);
    const inferred = inferFromName(fallbackTitle);

    let title = parsed?.title || fallbackTitle;
    let artist = parsed?.artist || inferred?.artist || "未知歌手";
    const album = parsed?.album || "未知专辑";
    if (!parsed?.title && inferred) title = inferred.title;

    return {
      id,
      title,
      artist,
      album,
      duration: parsed?.duration || 0,
      sampleRate: parsed?.sampleRate || 0,
      bitsPerSample: parsed?.bitsPerSample || 0,
      channels: parsed?.channels || 0,
      filename: path.basename(filePath),
      ext: ext.slice(1),
      size: stat.size,
      mtime: stat.mtimeMs,
      path: filePath,
    };
  });

  tracks.sort((a, b) => {
    const artist = a.artist.localeCompare(b.artist, "zh-CN");
    if (artist !== 0) return artist;
    const album = a.album.localeCompare(b.album, "zh-CN");
    if (album !== 0) return album;
    return a.title.localeCompare(b.title, "zh-CN");
  });

  return tracks;
}

export function publicTrack(track) {
  const { path: _path, ...rest } = track;
  return rest;
}
