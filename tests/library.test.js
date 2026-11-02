import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareTracks, parseFlac, publicTrack, scanLibrary, searchKey } from "../server/library.js";
import { bufferReader, buildFlac } from "./helpers/flac.js";

describe("parseFlac", () => {
  it("读取 STREAMINFO、标签和音频 MD5", async () => {
    const buf = buildFlac({
      info: { sampleRate: 96000, channels: 2, bits: 24, samples: 96000 * 200, md5: "0123456789abcdef".repeat(2) },
      tags: {
        TITLE: "晴天",
        ARTIST: "周杰伦",
        ALBUM: "叶惠美",
        TRACKNUMBER: "3/11",
        DISCNUMBER: "1",
        DATE: "2003-07-31",
        GENRE: "Pop",
        REPLAYGAIN_TRACK_GAIN: "-6.48 dB",
        REPLAYGAIN_TRACK_PEAK: "0.988",
      },
    });
    const meta = await parseFlac(bufferReader(buf));
    expect(meta).toMatchObject({
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      trackNo: 3,
      discNo: 1,
      year: 2003,
      genre: "Pop",
      sampleRate: 96000,
      bitsPerSample: 24,
      channels: 2,
      audioMd5: "0123456789abcdef".repeat(2),
    });
    expect(meta.duration).toBeCloseTo(200);
    expect(meta.replayGain.trackGain).toBeCloseTo(-6.48);
    expect(meta.replayGain.trackPeak).toBeCloseTo(0.988);
  });

  it("记录封面在文件里的位置，不把图片读进内存", async () => {
    const data = Buffer.from("fake-png-bytes");
    const buf = buildFlac({ tags: { TITLE: "x" }, picture: { mime: "image/png", data } });
    const meta = await parseFlac(bufferReader(buf));
    expect(meta.picture).toMatchObject({ mime: "image/png", length: data.length });
    expect(buf.subarray(meta.picture.offset, meta.picture.offset + meta.picture.length)).toEqual(data);
  });

  it("没有 ARTIST 时从 \"标题 - 歌手\" 推断", async () => {
    const meta = await parseFlac(bufferReader(buildFlac({ tags: { TITLE: "演员 - 薛之谦[Live]" } })));
    expect(meta.title).toBe("演员");
    expect(meta.artist).toBe("薛之谦");
  });

  it("全零 MD5 视为没有", async () => {
    const meta = await parseFlac(bufferReader(buildFlac({ info: { md5: "00".repeat(16) } })));
    expect(meta.audioMd5).toBeNull();
  });

  it("不是 FLAC 返回 null，截断的文件不抛错", async () => {
    expect(await parseFlac(bufferReader(Buffer.from("ID3\u0003....")))).toBeNull();
    const truncated = buildFlac({ tags: { TITLE: "x" } }).subarray(0, 50);
    await expect(parseFlac(bufferReader(truncated))).resolves.toBeTruthy();
  });
});

describe("searchKey", () => {
  it("包含原文、全拼和首字母", () => {
    const key = searchKey("晴天", "周杰伦");
    expect(key).toContain("晴天");
    expect(key).toContain("qingtian");
    expect(key).toContain("zhoujielun");
    expect(key).toContain("zjl");
  });

  it("纯英文只转小写", () => {
    expect(searchKey("Fix You", "Coldplay")).toBe("fix you coldplay");
  });
});

describe("compareTracks", () => {
  const t = (title, trackNo, extra = {}) => ({ title, trackNo, discNo: 0, album: "A", albumArtist: "X", ...extra });

  it("同一专辑按碟号、音轨号排序，没有音轨号的排后面", () => {
    const sorted = [t("c", 0), t("b", 2), t("a", 1), t("z", 1, { discNo: 2 })].sort(compareTracks);
    expect(sorted.map((x) => x.title)).toEqual(["a", "b", "c", "z"]);
  });
});

describe("scanLibrary", () => {
  const dirs = [];
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changji-test-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("识别封面、歌词，跳过隐藏文件；搬家后 ID 不变", async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "album"));
    fs.writeFileSync(path.join(root, "album", "song.flac"), buildFlac({ tags: { TITLE: "歌", ARTIST: "人" } }));
    fs.writeFileSync(path.join(root, "album", "song.lrc"), "[00:01.00]hi");
    fs.writeFileSync(path.join(root, "album", "Cover.JPG"), "jpg");
    fs.writeFileSync(path.join(root, "album", "._song.flac"), "appledouble");
    fs.writeFileSync(path.join(root, "notes.txt"), "not audio");

    const { tracks, cache } = await scanLibrary(root);
    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    expect(track).toMatchObject({ title: "歌", artist: "人", hasCover: true, hasLyrics: true });
    expect(publicTrack(track).path).toBeUndefined();
    expect(publicTrack(track).folderCover).toBeUndefined();

    // 缓存命中时直接复用
    const again = await scanLibrary(root, cache);
    expect(again.tracks[0].id).toBe(track.id);

    const moved = tmp();
    fs.cpSync(root, path.join(moved, "nested"), { recursive: true });
    const after = await scanLibrary(moved);
    expect(after.tracks[0].id).toBe(track.id);
  });

  it("重复的音频文件不会共用一个 ID", async () => {
    const root = tmp();
    const buf = buildFlac({ tags: { TITLE: "same" } });
    fs.writeFileSync(path.join(root, "a.flac"), buf);
    fs.writeFileSync(path.join(root, "b.flac"), buf);
    const { tracks } = await scanLibrary(root);
    expect(new Set(tracks.map((t) => t.id)).size).toBe(2);
  });

  it("目录不存在时返回空曲库", async () => {
    const { tracks } = await scanLibrary(path.join(os.tmpdir(), "changji-does-not-exist"));
    expect(tracks).toEqual([]);
  });
});
