import fs from "node:fs";

const MIME = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

/** 解析单段 Range，返回 { start, end }；格式错误返回 null，越界返回 "unsatisfiable"。 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    // 后缀范围：bytes=-500 表示最后 500 字节
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

function pipeFile(res, filePath, options) {
  const stream = fs.createReadStream(filePath, options);
  stream.on("error", (err) => {
    console.warn(`[唱机] 读取失败：${filePath}（${err.message}）`);
    if (!res.headersSent) res.status(500).end();
    else res.destroy(err);
  });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

export function streamTrack(req, res, track) {
  let stat;
  try {
    stat = track ? fs.statSync(track.path) : null;
  } catch {
    stat = null;
  }
  if (!track || !stat) {
    res.status(404).json({ error: "Track not found" });
    return;
  }

  res.setHeader("Content-Type", MIME[track.ext] || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  // 无法解析的 Range 按 RFC 9110 忽略，返回整个文件
  const parsed = req.headers.range ? parseRange(req.headers.range, stat.size) : null;
  if (parsed === null) {
    res.setHeader("Content-Length", stat.size);
    pipeFile(res, track.path);
    return;
  }
  if (parsed === "unsatisfiable") {
    res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
    return;
  }

  res.status(206);
  res.setHeader("Content-Range", `bytes ${parsed.start}-${parsed.end}/${stat.size}`);
  res.setHeader("Content-Length", parsed.end - parsed.start + 1);
  pipeFile(res, track.path, { start: parsed.start, end: parsed.end });
}
