import type { PlayMode, RecommendItem, Track, UpcomingItem } from "./types";

/** 洗牌；currentId 若在列表里则放到第一位。 */
export function shuffleIds(ids: string[], currentId?: string | null, rng: () => number = Math.random): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  if (currentId) {
    const idx = copy.indexOf(currentId);
    if (idx > 0) {
      copy.splice(idx, 1);
      copy.unshift(currentId);
    }
  }
  return copy;
}

/** 追加 id，去掉紧邻的重复（单曲循环），并截断到 limit。 */
export function pushId(list: string[], id: string, limit: number): string[] {
  if (list[list.length - 1] === id) return list;
  return [...list, id].slice(-limit);
}

/** 两个 id 列表是否包含同一组元素（不看顺序）。 */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const known = new Set(a);
  return b.every((id) => known.has(id));
}

type QueueInput = {
  tracks: Track[];
  contextTracks: Track[];
  current: Track | null;
  mode: PlayMode;
  shuffleOrder: string[];
  byId: Map<string, Track>;
};

/** 当前模式下"上一首 / 下一首"所走的列表。 */
export function buildQueue({ tracks, contextTracks, current, mode, shuffleOrder, byId }: QueueInput): Track[] {
  if (!current) return contextTracks;
  if (mode === "repeat-artist") {
    return tracks.filter((t) => t.artist === current.artist);
  }
  if (mode === "shuffle") {
    const ordered = shuffleOrder.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
    return ordered.length ? ordered : contextTracks;
  }
  return contextTracks;
}

/** 在 queue 里从 currentId 走 delta 步（循环）；currentId 不在列表里时从头开始。 */
export function stepInQueue(queue: Track[], currentId: string, delta: number): Track | null {
  if (queue.length === 0) return null;
  const idx = queue.findIndex((t) => t.id === currentId);
  return queue[(idx + delta + queue.length) % queue.length] ?? null;
}

type UpcomingInput = {
  queue: Track[];
  current: Track | null;
  mode: PlayMode;
  recommendItems?: RecommendItem[];
  recentIds: string[];
  count: number;
};

/** "即将播放"面板：智能模式取模型推荐，其他模式按队列往后数。 */
export function buildUpcoming({ queue, current, mode, recommendItems, recentIds, count }: UpcomingInput): UpcomingItem[] {
  if (mode === "smart") {
    const fromModel = (recommendItems ?? [])
      .filter((item) => item.track && item.id !== current?.id && !recentIds.includes(item.id))
      .slice(0, count)
      .map((item) => ({ track: item.track, reason: item.reason }));
    if (fromModel.length > 0) return fromModel;
  }

  if (queue.length === 0) return [];
  if (!current) {
    return queue.slice(0, count).map((track) => ({ track }));
  }
  if (mode === "repeat-one") {
    return [{ track: current, reason: "单曲循环" }];
  }
  const idx = queue.findIndex((t) => t.id === current.id);
  if (idx < 0) {
    return queue.slice(0, count).map((track) => ({ track }));
  }
  const out: UpcomingItem[] = [];
  const n = Math.min(count, Math.max(0, queue.length - 1));
  for (let i = 1; i <= n; i += 1) {
    const track = queue[(idx + i) % queue.length];
    if (track) out.push({ track });
  }
  return out;
}
