import { useEffect, useMemo, useState } from "react";
import { coverUrl, fetchStats } from "../api";
import {
  RANGE_OPTIONS,
  WEEKDAY_LABELS,
  bucketLabel,
  compactNumber,
  listenTime,
  percent,
  rangeLabel,
  shortDate,
  timelineColumns,
} from "../statsFormat";
import { ColumnChart, type Column } from "./ColumnChart";
import { CoverArt } from "./CoverArt";
import { ListenHistory } from "./ListenHistory";
import { StatsDetail } from "./StatsDetail";
import type { ListeningStats, StatsFilter, StatsRange, Track } from "../types";

type Props = {
  tracksById: Map<string, Track>;
  /** 有新的收听记录时变化，统计跟着刷新。 */
  version: number;
  onPlay: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
  onSelectAlbum: (track: Track) => void;
};

type RankTab = "tracks" | "artists" | "albums" | "skipped";

const RANGE_KEY = "changji.statsRange";
const DAY_MS = 24 * 60 * 60 * 1000;
const RANK_PREVIEW = 10;
const RANK_TABS: { id: RankTab; label: string }[] = [
  { id: "tracks", label: "歌曲" },
  { id: "artists", label: "歌手" },
  { id: "albums", label: "专辑" },
  { id: "skipped", label: "常跳过" },
];

function loadRange(): StatsRange {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (RANGE_OPTIONS.some((r) => r.id === saved)) return saved as StatsRange;
  } catch {
    /* 隐私模式读不到就用默认 */
  }
  return "30d";
}

const pad2 = (n: number) => String(n + 1).padStart(2, "0");

/** 听歌统计页：范围切换、总量、时间轴（点柱子看那天的记录）、时段和星期分布、排行、逐条记录。 */
export function StatsPanel({ tracksById, version, onPlay, onSelectArtist, onSelectAlbum }: Props) {
  const [range, setRange] = useState<StatsRange>(loadRange);
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [tab, setTab] = useState<RankTab>("tracks");
  const [expanded, setExpanded] = useState(false);
  const [hideSkips, setHideSkips] = useState(false);
  const [details, setDetails] = useState<StatsFilter[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchStats(range)
      .then((s) => {
        if (!alive) return;
        setStats(s);
        setError(false);
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, version]);

  const pickRange = (next: StatsRange) => {
    setRange(next);
    setSelectedStart(null);
    setExpanded(false);
    try {
      localStorage.setItem(RANGE_KEY, next);
    } catch {
      /* 存不了就算了 */
    }
  };

  const goAlbum = (album: string, albumArtist: string) => {
    const track = [...tracksById.values()].find((t) => t.album === album && t.albumArtist === albumArtist);
    if (track) onSelectAlbum(track);
  };

  const timeline = useMemo(() => (stats ? timelineColumns(stats) : []), [stats]);
  const hourColumns = useMemo((): Column[] => {
    if (!stats) return [];
    return stats.hours.map((h, i) => ({
      key: String(i),
      label: `${i}:00–${i + 1}:00`,
      value: h.plays,
      detail: listenTime(h.seconds),
      tick: i % 6 === 0 ? `${i}时` : undefined,
    }));
  }, [stats]);
  const weekdayColumns = useMemo((): Column[] => {
    if (!stats) return [];
    return stats.weekdays.map((d, i) => ({
      key: String(i),
      label: WEEKDAY_LABELS[i],
      value: d.plays,
      detail: listenTime(d.seconds),
      tick: WEEKDAY_LABELS[i].slice(1),
    }));
  }, [stats]);

  if (error && !stats) return <div className="empty error">统计加载失败</div>;
  if (!stats) return <div className="empty">正在统计…</div>;
  if (stats.firstListen == null) return <div className="empty">还没有听歌记录，听几首再来看看。</div>;

  const { totals } = stats;
  const days = Math.max(1, Math.round((stats.to - stats.from) / DAY_MS));
  const selectedIndex = selectedStart == null ? -1 : stats.timeline.findIndex((b) => b.start === selectedStart);
  const bucket = selectedIndex >= 0 ? stats.timeline[selectedIndex] : null;
  const peakHour = stats.hours.reduce((best, h, i) => (h.plays > stats.hours[best].plays ? i : best), 0);
  const peakDay = stats.weekdays.reduce((best, d, i) => (d.plays > stats.weekdays[best].plays ? i : best), 0);
  const unitWord = { day: "每日", week: "每周", month: "每月" }[stats.unit];
  const openDetail = (filter: StatsFilter) => setDetails((stack) => [...stack, filter]);

  const rankRows = (): React.ReactNode => {
    if (tab === "artists") {
      const max = stats.topArtists[0]?.plays || 1;
      return stats.topArtists.slice(0, expanded ? undefined : RANK_PREVIEW).map((a, i) => (
        <li key={a.artist}>
          <button className="rank-row" type="button" onClick={() => openDetail({ artist: a.artist })}>
            <span className="rank-idx">{pad2(i)}</span>
            <CoverArt seed={a.artist} label={a.artist} size="sm" />
            <span className="rank-meta">
              <b>{a.artist}</b>
              <span className="rank-meter" aria-hidden>
                <span style={{ width: `${(a.plays / max) * 100}%` }} />
              </span>
            </span>
            <span className="rank-stat">
              <b>{a.plays} 次</b>
              <small>
                {a.tracks} 首 · {listenTime(a.seconds)}
              </small>
            </span>
          </button>
        </li>
      ));
    }
    if (tab === "albums") {
      return stats.topAlbums.slice(0, expanded ? undefined : RANK_PREVIEW).map((a, i) => (
        <li key={`${a.artist}|${a.album}`}>
          <button
            className="rank-row"
            type="button"
            onClick={() => openDetail({ album: a.album, albumArtist: a.artist })}
          >
            <span className="rank-idx">{pad2(i)}</span>
            <CoverArt seed={`${a.album}|${a.artist}`} label={a.album} size="sm" src={a.coverId ? coverUrl(a.coverId) : null} />
            <span className="rank-meta">
              <b>{a.album}</b>
              <small>{a.artist}</small>
            </span>
            <span className="rank-stat">
              <b>{a.plays} 次</b>
              <small>{listenTime(a.seconds)}</small>
            </span>
          </button>
        </li>
      ));
    }
    const rows = tab === "skipped" ? stats.mostSkipped : stats.topTracks;
    return rows.slice(0, expanded ? undefined : RANK_PREVIEW).map((row, i) => {
      const track = tracksById.get(row.id);
      if (!track) return null;
      return (
        <li key={row.id}>
          <button className="rank-row" type="button" onClick={() => openDetail({ trackId: row.id })}>
            <span className="rank-idx">{pad2(i)}</span>
            <CoverArt
              seed={`${track.album}|${track.artist}`}
              label={track.album}
              size="sm"
              src={track.hasCover ? coverUrl(track.id) : null}
            />
            <span className="rank-meta">
              <b>{track.title}</b>
              <small>
                {track.artist} · 最近 {shortDate(row.lastPlayed)}
              </small>
            </span>
            {tab === "skipped" ? (
              <span className="rank-stat">
                <b>跳过 {row.skips} 次</b>
                <small>播放 {row.plays} 次</small>
              </span>
            ) : (
              <span className="rank-stat">
                <b>{row.plays} 次</b>
                <small>
                  完播 {row.completed} · {listenTime(row.seconds)}
                </small>
              </span>
            )}
          </button>
        </li>
      );
    });
  };

  const rankTotal = {
    tracks: stats.topTracks.length,
    artists: stats.topArtists.length,
    albums: stats.topAlbums.length,
    skipped: stats.mostSkipped.length,
  }[tab];

  return (
    <div className={`stats ${loading ? "is-refreshing" : ""}`}>
      <div className="stats-toolbar">
        <div className="seg" role="radiogroup" aria-label="统计范围">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range === r.id}
              className={range === r.id ? "is-active" : ""}
              onClick={() => pickRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="sub">
          {shortDate(stats.from)} – {shortDate(stats.to - 1)} · 共 {totals.listens} 次收听
        </p>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile">
          <span>播放次数</span>
          <strong>
            {compactNumber(totals.plays)}
            <small> · 跳过 {compactNumber(totals.skips)}</small>
          </strong>
        </div>
        <div className="stat-tile">
          <span>累计收听</span>
          <strong>{listenTime(totals.seconds)}</strong>
        </div>
        <div className="stat-tile">
          <span>完播率</span>
          <strong>{totals.listens ? percent(totals.completionRate) : "—"}</strong>
        </div>
        <div className="stat-tile">
          <span>听过的歌</span>
          <strong>
            {totals.distinctTracks}
            <small> / {tracksById.size}</small>
          </strong>
        </div>
        <div className="stat-tile">
          <span>听歌天数</span>
          <strong>
            {totals.activeDays}
            <small> / {days} 天</small>
          </strong>
        </div>
        <div className="stat-tile">
          <span>日均收听</span>
          <strong>{listenTime(totals.seconds / days)}</strong>
        </div>
      </div>

      <section className="stat-card">
        <header>
          <h3>{unitWord}播放</h3>
          <p className="sub">{bucket ? "再点一次取消选择" : `点柱子查看那${{ day: "天", week: "周", month: "个月" }[stats.unit]}的记录`}</p>
        </header>
        <ColumnChart
          columns={timeline}
          ariaLabel={`${rangeLabel(range)}${unitWord}播放次数`}
          height={160}
          selected={selectedIndex >= 0 ? selectedIndex : null}
          onSelect={(i) => setSelectedStart(i == null ? null : stats.timeline[i].start)}
        />
        <details className="chart-table">
          <summary>查看数据表</summary>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>播放</th>
                <th>跳过</th>
                <th>收听时长</th>
              </tr>
            </thead>
            <tbody>
              {stats.timeline.map((b) => (
                <tr key={b.start}>
                  <td>{bucketLabel(b.start, b.end, stats.unit)}</td>
                  <td>{b.plays}</td>
                  <td>{b.skips}</td>
                  <td>{listenTime(b.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <div className="stat-columns">
        <section className="stat-card">
          <header>
            <h3>一天中的时段</h3>
            {totals.plays ? (
              <p className="sub">
                最常在 {peakHour}:00–{peakHour + 1}:00 听歌
              </p>
            ) : null}
          </header>
          <ColumnChart columns={hourColumns} ariaLabel="各时段的播放次数" height={100} />
          <details className="chart-table">
            <summary>查看数据表</summary>
            <table>
              <tbody>
                {stats.hours.map((h, i) => (
                  <tr key={i}>
                    <td>
                      {i}:00–{i + 1}:00
                    </td>
                    <td>{h.plays} 次</td>
                    <td>{listenTime(h.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="stat-card">
          <header>
            <h3>一周中的分布</h3>
            {totals.plays ? <p className="sub">{WEEKDAY_LABELS[peakDay]}听得最多</p> : null}
          </header>
          <ColumnChart columns={weekdayColumns} ariaLabel="周一到周日的播放次数" height={100} />
          <details className="chart-table">
            <summary>查看数据表</summary>
            <table>
              <tbody>
                {stats.weekdays.map((d, i) => (
                  <tr key={i}>
                    <td>{WEEKDAY_LABELS[i]}</td>
                    <td>{d.plays} 次</td>
                    <td>{listenTime(d.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      </div>

      <section className="stat-card">
        <header>
          <h3>排行</h3>
          <div className="tabs is-small" role="tablist" aria-label="排行类型">
            {RANK_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "is-active" : ""}
                onClick={() => {
                  setTab(t.id);
                  setExpanded(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </header>
        {rankTotal ? (
          <ol className="rank-rows">{rankRows()}</ol>
        ) : (
          <p className="history-empty">
            {tab === "skipped" ? "这段时间没有反复跳过的歌" : "这段时间还没有播放记录"}
          </p>
        )}
        {rankTotal > RANK_PREVIEW ? (
          <button className="link-btn rank-more" type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起" : `显示全部 ${rankTotal} 项`}
          </button>
        ) : null}
      </section>

      <section className="stat-card">
        <header>
          <h3>
            听歌记录
            {bucket ? (
              <button className="chip" type="button" onClick={() => setSelectedStart(null)} title="取消筛选">
                {bucketLabel(bucket.start, bucket.end, stats.unit)} ×
              </button>
            ) : null}
          </h3>
          <label className="check">
            <input type="checkbox" checked={hideSkips} onChange={(e) => setHideSkips(e.target.checked)} />
            隐藏跳过
          </label>
        </header>
        <ListenHistory
          tracksById={tracksById}
          from={bucket ? bucket.start : stats.from}
          to={bucket ? bucket.end : stats.to}
          hideSkips={hideSkips}
          version={version}
          onOpenTrack={(track) => openDetail({ trackId: track.id })}
          onPlay={onPlay}
        />
      </section>

      {details.length ? (
        <StatsDetail
          filter={details[details.length - 1]}
          range={range}
          tracksById={tracksById}
          version={version}
          canGoBack={details.length > 1}
          onBack={() => setDetails((stack) => stack.slice(0, -1))}
          onClose={() => setDetails([])}
          onOpen={openDetail}
          onPlay={onPlay}
          onGoArtist={(artist) => {
            setDetails([]);
            onSelectArtist(artist);
          }}
          onGoAlbum={(album, albumArtist) => {
            setDetails([]);
            goAlbum(album, albumArtist);
          }}
        />
      ) : null}
    </div>
  );
}
