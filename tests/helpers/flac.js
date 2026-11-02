/** 在内存里拼一个最小的 FLAC 头（只有元数据块，没有音频帧），用于测试解析。 */

function blockHeader(type, length, last) {
  const h = Buffer.alloc(4);
  h[0] = (last ? 0x80 : 0) | type;
  h.writeUIntBE(length, 1, 3);
  return h;
}

function streamInfo({ sampleRate = 44100, channels = 2, bits = 16, samples = 44100 * 180, md5 = "ab".repeat(16) }) {
  const b = Buffer.alloc(34);
  b.writeUInt16BE(4096, 0);
  b.writeUInt16BE(4096, 2);
  const packed =
    (BigInt(sampleRate) << 44n) |
    (BigInt(channels - 1) << 41n) |
    (BigInt(bits - 1) << 36n) |
    BigInt(samples);
  b.writeBigUInt64BE(packed, 10);
  Buffer.from(md5, "hex").copy(b, 18);
  return b;
}

function vorbisComment(tags) {
  const vendor = Buffer.from("test");
  const parts = [Buffer.alloc(4), vendor, Buffer.alloc(4)];
  parts[0].writeUInt32LE(vendor.length);
  const entries = Object.entries(tags).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}=${x}`));
  parts[2].writeUInt32LE(entries.length);
  for (const entry of entries) {
    const body = Buffer.from(entry, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length);
    parts.push(len, body);
  }
  return Buffer.concat(parts);
}

function pictureBlock({ type = 3, mime = "image/png", data }) {
  const mimeBuf = Buffer.from(mime);
  const head = Buffer.alloc(4 + 4 + mimeBuf.length + 4 + 16 + 4);
  let o = 0;
  head.writeUInt32BE(type, o);
  o += 4;
  head.writeUInt32BE(mimeBuf.length, o);
  o += 4;
  mimeBuf.copy(head, o);
  o += mimeBuf.length;
  head.writeUInt32BE(0, o); // 描述长度
  o += 4 + 16;
  head.writeUInt32BE(data.length, o);
  return Buffer.concat([head, data]);
}

export function buildFlac({ info = {}, tags = {}, picture = null } = {}) {
  const blocks = [
    [0, streamInfo(info)],
    [4, vorbisComment(tags)],
    ...(picture ? [[6, pictureBlock(picture)]] : []),
  ];
  const parts = [Buffer.from("fLaC")];
  blocks.forEach(([type, body], i) => parts.push(blockHeader(type, body.length, i === blocks.length - 1), body));
  return Buffer.concat(parts);
}

/** parseFlac 需要的读取函数：从 Buffer 里按位置取一段。 */
export function bufferReader(buf) {
  return async (pos, length) => buf.subarray(pos, pos + length);
}
