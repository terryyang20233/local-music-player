import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LyricsService, artistMatches, pickLyrics, simplify } from "../server/lyricsOnline.js";

// 测试用的占位文字（繁体），不是真实歌词
const SYNCED = "[00:01.00]這是第一行測試歌詞\n[00:05.00]這是第二行";

/**
 * 假的 LRCLIB：按接口和参数返回预设结果，并记录请求过的 URL。
 * search 传函数时按查询参数返回结果（用来模拟只有繁体歌名能搜到之类的情况）。
 */
function fakeLrclib({ get = null, byArtist = [], byTitle = [], search = null, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (fail) throw new Error("offline");
    const u = new URL(url);
    let body;
    if (u.pathname.endsWith("/get")) body = get;
    else if (search) body = search(Object.fromEntries(u.searchParams));
    else body = u.searchParams.has("artist_name") ? byArtist : byTitle;
    if (body == null) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl };
}

const track = (extra = {}) => ({
  id: "abc123",
  title: "十年",
  artist: "陈奕迅",
  album: "黑白灰",
  duration: 205,
  ...extra,
});

describe("LyricsService", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changji-lyrics-"));
    dirs.push(dir);
    return dir;
  };

  it("精确匹配到带时间轴的歌词，转成简体并缓存", async () => {
    const dir = tmp();
    const lrclib = fakeLrclib({ get: { trackName: "十年", artistName: "陳奕迅", duration: 205, syncedLyrics: SYNCED } });
    const service = new LyricsService(dir, { fetchImpl: lrclib.fetchImpl });
    const first = await service.get(track());
    expect(first).toMatchObject({ status: "found", source: "lrclib", synced: true });
    expect(first.lines[0]).toEqual({ time: 1, text: "这是第一行测试歌词" });

    // 换一个实例（相当于重启）也直接读缓存，不再联网
    const again = await new LyricsService(dir, { fetchImpl: lrclib.fetchImpl }).get(track());
    expect(again.lines).toEqual(first.lines);
    expect(lrclib.calls).toHaveLength(1);
  });

  it("歌手写法不同时按歌名搜，靠拼音认出繁体歌手名，并排除时长不对的版本", async () => {
    const lrclib = fakeLrclib({
      byTitle: [
        { trackName: "晴", artistName: "别的歌手", duration: 251, syncedLyrics: "[00:01]错的" },
        { trackName: "晴", artistName: "汪蘇瀧", duration: 262, syncedLyrics: "[00:01]现场版" },
        { trackName: "晴", artistName: "汪蘇瀧", duration: 250, syncedLyrics: "[00:01]对的" },
      ],
    });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl });
    const result = await service.get(track({ title: "晴", artist: "汪苏泷", album: "", duration: 251 }));
    expect(result.status).toBe("found");
    expect(result.lines[0].text).toBe("对的");
    // 没有专辑名时跳过精确匹配，直接搜
    expect(lrclib.calls.some((u) => u.includes("/get?"))).toBe(false);
  });

  it("只有\"纯音乐\"标记时返回 instrumental", async () => {
    const lrclib = fakeLrclib({ get: { trackName: "单车", artistName: "陈奕迅", duration: 211, instrumental: true } });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl });
    const result = await service.get(track({ title: "单车", duration: 211 }));
    expect(result).toMatchObject({ status: "instrumental", source: "lrclib" });
  });

  it("没找到的结果缓存一段时间；过期或手动重新查找时再联网", async () => {
    const dir = tmp();
    let now = 1_000_000;
    const lrclib = fakeLrclib();
    const service = new LyricsService(dir, { fetchImpl: lrclib.fetchImpl, now: () => now });
    expect((await service.get(track())).status).toBe("missing");
    const afterFirst = lrclib.calls.length;
    // 精确匹配 + 歌名歌手 + 繁体歌名歌手（陈奕迅 → 陳奕迅）+ 只按歌名
    expect(afterFirst).toBe(4);

    await service.get(track());
    expect(lrclib.calls).toHaveLength(afterFirst);

    await service.get(track(), { refresh: true });
    expect(lrclib.calls).toHaveLength(afterFirst * 2);

    now += 15 * 24 * 3600 * 1000;
    await service.get(track());
    expect(lrclib.calls).toHaveLength(afterFirst * 3);
  });

  it("联网失败返回 error，一分钟内不重复请求", async () => {
    let now = 0;
    const lrclib = fakeLrclib({ fail: true });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl, now: () => now });
    expect((await service.get(track())).status).toBe("error");
    expect((await service.get(track())).status).toBe("error");
    expect(lrclib.calls).toHaveLength(1);
    now += 61_000;
    await service.get(track());
    expect(lrclib.calls).toHaveLength(2);
  });

  it("同一首歌同时请求只联网一次", async () => {
    const lrclib = fakeLrclib({ get: { trackName: "十年", artistName: "陈奕迅", duration: 205, syncedLyrics: SYNCED } });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl });
    const [a, b] = await Promise.all([service.get(track()), service.get(track())]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: "found", synced: true });
    expect(lrclib.calls).toHaveLength(1);
  });

  it("简体搜不到时用繁体歌名和歌手再搜", async () => {
    const lrclib = fakeLrclib({
      search: (q) =>
        q.track_name === "愛人錯過" && q.artist_name === "告五人"
          ? [{ trackName: "愛人錯過", artistName: "告五人", duration: 292, syncedLyrics: SYNCED }]
          : [],
    });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl });
    const result = await service.get(track({ title: "爱人错过", artist: "告五人", duration: 292 }));
    expect(result).toMatchObject({ status: "found", synced: true });
    expect(result.lines[0].text).toBe("这是第一行测试歌词");
  });

  it("简体条目误标为纯音乐、繁体条目有歌词时，用有歌词的", async () => {
    const instrumental = { trackName: "单车", artistName: "陈奕迅", duration: 211, instrumental: true };
    const lrclib = fakeLrclib({
      get: instrumental,
      search: (q) =>
        q.track_name === "單車"
          ? [{ trackName: "單車", artistName: "陳奕迅", duration: 211, syncedLyrics: SYNCED }]
          : [instrumental],
    });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl });
    expect(await service.get(track({ title: "单车", duration: 211 }))).toMatchObject({ status: "found", synced: true });
  });

  it("多位歌手时用第一位歌手搜", async () => {
    const lrclib = fakeLrclib({
      search: (q) =>
        q.artist_name === "Hardwell" ? [{ trackName: "Iris", artistName: "Hardwell", duration: 203, syncedLyrics: SYNCED }] : [],
    });
    const service = new LyricsService(null, { fetchImpl: lrclib.fetchImpl });
    const result = await service.get(track({ title: "Iris", artist: "Hardwell/Sound Rush", album: "Iris", duration: 203 }));
    expect(result).toMatchObject({ status: "found", synced: true });
  });

  it("精确匹配只有纯文本时，继续找带时间轴的版本；找不到再用纯文本", async () => {
    const plain = { trackName: "十年", artistName: "陈奕迅", duration: 205, plainLyrics: "纯文本" };
    const upgraded = fakeLrclib({
      get: plain,
      search: (q) => (q.artist_name ? [{ trackName: "十年", artistName: "陈奕迅", duration: 206, syncedLyrics: SYNCED }] : []),
    });
    const service = new LyricsService(null, { fetchImpl: upgraded.fetchImpl });
    expect(await service.get(track())).toMatchObject({ status: "found", synced: true });

    const plainOnly = fakeLrclib({ get: plain });
    const fallback = await new LyricsService(null, { fetchImpl: plainOnly.fetchImpl }).get(track());
    expect(fallback).toMatchObject({ status: "found", synced: false });
    expect(fallback.lines[0].text).toBe("纯文本");
  });

  it("本地 .lrc 优先；关掉在线查找或缺少歌手信息时不联网", async () => {
    const dir = tmp();
    const lrc = path.join(dir, "song.lrc");
    fs.writeFileSync(lrc, "[00:02.00]本地歌词");
    const lrclib = fakeLrclib({ get: { trackName: "十年", duration: 205, syncedLyrics: SYNCED } });
    const service = new LyricsService(dir, { fetchImpl: lrclib.fetchImpl });
    expect(await service.get(track({ lyricsFile: lrc }))).toMatchObject({ status: "found", source: "file" });
    expect(await service.get(track({ embeddedLyrics: "内嵌" }))).toMatchObject({ status: "found", source: "embedded" });
    expect(await service.get(track({ artist: "未知歌手" }))).toMatchObject({ status: "missing" });

    const offline = new LyricsService(dir, { online: false, fetchImpl: lrclib.fetchImpl });
    expect(await offline.get(track())).toEqual({ status: "missing", online: false });
    expect(lrclib.calls).toHaveLength(0);
  });
});

describe("歌词匹配", () => {
  it("歌手名：中英混写、繁简体、合唱", () => {
    expect(artistMatches("G.E.M. 邓紫棋", "G.E.M.")).toBe(true);
    expect(artistMatches("G.E.M. 邓紫棋", "鄧紫棋")).toBe(true);
    expect(artistMatches("汪苏泷", "汪蘇瀧")).toBe(true);
    expect(artistMatches("Ed Sheeran & Khalid", "Ed Sheeran")).toBe(true);
    expect(artistMatches("The Script", "The Beatles")).toBe(false);
    expect(artistMatches("陈奕迅", "林俊杰")).toBe(false);
  });

  it("歌名忽略副标题和括号；有时间轴的优先，其次时长更接近的", () => {
    const t = { title: "句号", artist: "邓紫棋", duration: 236 };
    const picked = pickLyrics(
      [
        { trackName: "句号", duration: 236, plainLyrics: "纯文本" },
        { trackName: "句号 - Full Stop", duration: 237, syncedLyrics: "[00:01]有时间轴" },
        { trackName: "句号 (Live)", duration: 236, syncedLyrics: "[00:01]更接近" },
        { trackName: "逗号", duration: 236, syncedLyrics: "[00:01]不是这首" },
      ],
      t,
    );
    expect(picked.syncedLyrics).toBe("[00:01]更接近");
  });

  it("歌名后面紧跟副标题也算同一首，但前缀相同的别的歌不算", () => {
    const t = { title: "偏爱", artist: "张芸京", duration: 213 };
    expect(pickLyrics([{ trackName: "偏爱-《电视剧插曲》", duration: 213, syncedLyrics: "[00:01]x" }], t)).not.toBeNull();
    expect(pickLyrics([{ trackName: "偏爱你", duration: 213, syncedLyrics: "[00:01]x" }], t)).toBeNull();
  });

  it("繁体转简体，日文不转", () => {
    expect(simplify("這個測試會轉換")).toBe("这个测试会转换");
    expect(simplify("日本語の話です")).toBe("日本語の話です");
    expect(simplify("Hello")).toBe("Hello");
  });
});
