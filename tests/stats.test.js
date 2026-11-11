import { describe, expect, it } from "vitest";
import { listeningHistory, listeningStats, outcomeOf, resolveRange } from "../server/stats.js";

// 本地时间 2026-11-10（周二）20:30
const NOW = new Date(2026, 10, 10, 20, 30).getTime();
const at = (day, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

const tracks = [
  { id: "a", title: "歌 A", artist: "甲", albumArtist: "甲", album: "专辑一", hasCover: true },
  { id: "b", title: "歌 B", artist: "甲", albumArtist: "甲", album: "专辑一", hasCover: false },
  { id: "c", title: "歌 C", artist: "乙", albumArtist: "乙", album: "专辑二", hasCover: false },
];

const play = (trackId, ts, seconds = 200, duration = 200) => ({
  type: "listen",
  trackId,
  progress: seconds / duration,
  seconds,
  duration,
  reason: seconds >= duration ? "ended" : "pick",
  ts,
});

const events = [
  play("a", at(10, 9)),
  play("a", at(10, 21, 0)),
  play("b", at(9, 21), 120),
  play("c", at(9, 22), 3),
  play("c", at(8, 22), 2),
  play("c", at(3, 8), 60),
  { type: "like", trackId: "a", ts: at(10) },
  play("a", new Date(2026, 5, 1).getTime()),
];

describe("listeningStats", () => {
  it("汇总总量；跳过不算播放次数", () => {
    const s = listeningStats(events, tracks, { now: NOW, range: "30d" });
    expect(s.totals).toMatchObject({
      listens: 6,
      plays: 4,
      skips: 2,
      completed: 3,
      seconds: 585,
      distinctTracks: 3,
      distinctArtists: 2,
      activeDays: 3,
    });
    expect(s.totals.completionRate).toBeCloseTo(3 / 6);
    expect(s.firstListen).toBe(new Date(2026, 5, 1).getTime());
    expect(s.lastListen).toBe(at(10, 21));
  });

  it("时间轴按本地日期分桶，时段和星期只算真正的播放", () => {
    const s = listeningStats(events, tracks, { now: NOW, range: "30d" });
    expect(s.unit).toBe("day");
    expect(s.timeline).toHaveLength(30);
    expect(s.timeline.at(-1)).toMatchObject({ start: at(10, 0), plays: 2, skips: 0 });
    expect(s.timeline.at(-2)).toMatchObject({ plays: 1, skips: 1 });
    expect(s.hours[21].plays).toBe(2);
    expect(s.hours[22].plays).toBe(0);
    // 周一为 0：11 月 10 日和 3 日都是周二
    expect(s.weekdays[1].plays).toBe(3);
    expect(s.weekdays[0].plays).toBe(1);
  });

  it("排行：歌曲、歌手、专辑和最常跳过", () => {
    const s = listeningStats(events, tracks, { now: NOW, range: "30d" });
    expect(s.topTracks[0]).toMatchObject({ id: "a", plays: 2, completed: 2, lastPlayed: at(10, 21) });
    expect(s.topArtists[0]).toEqual({ artist: "甲", plays: 3, seconds: 520, tracks: 2 });
    expect(s.topAlbums[0]).toMatchObject({ album: "专辑一", artist: "甲", plays: 3, coverId: "a" });
    expect(s.mostSkipped).toEqual([expect.objectContaining({ id: "c", skips: 2, plays: 1 })]);
  });

  it("范围：7 天从 6 天前的 0 点开始；今年按周、全部记录跨度长时按月", () => {
    expect(resolveRange("7d", { now: NOW })).toEqual({ range: "7d", from: at(4, 0), to: at(11, 0) });
    expect(resolveRange("bogus", { now: NOW }).range).toBe("30d");
    const week = listeningStats(events, tracks, { now: NOW, range: "7d" });
    expect(week.totals.listens).toBe(5);

    const year = listeningStats(events, tracks, { now: NOW, range: "year" });
    expect(year.unit).toBe("week");
    expect(year.totals.listens).toBe(7);
    expect(year.timeline[0].start).toBe(new Date(2026, 0, 1).getTime());

    const longAgo = [...events, play("a", new Date(2023, 0, 5).getTime())];
    const all = listeningStats(longAgo, tracks, { now: NOW, range: "all" });
    expect(all.unit).toBe("month");
    expect(all.from).toBe(new Date(2023, 0, 5).getTime());
  });

  it("可以只看某首歌、某位歌手或某张专辑", () => {
    expect(listeningStats(events, tracks, { now: NOW, filter: { trackId: "c" } }).totals).toMatchObject({ listens: 3, skips: 2 });
    expect(listeningStats(events, tracks, { now: NOW, filter: { artist: "甲" } }).totals.listens).toBe(3);
    const album = listeningStats(events, tracks, { now: NOW, filter: { album: "专辑二", albumArtist: "乙" } });
    expect(album.totals.listens).toBe(3);
    expect(album.firstListen).toBe(at(3, 8));
  });
});

describe("listeningHistory", () => {
  it("新的在前，可以按时间段筛选、隐藏跳过和翻页", () => {
    const day9 = listeningHistory(events, tracks, { from: at(9, 0), to: at(10, 0) });
    expect(day9.items.map((r) => [r.trackId, r.outcome])).toEqual([
      ["c", "skipped"],
      ["b", "most"],
    ]);

    const noSkips = listeningHistory(events, tracks, { hideSkips: true });
    expect(noSkips.items.every((r) => r.outcome !== "skipped")).toBe(true);
    expect(noSkips.total).toBe(5);

    const page1 = listeningHistory(events, tracks, { limit: 4 });
    expect(page1.total).toBe(7);
    expect(page1.items[0].ts).toBe(at(10, 21));
    const page2 = listeningHistory(events, tracks, { limit: 4, before: page1.next });
    expect(page2.items).toHaveLength(3);
    expect(page2.next).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((r) => r.ts)).size).toBe(7);
  });

  it("按歌手筛选", () => {
    const rows = listeningHistory(events, tracks, { filter: { artist: "乙" } }).items;
    expect(rows.map((r) => r.trackId)).toEqual(["c", "c", "c"]);
  });
});

describe("outcomeOf", () => {
  it("和推荐模型的标签一致", () => {
    expect(outcomeOf({ progress: 1, seconds: 200, reason: "ended" })).toBe("completed");
    expect(outcomeOf({ progress: 0.6, seconds: 120, reason: "pick" })).toBe("most");
    expect(outcomeOf({ progress: 0.3, seconds: 60, reason: "pick" })).toBe("partial");
    expect(outcomeOf({ progress: 0.01, seconds: 2, reason: "pick" })).toBe("skipped");
  });
});
