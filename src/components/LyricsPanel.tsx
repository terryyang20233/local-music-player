import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLyrics } from "../api";
import { usePlaybackTime } from "../hooks/usePlayer";
import type { Lyrics, Track } from "../types";

type Props = {
  track: Track | null;
  subscribeTime: (listener: () => void) => () => void;
  getTime: () => number;
  onSeek: (t: number) => void;
};

/** 当前时间对应的歌词行（最后一个 time ≤ t 的行），二分查找。 */
function activeLine(lines: Lyrics["lines"], t: number): number {
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
  const [state, setState] = useState<{ id: string | null; lyrics: Lyrics | null; loading: boolean }>({
    id: null,
    lyrics: null,
    loading: false,
  });
  const listRef = useRef<HTMLOListElement>(null);
  const time = usePlaybackTime(subscribeTime, getTime);

  useEffect(() => {
    if (!track?.hasLyrics) {
      setState({ id: track?.id ?? null, lyrics: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState({ id: track.id, lyrics: null, loading: true });
    fetchLyrics(track.id, ctrl.signal)
      .then((lyrics) => setState({ id: track.id, lyrics, loading: false }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ id: track.id, lyrics: null, loading: false });
      });
    return () => ctrl.abort();
  }, [track?.id, track?.hasLyrics]);

  const lines = useMemo(() => state.lyrics?.lines ?? [], [state.lyrics]);
  const synced = Boolean(state.lyrics?.synced);
  const active = useMemo(() => (synced ? activeLine(lines, time) : -1), [lines, synced, time]);

  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  if (!track) return <p className="upcoming-empty">播放一首歌后在这里显示歌词</p>;
  if (state.loading) return <p className="upcoming-empty">正在读取歌词…</p>;
  if (!lines.length) {
    return (
      <p className="upcoming-empty">
        这首歌没有歌词。把同名的 <code>.lrc</code> 文件放在音频旁边即可显示。
      </p>
    );
  }

  return (
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
  );
}
