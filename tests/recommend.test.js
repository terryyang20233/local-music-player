import { describe, expect, it, vi } from "vitest";
import { LogisticRegression } from "../server/ml.js";
import { ListenStats, Recommender, labelFromListen, splitSessions } from "../server/recommend.js";

const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 0, 1);

function library() {
  const tracks = [];
  for (let a = 0; a < 6; a += 1) {
    for (let i = 0; i < 5; i += 1) {
      tracks.push({
        id: `a${a}t${i}`,
        title: `歌 ${a}-${i}`,
        artist: `歌手${a}`,
        albumArtist: `歌手${a}`,
        album: `专辑${a}`,
        duration: 200 + i,
        sampleRate: 44100,
        bitsPerSample: 16,
      });
    }
  }
  return tracks;
}

const listen = (trackId, ts, progress = 1, reason = "ended") => ({
  type: "listen",
  trackId,
  progress,
  seconds: progress * 200,
  duration: 200,
  reason,
  ts,
});

/** 歌手 0 的歌总是听完，歌手 1 的歌总是秒切，且 a0t0 之后常接 a0t1。 */
function history() {
  const events = [];
  let ts = T0;
  for (let day = 0; day < 20; day += 1) {
    for (const id of ["a0t0", "a0t1", "a0t2", "a1t0", "a0t3"]) {
      const skip = id.startsWith("a1");
      events.push(listen(id, ts, skip ? 0.05 : 1, skip ? "pick" : "ended"));
      ts += 4 * 60 * 1000;
    }
    ts += 24 * HOUR;
  }
  return events;
}

function recommender(events, extra = {}) {
  const rec = new Recommender(null);
  rec.events = events;
  Object.assign(rec, extra);
  return rec;
}

describe("labelFromListen", () => {
  it("按实际收听比例打标签", () => {
    expect(labelFromListen({ type: "listen", progress: 0.95 })).toBe(1);
    expect(labelFromListen({ type: "listen", progress: 0.6 })).toBe(0.7);
    expect(labelFromListen({ type: "listen", progress: 0.1, seconds: 10 })).toBe(0);
    expect(labelFromListen({ type: "listen", progress: 0.3, seconds: 60 })).toBeNull();
  });

  it("拖到结尾触发的 ended 不算完播", () => {
    expect(labelFromListen({ type: "listen", progress: 0.05, seconds: 9, reason: "ended" })).toBe(0);
    expect(labelFromListen({ type: "listen", progress: 0.6, reason: "ended" })).toBe(1);
  });

  it("反馈事件：喜欢正、不喜欢负、取消喜欢中性", () => {
    expect(labelFromListen({ type: "like" })).toBe(1);
    expect(labelFromListen({ type: "dislike" })).toBe(0);
    expect(labelFromListen({ type: "unlike" })).toBeNull();
  });
});

describe("ListenStats", () => {
  it("只统计收听，不把反馈当播放", () => {
    const stats = new ListenStats(library());
    stats.add(listen("a0t0", T0));
    stats.add({ type: "like", trackId: "a0t0", ts: T0 + 1 });
    expect(stats.byTrack.get("a0t0")).toMatchObject({ play: 1, complete: 1 });
    expect(stats.byArtist.get("歌手0").play).toBe(1);
  });
});

describe("splitSessions", () => {
  it("超过 30 分钟空档就切开，去掉连续重复", () => {
    const sessions = splitSessions([
      listen("x", T0),
      listen("x", T0 + 60_000),
      listen("y", T0 + 120_000),
      listen("z", T0 + 2 * HOUR),
      listen("w", T0 + 2 * HOUR + 60_000),
    ]);
    expect(sessions).toEqual([
      ["x", "y"],
      ["z", "w"],
    ]);
  });
});

describe("Recommender", () => {
  it("特征只用过去的数据：训练样本的特征值都在合理范围内", () => {
    const fit = vi.spyOn(LogisticRegression.prototype, "fit");
    const rec = recommender(history());
    rec.train(library());
    const samples = fit.mock.calls[0][0];
    fit.mockRestore();
    // 旧版本用全量统计算历史样本的"最近收听"特征，会出现 e^(正数) 的巨大值
    for (const { x } of samples) for (const v of x) expect(Math.abs(v)).toBeLessThanOrEqual(1.5);
    // 每首歌第一次出现时，它的历史播放数特征必须是 0（没有偷看到未来）
    const firstSample = samples[0];
    expect(firstSample.x[firstSample.x.length - 4]).toBe(0);
    expect(rec.metrics.trained).toBe(true);
    expect(rec.metrics.loss).toBeLessThan(1);
  });

  it("同样的数据得到同样的推荐（训练可复现）", () => {
    const tracks = library();
    const now = T0 + 25 * 24 * HOUR;
    const a = recommender(history()).recommend(tracks, { seedId: "a0t0", now }).items.map((i) => i.id);
    const b = recommender(history()).recommend(tracks, { seedId: "a0t0", now }).items.map((i) => i.id);
    expect(a).toEqual(b);
  });

  it("学到口味：常听完的歌手排在常跳过的歌手前面", () => {
    const tracks = library();
    const items = recommender(history()).recommend(tracks, { now: T0 + 25 * 24 * HOUR, limit: 30 }).items;
    const rank = (id) => items.findIndex((i) => i.id === id);
    expect(rank("a0t4")).toBeLessThan(rank("a1t1"));
  });

  it("以种子推荐时，常接着听的歌排在前面", () => {
    const tracks = library();
    const items = recommender(history()).recommend(tracks, { seedId: "a0t0", now: T0 + 25 * 24 * HOUR }).items;
    expect(items[0].id).toBe("a0t1");
    expect(items[0].reason).toContain("连着听");
    expect(items.some((i) => i.id === "a0t0")).toBe(false);
  });

  it("不喜欢的歌大幅降权，刚听过的歌暂时靠后", () => {
    const tracks = library();
    const now = T0 + 25 * 24 * HOUR;
    const base = recommender(history()).recommend(tracks, { now, limit: 30 }).items;
    const disliked = recommender(history(), { dislikes: { [base[0].id]: now } }).recommend(tracks, { now, limit: 30 }).items;
    expect(disliked.findIndex((i) => i.id === base[0].id)).toBeGreaterThan(5);

    const fresh = recommender([...history(), listen("a0t4", now - 60_000)]).recommend(tracks, { now, limit: 30 }).items;
    const before = base.findIndex((i) => i.id === "a0t4");
    expect(fresh.findIndex((i) => i.id === "a0t4")).toBeGreaterThan(before);
  });

  it("exclude 里的歌不会出现", () => {
    const items = recommender(history()).recommend(library(), { exclude: ["a0t1", "a0t2"], limit: 30 }).items;
    expect(items.map((i) => i.id)).not.toContain("a0t1");
    expect(items.map((i) => i.id)).not.toContain("a0t2");
  });

  it("冷启动：没有记录也能给出推荐", () => {
    const res = recommender([]).recommend(library(), { limit: 5 });
    expect(res.items).toHaveLength(5);
    expect(res.metrics.trained).toBe(false);
  });

  it("取消喜欢后，之前的喜欢事件不再当正样本", () => {
    const rec = recommender([{ type: "like", trackId: "a2t0", ts: T0 }], { likes: {} });
    rec.train(library());
    expect(rec.metrics.positives).toBe(0);
  });

  it("migrateIds 改写记录、喜欢和不喜欢", () => {
    const rec = recommender([listen("old", T0)], { likes: { old: 5 }, dislikes: { old2: 7 } });
    const changed = rec.migrateIds(new Map([["old", "new"], ["old2", "new2"]]));
    expect(changed).toBe(3);
    expect(rec.events[0].trackId).toBe("new");
    expect(rec.likes).toEqual({ new: 5 });
    expect(rec.dislikes).toEqual({ new2: 7 });
  });

  it("record 校验输入并把未来时间截到现在", () => {
    const rec = recommender([]);
    rec.record({ type: "evil", trackId: "a0t0", progress: 5, ts: Date.now() + 10 * HOUR });
    rec.record({ progress: 1 });
    expect(rec.events).toHaveLength(1);
    expect(rec.events[0].type).toBe("listen");
    expect(rec.events[0].progress).toBe(1);
    expect(rec.events[0].ts).toBeLessThanOrEqual(Date.now());
  });
});
