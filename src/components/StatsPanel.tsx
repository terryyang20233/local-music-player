import { useEffect, useState } from "react";
import { fetchStats, formatDuration } from "../api";
import type { ListeningStats, Track } from "../types";

type Props = {
  tracksById: Map<string, Track>;
  onPlay: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
};

const compact = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString("zh-CN"));

function shortDay(day: string) {
  const [, m, d] = day.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 听歌统计页：概览数字、近 30 天每日播放、最常听的歌手与歌曲。 */
export function StatsPanel({ tracksById, onPlay, onSelectArtist }: Props) {
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  if (error) return <div className="empty error">统计加载失败</div>;
  if (!stats) return <div className="empty">正在统计…</div>;
  if (stats.totalPlays === 0) return <div className="empty">还没有听歌记录，听几首再来看看。</div>;

  const maxDay = Math.max(1, ...stats.daily.map((d) => d.plays));
  const maxArtist = Math.max(1, ...stats.topArtists.map((a) => a.plays));
  const recent = stats.daily.reduce((s, d) => s + d.plays, 0);
  const hovered = hover != null ? stats.daily[hover] : null;

  return (
    <div className="stats">
      <div className="stat-tiles">
        <div className="stat-tile">
          <span>播放次数</span>
          <strong>{compact(stats.totalPlays)}</strong>
        </div>
        <div className="stat-tile">
          <span>累计收听</span>
          <strong>{formatDuration(stats.totalSeconds)}</strong>
        </div>
        <div className="stat-tile">
          <span>完播率</span>
          <strong>{Math.round(stats.completionRate * 100)}%</strong>
        </div>
        <div className="stat-tile">
          <span>听过的歌</span>
          <strong>
            {stats.distinctTracks}
            <small> / {tracksById.size}</small>
          </strong>
        </div>
      </div>

      <section className="stat-card">
        <header>
          <h3>近 30 天每日播放</h3>
          <p className="sub">共 {recent} 次</p>
        </header>
        <div className="day-chart" onMouseLeave={() => setHover(null)}>
          <div className="day-axis" aria-hidden>
            <span>{maxDay}</span>
            <span>0</span>
          </div>
          <div className="day-plot" role="img" aria-label={`近 30 天每日播放次数，最多一天 ${maxDay} 次`}>
            {stats.daily.map((d, i) => (
              <div
                key={d.day}
                className={`day-col ${hover === i ? "is-hover" : ""}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${shortDay(d.day)} ${d.plays} 次`}
              >
                <span className="day-bar" style={{ height: `${(d.plays / maxDay) * 100}%` }} />
              </div>
            ))}
            {hovered ? (
              <div
                className="chart-tip"
                style={{ left: `${((hover! + 0.5) / stats.daily.length) * 100}%` }}
                role="status"
              >
                <b>{hovered.plays} 次</b>
                <span>{shortDay(hovered.day)}</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="day-labels" aria-hidden>
          <span>{shortDay(stats.daily[0].day)}</span>
          <span>{shortDay(stats.daily[stats.daily.length - 1].day)}</span>
        </div>
        <details className="chart-table">
          <summary>查看数据表</summary>
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>播放次数</th>
              </tr>
            </thead>
            <tbody>
              {stats.daily.map((d) => (
                <tr key={d.day}>
                  <td>{shortDay(d.day)}</td>
                  <td>{d.plays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <div className="stat-columns">
        <section className="stat-card">
          <header>
            <h3>最常听的歌手</h3>
          </header>
          <ol className="rank-bars">
            {stats.topArtists.map((a) => (
              <li key={a.artist}>
                <button type="button" onClick={() => onSelectArtist(a.artist)} title={`查看 ${a.artist}`}>
                  <span className="rank-name">{a.artist}</span>
                  <span className="rank-track">
                    <span className="rank-fill" style={{ width: `${(a.plays / maxArtist) * 100}%` }} />
                  </span>
                  <span className="rank-value">{a.plays}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="stat-card">
          <header>
            <h3>最常听的歌</h3>
          </header>
          <ol className="rank-list">
            {stats.topTracks.map((row, i) => {
              const track = tracksById.get(row.id);
              if (!track) return null;
              return (
                <li key={row.id}>
                  <button type="button" onClick={() => onPlay(track)} title={`播放 ${track.title}`}>
                    <span className="rank-idx">{String(i + 1).padStart(2, "0")}</span>
                    <span className="rank-meta">
                      <b>{track.title}</b>
                      <small>{track.artist}</small>
                    </span>
                    <span className="rank-value">{row.plays} 次</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}
