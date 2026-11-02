import { describe, expect, it } from "vitest";
import { listeningStats } from "../server/stats.js";

describe("listeningStats", () => {
  it("汇总播放次数、时长、完播率和排行", () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const tracks = [
      { id: "a", artist: "甲" },
      { id: "b", artist: "乙" },
    ];
    const events = [
      { type: "listen", trackId: "a", progress: 1, seconds: 200, ts: now - 1000 },
      { type: "listen", trackId: "a", progress: 1, seconds: 200, ts: now - 2000 },
      { type: "listen", trackId: "b", progress: 0.05, seconds: 5, ts: now - 3 * 86400e3 },
      { type: "like", trackId: "b", ts: now },
    ];
    const s = listeningStats(events, tracks, { now });
    expect(s.totalPlays).toBe(3);
    expect(s.totalSeconds).toBe(405);
    expect(s.completionRate).toBeCloseTo(2 / 3);
    expect(s.skipRate).toBeCloseTo(1 / 3);
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1).plays).toBe(2);
    expect(s.topArtists[0]).toEqual({ artist: "甲", plays: 2 });
    expect(s.topTracks[0]).toEqual({ id: "a", plays: 2 });
  });
});
