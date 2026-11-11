import { useEffect, useMemo, useRef, useState } from "react";
import { coverUrl, fetchHistory, formatTime } from "../api";
import { clock, dayHeading, outcomeLabel, startOfDay } from "../statsFormat";
import { CoverArt } from "./CoverArt";
import { IconPlay } from "./Icons";
import type { HistoryItem, StatsFilter, Track } from "../types";

type Props = {
  tracksById: Map<string, Track>;
  from?: number;
  to?: number;
  filter?: StatsFilter | null;
  hideSkips: boolean;
  /** 有新的收听记录时变化，刷新列表。 */
  version: number;
  /** 只看一首歌时不重复显示歌名和封面。 */
  compact?: boolean;
  pageSize?: number;
  onOpenTrack: (track: Track) => void;
  onPlay: (track: Track) => void;
};

type State = { items: HistoryItem[]; total: number; next: number | null; loading: boolean; error: boolean };

/** 听歌记录明细：按天分组，新的在前，可以加载更多。 */
export function ListenHistory({
  tracksById,
  from,
  to,
  filter = null,
  hideSkips,
  version,
  compact = false,
  pageSize = 40,
  onOpenTrack,
  onPlay,
}: Props) {
  const [state, setState] = useState<State>({ items: [], total: 0, next: null, loading: true, error: false });
  const queryKey = JSON.stringify([from, to, filter, hideSkips]);
  const lastKeyRef = useRef<string | null>(null);
  const loadedRef = useRef(0);
  loadedRef.current = state.items.length;

  useEffect(() => {
    // 只是有了新记录（条件没变）时，保留已经加载的条数，不把翻到的页收起来
    const sameQuery = lastKeyRef.current === queryKey;
    lastKeyRef.current = queryKey;
    const limit = sameQuery ? Math.max(pageSize, loadedRef.current) : pageSize;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: false, ...(sameQuery ? {} : { items: [], next: null }) }));
    const query = JSON.parse(queryKey) as [number | undefined, number | undefined, StatsFilter | null, boolean];
    fetchHistory({ from: query[0], to: query[1], filter: query[2], hideSkips: query[3], limit })
      .then((page) => alive && setState({ ...page, loading: false, error: false }))
      .catch(() => alive && setState((s) => ({ ...s, loading: false, error: true })));
    return () => {
      alive = false;
    };
  }, [pageSize, queryKey, version]);

  const loadMore = () => {
    if (state.next == null || state.loading) return;
    setState((s) => ({ ...s, loading: true }));
    fetchHistory({ from, to, filter, hideSkips, before: state.next, limit: pageSize })
      .then((page) => setState((s) => ({ items: [...s.items, ...page.items], total: page.total, next: page.next, loading: false, error: false })))
      .catch(() => setState((s) => ({ ...s, loading: false, error: true })));
  };

  const groups = useMemo(() => {
    const out: { day: number; items: HistoryItem[] }[] = [];
    for (const item of state.items) {
      const day = startOfDay(item.ts);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [state.items]);

  if (state.error && state.items.length === 0) return <p className="history-empty">听歌记录加载失败</p>;
  if (state.loading && state.items.length === 0) return <p className="history-empty">正在读取听歌记录…</p>;
  if (state.items.length === 0) return <p className="history-empty">这段时间没有听歌记录</p>;

  return (
    <div className={`history ${compact ? "is-compact" : ""}`}>
      {groups.map((group) => (
        <section key={group.day} className="history-group">
          <h4 className="history-day">{dayHeading(group.day)}</h4>
          <ol className="history-list">
            {group.items.map((item) => {
              const track = tracksById.get(item.trackId);
              const label = outcomeLabel(item.outcome, item.progress);
              return (
                <li key={`${item.ts}-${item.trackId}`} className={`history-row is-${item.outcome}`}>
                  <span className="history-time">{clock(item.ts)}</span>
                  {compact ? null : (
                    <CoverArt
                      seed={track ? `${track.album}|${track.artist}` : item.trackId}
                      label={track?.album}
                      size="sm"
                      src={track?.hasCover ? coverUrl(track.id) : null}
                    />
                  )}
                  {compact ? (
                    <span className="history-main">
                      <small>
                        收听 {formatTime(item.seconds)} / {formatTime(item.duration)}
                      </small>
                    </span>
                  ) : track ? (
                    <button className="history-main" type="button" onClick={() => onOpenTrack(track)} title="查看这首歌的统计">
                      <b>{track.title}</b>
                      <small>
                        {track.artist} · 收听 {formatTime(item.seconds)} / {formatTime(item.duration)}
                      </small>
                    </button>
                  ) : (
                    <span className="history-main">
                      <b>已不在曲库中的歌</b>
                      <small>收听 {formatTime(item.seconds)}</small>
                    </span>
                  )}
                  <span className={`outcome is-${item.outcome}`}>{label}</span>
                  {track ? (
                    <button
                      className="icon-btn history-play"
                      type="button"
                      aria-label={`播放《${track.title}》`}
                      title="播放"
                      onClick={() => onPlay(track)}
                    >
                      <IconPlay size={14} />
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p className="history-foot">
        已显示 {state.items.length} / {state.total} 条
        {state.next != null ? (
          <button className="link-btn" type="button" onClick={loadMore} disabled={state.loading}>
            {state.loading ? "加载中…" : "加载更多"}
          </button>
        ) : null}
      </p>
    </div>
  );
}
