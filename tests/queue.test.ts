import { describe, expect, it } from "vitest";
import { buildQueue, buildUpcoming, pushId, sameIdSet, shuffleIds, stepInQueue } from "../src/queue";
import type { Track } from "../src/types";

const track = (id: string, artist = "A"): Track =>
  ({ id, title: id, artist, albumArtist: artist, album: "x", duration: 100 }) as Track;

const list = [track("1"), track("2", "B"), track("3"), track("4", "B")];
const byId = new Map(list.map((t) => [t.id, t]));

describe("queue helpers", () => {
  it("pushId 去掉紧邻重复并截断", () => {
    expect(pushId(["a", "b"], "b", 5)).toEqual(["a", "b"]);
    expect(pushId(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });

  it("sameIdSet 不看顺序", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
  });

  it("shuffleIds 是一个排列，当前曲目放第一位", () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = shuffleIds(["a", "b", "c", "d", "e"], "d", rng);
    expect(out[0]).toBe("d");
    expect([...out].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("stepInQueue 循环前进后退；不在列表里时从头开始", () => {
    expect(stepInQueue(list, "4", 1)?.id).toBe("1");
    expect(stepInQueue(list, "1", -1)?.id).toBe("4");
    expect(stepInQueue(list, "zzz", 1)?.id).toBe("1");
    expect(stepInQueue([], "1", 1)).toBeNull();
  });

  it("buildQueue：歌手循环只留同一歌手，随机按洗牌顺序", () => {
    const base = { tracks: list, contextTracks: list, byId, shuffleOrder: ["3", "1", "4", "2"] };
    expect(buildQueue({ ...base, current: list[1], mode: "repeat-artist" }).map((t) => t.id)).toEqual(["2", "4"]);
    expect(buildQueue({ ...base, current: list[0], mode: "shuffle" }).map((t) => t.id)).toEqual(["3", "1", "4", "2"]);
    expect(buildQueue({ ...base, current: list[0], mode: "repeat-all", contextTracks: [list[2], list[3]] })).toHaveLength(2);
  });

  it("buildUpcoming：智能模式用推荐并排除最近播放，单曲循环只显示当前", () => {
    const recs = [
      { id: "3", track: list[2], score: 1, pLike: 1, reason: "r3" },
      { id: "4", track: list[3], score: 1, pLike: 1, reason: "r4" },
    ];
    const smart = buildUpcoming({ queue: list, current: list[0], mode: "smart", recommendItems: recs, recentIds: ["3"], count: 8 });
    expect(smart.map((i) => i.track.id)).toEqual(["4"]);
    const one = buildUpcoming({ queue: list, current: list[0], mode: "repeat-one", recentIds: [], count: 8 });
    expect(one).toHaveLength(1);
    const all = buildUpcoming({ queue: list, current: list[2], mode: "repeat-all", recentIds: [], count: 8 });
    expect(all.map((i) => i.track.id)).toEqual(["4", "1", "2"]);
  });
});
