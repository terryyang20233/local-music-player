import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseFile } from "music-metadata";
import { pinyin } from "pinyin-pro";

const AUDIO_EXT = new Set([".flac", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus"]);
const COVER_NAMES = ["cover", "folder", "front", "album"];
const COVER_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const SCAN_CONCURRENCY = 8;

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~" + path.sep)) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

/** 旧版本的歌曲 ID（绝对路径的哈希），只用于迁移听歌记录。 */
export function legacyId(filePath) {
  return sha1(filePath).slice(0, 16);
}

/** 按曲库内相对路径生成的 ID：整个曲库目录搬家后仍然不变。 */
export function pathId(relPath) {
  return sha1(`path:${relPath.split(path.sep).join("/")}`).slice(0, 16);
}

/** "3/12" → 3；无法解析时返回 0。 */
function parseIndex(raw) {
  const n = Number.parseInt(String(raw || "").split("/")[0], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "-6.48 dB" → -6.48；无法解析时返回 null。 */
function parseNumber(raw) {
  const n = Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? n : null;
}

function parseYear(raw) {
  const m = /\d{4}/.exec(String(raw || ""));
  return m ? Number(m[0]) : 0;
}

/** 读 FLAC PICTURE 块头，返回图片数据在文件里的位置；优先封面正面（类型 3）。 */
async function readPictureHeader(read, blockPos, blockLength) {
  const head = await read(blockPos, Math.min(blockLength, 8 + 4096));
  if (head.length < 8) return null;
  const pictureType = head.readUInt32BE(0);
  const mimeLen = head.readUInt32BE(4);
  if (8 + mimeLen + 4 > head.length) return null;
  const mime = head.subarray(8, 8 + mimeLen).toString("ascii");
  let off = 8 + mimeLen;
  const descLen = head.readUInt32BE(off);
  off += 4 + descLen + 16; // 描述 + 宽、高、色深、调色板数
  if (off + 4 > head.length) return null;
  const dataLen = head.readUInt32BE(off);
  off += 4;
  if (!dataLen || off + dataLen > blockLength) return null;
  return { pictureType, mime: mime || "image/jpeg", offset: blockPos + off, length: dataLen };
}

/**
 * 解析 FLAC 元数据块。read(pos, length) 返回该位置的 Buffer（可能比 length 短）。
 * 只读取 STREAMINFO 和 VORBIS_COMMENT，跳过封面、填充等大块。
 */
export async function parseFlac(read) {
  const sig = await read(0, 4);
  if (sig.toString("ascii") !== "fLaC") return null;

  let pos = 4;
  const tags = {};
  let sampleRate = 0;
  let samples = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let audioMd5 = null;
  let picture = null;

  for (let i = 0; i < 64; i += 1) {
    const header = await read(pos, 4);
    if (header.length < 4) break;
    pos += 4;
    const isLast = (header[0] & 0x80) !== 0;
    const type = header[0] & 0x7f;
    const length = (header[1] << 16) | (header[2] << 8) | header[3];

    if (type === 6 && (!picture || picture.pictureType !== 3)) {
      const found = await readPictureHeader(read, pos, length);
      if (found && (!picture || found.pictureType === 3)) picture = found;
    } else if (type === 0 || type === 4) {
      const data = await read(pos, length);
      if (type === 0 && data.length >= 18) {
        sampleRate = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4);
        channels = ((data[12] >> 1) & 0x07) + 1;
        bitsPerSample = (((data[12] & 0x01) << 4) | (data[13] >> 4)) + 1;
        samples = (data[13] & 0x0f) * 0x100000000 + data.readUIntBE(14, 4);
        if (data.length >= 34) {
          // 未编码音频的 MD5：改名、移动、改标签都不会变，适合当歌曲 ID
          const md5 = data.subarray(18, 34).toString("hex");
          if (!/^0+$/.test(md5)) audioMd5 = md5;
        }
      } else if (type === 4 && data.length >= 8) {
        let offset = 0;
        const vendorLen = data.readUInt32LE(offset);
        offset += 4 + vendorLen;
        if (offset + 4 <= data.length) {
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
      }
    }
    pos += length;

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

  return {
    title: displayTitle,
    artist: artist || null,
    albumArtist: tags.ALBUMARTIST?.[0]?.trim() || null,
    album: tags.ALBUM?.[0]?.trim() || null,
    trackNo: parseIndex(tags.TRACKNUMBER?.[0]),
    discNo: parseIndex(tags.DISCNUMBER?.[0]),
    genre: tags.GENRE?.[0]?.trim() || null,
    year: parseYear(tags.DATE?.[0] || tags.YEAR?.[0]),
    replayGain: {
      trackGain: parseNumber(tags.REPLAYGAIN_TRACK_GAIN?.[0]),
      trackPeak: parseNumber(tags.REPLAYGAIN_TRACK_PEAK?.[0]),
      albumGain: parseNumber(tags.REPLAYGAIN_ALBUM_GAIN?.[0]),
      albumPeak: parseNumber(tags.REPLAYGAIN_ALBUM_PEAK?.[0]),
    },
    lyrics: (tags.LYRICS?.[0] || tags.UNSYNCEDLYRICS?.[0] || "").trim() || null,
    picture: picture ? { mime: picture.mime, offset: picture.offset, length: picture.length } : null,
    duration: sampleRate && samples ? samples / sampleRate : 0,
    sampleRate,
    bitsPerSample,
    channels,
    audioMd5,
  };
}

/** 非 FLAC 文件（MP3 / M4A / OGG …）交给 music-metadata 解析。 */
async function parseWithMusicMetadata(filePath) {
  const { common, format } = await parseFile(filePath, { skipCovers: false, duration: false });
  const pic = common.picture?.find((p) => /front/i.test(p.type || "")) || common.picture?.[0];
  return {
    title: common.title?.trim() || null,
    artist: common.artist?.trim() || common.albumartist?.trim() || null,
    albumArtist: common.albumartist?.trim() || null,
    album: common.album?.trim() || null,
    trackNo: common.track?.no || 0,
    discNo: common.disk?.no || 0,
    genre: common.genre?.[0]?.trim() || null,
    year: common.year || 0,
    replayGain: {
      trackGain: common.replaygain_track_gain?.dB ?? null,
      trackPeak: common.replaygain_track_peak?.ratio ?? null,
      albumGain: common.replaygain_album_gain?.dB ?? null,
      albumPeak: common.replaygain_album_peak?.ratio ?? null,
    },
    lyrics: null,
    // 内嵌封面在请求时再读，这里只记一下有没有
    picture: pic ? { mime: pic.format || "image/jpeg", embedded: true } : null,
    duration: format.duration || 0,
    sampleRate: format.sampleRate || 0,
    bitsPerSample: format.bitsPerSample || 0,
    channels: format.numberOfChannels || 0,
    audioMd5: null,
  };
}

/** 读取非 FLAC 文件的内嵌封面。 */
export async function readEmbeddedCover(filePath) {
  const { common } = await parseFile(filePath, { skipCovers: false, duration: false });
  const pic = common.picture?.find((p) => /front/i.test(p.type || "")) || common.picture?.[0];
  return pic ? { mime: pic.format || "image/jpeg", data: Buffer.from(pic.data) } : null;
}

export async function parseFlacMetadata(filePath) {
  const fh = await fsp.open(filePath, "r");
  try {
    return await parseFlac(async (pos, length) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, pos);
      return bytesRead === length ? buf : buf.subarray(0, bytesRead);
    });
  } finally {
    await fh.close();
  }
}

async function listAudioFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    // 跳过隐藏文件，包括 macOS 在外置盘上生成的 ._xxx.flac
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listAudioFiles(full)));
    } else if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function inferFromName(name) {
  if (!name.includes(" - ")) return null;
  const parts = name.split(" - ");
  const artist = parts[parts.length - 1].replace(/\[.*?\]/g, "").trim();
  const title = parts.slice(0, -1).join(" - ").trim();
  if (!artist || !title) return null;
  return { artist, title };
}

async function readMeta(filePath) {
  try {
    if (path.extname(filePath).toLowerCase() === ".flac") return await parseFlacMetadata(filePath);
    return await parseWithMusicMetadata(filePath);
  } catch (err) {
    console.warn(`[唱机] 无法读取标签：${filePath}（${err.message}）`);
    return null;
  }
}

/** 同目录下的 cover.jpg / folder.png 之类。 */
async function findFolderCovers(files) {
  const covers = new Map();
  const dirs = [...new Set(files.map((f) => path.dirname(f)))];
  await mapLimit(dirs, SCAN_CONCURRENCY, async (dir) => {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
    for (const base of COVER_NAMES) {
      for (const ext of COVER_EXT) {
        const hit = lower.get(base + ext);
        if (hit) {
          covers.set(dir, path.join(dir, hit));
          return;
        }
      }
    }
  });
  return covers;
}

/** 同名 .lrc 歌词文件。 */
async function findLyricsFile(filePath) {
  const lrc = filePath.slice(0, -path.extname(filePath).length) + ".lrc";
  try {
    await fsp.access(lrc);
    return lrc;
  } catch {
    return null;
  }
}

/** 搜索用的拼音：全拼和首字母，"zhoujielun" / "zjl" 都能搜到周杰伦。 */
export function searchKey(...parts) {
  const text = parts.filter(Boolean).join(" ");
  const han = /[\u3400-\u9fff]/.test(text);
  if (!han) return text.toLowerCase();
  const words = parts.filter(Boolean).map((part) => {
    const full = pinyin(part, { toneType: "none", type: "array", nonZh: "consecutive" });
    const first = pinyin(part, { pattern: "first", toneType: "none", type: "array", nonZh: "consecutive" });
    return `${full.join("")} ${first.join("")}`;
  });
  return `${text} ${words.join(" ")}`.toLowerCase();
}

function buildTrack(filePath, musicDir, stat, parsed, extras) {
  const ext = path.extname(filePath).toLowerCase();
  const fallbackTitle = path.basename(filePath, ext);
  const inferred = inferFromName(fallbackTitle);

  let title = parsed?.title || fallbackTitle;
  const artist = parsed?.artist || inferred?.artist || "未知歌手";
  const album = parsed?.album || "未知专辑";
  if (!parsed?.title && inferred) title = inferred.title;
  const relPath = path.relative(musicDir, filePath);
  const rg = parsed?.replayGain || {};

  return {
    id: parsed?.audioMd5 ? parsed.audioMd5.slice(0, 16) : pathId(relPath),
    title,
    artist,
    albumArtist: parsed?.albumArtist || artist,
    album,
    trackNo: parsed?.trackNo || 0,
    discNo: parsed?.discNo || 0,
    genre: parsed?.genre || null,
    year: parsed?.year || 0,
    duration: parsed?.duration || 0,
    sampleRate: parsed?.sampleRate || 0,
    bitsPerSample: parsed?.bitsPerSample || 0,
    channels: parsed?.channels || 0,
    replayGain: {
      trackGain: rg.trackGain ?? null,
      trackPeak: rg.trackPeak ?? null,
      albumGain: rg.albumGain ?? null,
      albumPeak: rg.albumPeak ?? null,
    },
    hasCover: Boolean(parsed?.picture || extras.folderCover),
    hasLyrics: Boolean(parsed?.lyrics || extras.lyricsFile),
    search: searchKey(title, artist, album),
    filename: path.basename(filePath),
    ext: ext.slice(1),
    size: stat.size,
    mtime: stat.mtimeMs,
    // 以下字段只在服务端使用，不会发给前端
    path: filePath,
    relPath,
    picture: parsed?.picture || null,
    folderCover: extras.folderCover || null,
    lyricsFile: extras.lyricsFile || null,
    embeddedLyrics: parsed?.lyrics || null,
  };
}

export function compareTracks(a, b) {
  const artist = a.albumArtist.localeCompare(b.albumArtist, "zh-CN");
  if (artist !== 0) return artist;
  const album = a.album.localeCompare(b.album, "zh-CN");
  if (album !== 0) return album;
  if (a.discNo !== b.discNo) return a.discNo - b.discNo;
  if (a.trackNo !== b.trackNo) {
    // 没有音轨号的排在有音轨号的后面
    if (!a.trackNo) return 1;
    if (!b.trackNo) return -1;
    return a.trackNo - b.trackNo;
  }
  return a.title.localeCompare(b.title, "zh-CN");
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 扫描曲库。cache 是上一次扫描得到的 Map(path → { size, mtime, meta })，
 * 大小和修改时间都没变的文件直接复用，不再重新解析标签。
 */
export async function scanLibrary(musicDir, cache = new Map()) {
  const files = (await listAudioFiles(musicDir)).sort((a, b) => a.localeCompare(b, "en"));
  const folderCovers = await findFolderCovers(files);
  const nextCache = new Map();
  const tracks = [];

  await mapLimit(files, SCAN_CONCURRENCY, async (filePath) => {
    try {
      const stat = await fsp.stat(filePath);
      const hit = cache.get(filePath);
      const meta =
        hit && hit.size === stat.size && hit.mtime === stat.mtimeMs ? hit.meta : await readMeta(filePath);
      nextCache.set(filePath, { size: stat.size, mtime: stat.mtimeMs, meta });
      const extras = {
        folderCover: folderCovers.get(path.dirname(filePath)) || null,
        lyricsFile: await findLyricsFile(filePath),
      };
      tracks.push(buildTrack(filePath, musicDir, stat, meta, extras));
    } catch (err) {
      console.warn(`[唱机] 跳过无法读取的文件：${filePath}（${err.message}）`);
    }
  });

  // 同一份音频出现多次（重复文件）时，后面的改用路径 ID，避免互相覆盖
  tracks.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const seen = new Set();
  for (const track of tracks) {
    if (seen.has(track.id)) track.id = pathId(track.relPath);
    seen.add(track.id);
  }

  return { tracks: tracks.sort(compareTracks), cache: nextCache };
}

const PRIVATE_FIELDS = ["path", "relPath", "picture", "folderCover", "lyricsFile", "embeddedLyrics"];

export function publicTrack(track) {
  const out = { ...track };
  for (const key of PRIVATE_FIELDS) delete out[key];
  return out;
}
