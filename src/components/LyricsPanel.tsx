import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLyrics } from "../api";
import { usePlaybackTime } from "../hooks/usePlayer";
import type { LyricLine, LyricsResult, Track } from "../types";

type Props = {
  track: Track | null;
  subscribeTime: (listener: () => void) => () => void;
  getTime: () => number;
  onSeek: (t: number) => void;
};

const NO_LINES: LyricLine[] = [];

const SOURCE_LABEL: Record<string, string> = {
  file: "歌词来自同名 .lrc 文件",
  embedded: "歌词来自音频内嵌标签",
  lrclib: "歌词来自 LRCLIB 在线歌词库",
};

/** 当前时间对应的歌词行（最后一个 time ≤ t 的行），二分查找。 */
function activeLine(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].time ?? 0) <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function LyricsPanel({ track, subscribeTime, getTime, onSeek }: Props) {
  const [state, setState] = useState<{ id: string | null; result: LyricsResult | null }>({ id: null, result: null });
  const listRef = useRef<HTMLOListElement>(null);
  const time = usePlaybackTime(subscribeTime, getTime);
  const trackId = track?.id ?? null;

  const load = useCallback((id: string, refresh = false) => {
    setState({ id, result: null });
    fetchLyrics(id, { refresh }).then(
      (result) => setState((s) => (s.id === id ? { id, result } : s)),
      () => setState((s) => (s.id === id ? { id, result: { status: "error", online: true } } : s)),
    );
  }, []);

  useEffect(() => {
    if (trackId) load(trackId);
    else setState({ id: null, result: null });
  }, [load, trackId]);

  const result = state.id === trackId ? state.result : null;
  const lines = result?.status === "found" ? result.lines : NO_LINES;
  const synced = result?.status === "found" && result.synced;
  const active = useMemo(() => (synced ? activeLine(lines, time) : -1), [lines, synced, time]);

  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  if (!track) return <p className="upcoming-empty">播放一首歌后在这里显示歌词</p>;
  if (!result) return <p className="upcoming-empty">正在查找歌词…</p>;

  const retry = (
    <button className="link-btn" type="button" onClick={() => load(track.id, true)}>
      重新查找
    </button>
  );
  const lrcHint = (
    <>
      也可以把同名的 <code>.lrc</code> 文件放在音频旁边。
    </>
  );

  if (result.status === "error") {
    return (
      <div className="upcoming-empty">
        <p>暂时连不上歌词库，请检查网络。</p>
        {retry}
      </div>
    );
  }
  if (result.status === "instrumental") {
    return (
      <div className="upcoming-empty">
        <p>歌词库把这首歌标记为纯音乐。如果不对，{lrcHint}</p>
        {retry}
      </div>
    );
  }
  if (result.status !== "found") {
    return (
      <div className="upcoming-empty">
        <p>
          {result.online === false ? "这首歌没有歌词，在线查找已关闭。" : "没有找到这首歌的歌词。"}
          {lrcHint}
        </p>
        {result.online === false ? null : retry}
      </div>
    );
  }

  return (
    <>
      <ol className={`lyrics ${synced ? "is-synced" : ""}`} ref={listRef} aria-label="歌词">
        {lines.map((line, i) => (
          <li key={i} className={i === active ? "is-active" : ""} aria-current={i === active ? "true" : undefined}>
            {synced && line.time != null ? (
              <button type="button" onClick={() => onSeek(line.time!)} title="跳到这一句">
                {line.text || "♪"}
              </button>
            ) : (
              line.text
            )}
          </li>
        ))}
      </ol>
      <p className="lyrics-source">
        {SOURCE_LABEL[result.source] ?? "歌词"}
        {synced ? "" : " · 没有时间轴，不会自动滚动"}
      </p>
    </>
  );
}
