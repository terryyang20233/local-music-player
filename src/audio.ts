import type { ReplayGain } from "./types";

/**
 * ReplayGain 增益倍数。优先用单曲增益，没有再用专辑增益；
 * 有峰值信息时限制倍数，保证 增益 × 峰值 ≤ 1，不会削波。
 */
export function replayGainFactor(rg: ReplayGain | null | undefined): number {
  if (!rg) return 1;
  const db = rg.trackGain ?? rg.albumGain;
  if (db == null || !Number.isFinite(db)) return 1;
  let factor = 10 ** (db / 20);
  const peak = rg.trackGain != null ? rg.trackPeak : rg.albumPeak;
  if (peak != null && peak > 0) factor = Math.min(factor, 1 / peak);
  return factor;
}

export type SavedSession = {
  trackId: string;
  position: number;
  contextIds: string[] | null;
  queue: string[];
};

const SESSION_KEY = "changji.session";
const MAX_SAVED_CONTEXT = 5000;

/** 上次播放到哪：曲目、位置、播放列表和手动队列。读不到（隐私模式等）时返回 null。 */
export function loadSession(): SavedSession | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!raw || typeof raw.trackId !== "string") return null;
    return {
      trackId: raw.trackId,
      position: Number(raw.position) || 0,
      contextIds: Array.isArray(raw.contextIds) ? raw.contextIds : null,
      queue: Array.isArray(raw.queue) ? raw.queue : [],
    };
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession) {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...session,
        contextIds: session.contextIds && session.contextIds.length <= MAX_SAVED_CONTEXT ? session.contextIds : null,
      }),
    );
  } catch {
    /* 存不下就算了，不影响播放 */
  }
}
