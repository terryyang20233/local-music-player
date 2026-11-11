import { useEffect, useMemo, useRef, useState } from "react";
import { coverUrl, fetchStats } from "../api";
import { bucketLabel, compactNumber, listenTime, percent, rangeLabel, shortDate, timelineColumns } from "../statsFormat";
import { ColumnChart } from "./ColumnChart";
import { CoverArt } from "./CoverArt";
import { IconClose, IconPlay } from "./Icons";
import { ListenHistory } from "./ListenHistory";
import type { ListeningStats, StatsFilter, StatsRange, Track } from "../types";

type Props = {
  filter: StatsFilter;
  range: StatsRange;
  tracksById: Map<string, Track>;
  version: number;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpen: (filter: StatsFilter) => void;
  onPlay: (track: Track) => void;
  onGoArtist: (artist: string) => void;
  onGoAlbum: (album: string, albumArtist: string) => void;
};

/** 单首歌 / 歌手 / 专辑的统计详情：总量、时间轴、最常听的歌和逐条记录。 */
export function StatsDetail({
  filter,
  range,
  tracksById,
  version,
  canGoBack,
  onBack,
  onClose,
  onOpen,
  onPlay,
  onGoArtist,
  onGoAlbum,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const filterKey = JSON.stringify(filter);
  const [data, setData] = useState<{ key: string; stats: ListeningStats } | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<{ key: string; start: number } | null>(null);
  const [hideSkips, setHideSkips] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // 在详情里点进另一首歌（或返回）时回到顶部
  useEffect(() => {
    ref.current?.scrollTo?.({ top: 0 });
  }, [filterKey]);

  useEffect(() => {
    let alive = true;
    const key = `${range}|${filterKey}`;
    fetchStats(range, JSON.parse(filterKey) as StatsFilter)
      .then((stats) => {
        if (!alive) return;
        setData({ key, stats });
        setError(false);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [filterKey, range, version]);

  const stats = data?.stats ?? null;
  const fresh = data?.key === `${range}|${filterKey}`;
  const track = "trackId" in filter ? tracksById.get(filter.trackId) ?? null : null;
  const albumTracks = useMemo(() => {
    if (!("album" in filter)) return [];
    return [...tracksById.values()].filter((t) => t.album === filter.album && t.albumArtist === filter.albumArtist);
  }, [filter, tracksById]);
  const artistTrackCount = useMemo(() => {
    if (!("artist" in filter)) return 0;
    let n = 0;
    for (const t of tracksById.values()) if (t.artist === filter.artist) n += 1;
    return n;
  }, [filter, tracksById]);

  const selectedIndex =
    stats && selected?.key === filterKey ? stats.timeline.findIndex((b) => b.start === selected.start) : -1;
  const bucket = selectedIndex >= 0 && stats ? stats.timeline[selectedIndex] : null;

  let kicker: string;
  let title: string;
  let sub: string;
  let cover: React.ReactNode;
  if ("trackId" in filter) {
    kicker = "歌曲";
    title = track?.title ?? "已不在曲库中的歌";
    sub = track ? `${track.artist} · ${track.album}` : "";
    cover = track ? (
      <CoverArt seed={`${track.album}|${track.artist}`} label={track.album} size="md" src={track.hasCover ? coverUrl(track.id) : null} />
    ) : null;
  } else if ("artist" in filter) {
    kicker = "歌手";
    title = filter.artist;
    sub = `曲库里有 ${artistTrackCount} 首`;
    cover = <CoverArt seed={filter.artist} label={filter.artist} size="md" />;
  } else {
    const withCover = albumTracks.find((t) => t.hasCover);
    kicker = "专辑";
    title = filter.album;
    sub = `${filter.albumArtist} · 曲库里有 ${albumTracks.length} 首`;
    cover = (
      <CoverArt
        seed={`${filter.album}|${filter.albumArtist}`}
        label={filter.album}
        size="md"
        src={withCover ? coverUrl(withCover.id) : null}
      />
    );
  }

  return (
    <dialog
      ref={ref}
      className="stats-dialog"
      aria-labelledby="stats-detail-title"
      onClose={onClose}
      onClick={(e) => {
        // 点遮罩关闭（内容区铺满对话框，点到 dialog 本身说明点在外面）
        if (e.target === ref.current) ref.current.close();
      }}
    >
      <div className="stats-dialog-body">
        <div className="stats-dialog-top">
          {canGoBack ? (
            <button className="link-btn" type="button" onClick={onBack}>
              ‹ 返回
            </button>
          ) : (
            <span />
          )}
          <button className="icon-btn" type="button" aria-label="关闭" title="关闭  Esc" onClick={() => ref.current?.close()}>
            <IconClose size={16} />
          </button>
        </div>

        <header className="detail-head">
          {cover}
          <div className="detail-title">
            <p className="kicker">
              {kicker} · {rangeLabel(range)}
            </p>
            <h3 id="stats-detail-title">{title}</h3>
            {sub ? <p className="sub">{sub}</p> : null}
          </div>
        </header>

        <div className="page-play">
          {track ? (
            <>
              <button className="primary-btn" type="button" onClick={() => onPlay(track)}>
                <IconPlay size={14} />
                播放
              </button>
              <button className="ghost-btn" type="button" onClick={() => onGoArtist(track.artist)}>
                查看歌手
              </button>
              <button className="ghost-btn" type="button" onClick={() => onGoAlbum(track.album, track.albumArtist)}>
                查看专辑
              </button>
            </>
          ) : "artist" in filter ? (
            <button className="ghost-btn" type="button" onClick={() => onGoArtist(filter.artist)}>
              打开歌手页
            </button>
          ) : "album" in filter ? (
            <button className="ghost-btn" type="button" onClick={() => onGoAlbum(filter.album, filter.albumArtist)}>
              打开专辑页
            </button>
          ) : null}
        </div>

        {error && !stats ? <p className="history-empty">统计加载失败</p> : null}
        {!stats ? (
          error ? null : <p className="history-empty">正在统计…</p>
        ) : (
          <div className={`detail-content ${fresh ? "" : "is-refreshing"}`}>
            <div className="stat-tiles is-compact">
              <div className="stat-tile">
                <span>播放次数</span>
                <strong>
                  {compactNumber(stats.totals.plays)}
                  <small> · 跳过 {stats.totals.skips}</small>
                </strong>
              </div>
              <div className="stat-tile">
                <span>累计收听</span>
                <strong>{listenTime(stats.totals.seconds)}</strong>
              </div>
              <div className="stat-tile">
                <span>完播率</span>
                <strong>{stats.totals.listens ? percent(stats.totals.completionRate) : "—"}</strong>
              </div>
              <div className="stat-tile">
                <span>首次播放</span>
                <strong className="is-date">{stats.firstListen ? shortDate(stats.firstListen) : "—"}</strong>
              </div>
              <div className="stat-tile">
                <span>最近播放</span>
                <strong className="is-date">{stats.lastListen ? shortDate(stats.lastListen) : "—"}</strong>
              </div>
            </div>

            {stats.totals.listens > 0 ? (
              <ColumnChart
                columns={timelineColumns(stats)}
                ariaLabel={`${title}在${rangeLabel(range)}的播放次数`}
                height={90}
                selected={selectedIndex >= 0 ? selectedIndex : null}
                onSelect={(i) => setSelected(i == null ? null : { key: filterKey, start: stats.timeline[i].start })}
              />
            ) : null}

            {!("trackId" in filter) && stats.topTracks.length ? (
              <section className="detail-section">
                <h4>最常听的歌</h4>
                <ol className="rank-rows">
                  {stats.topTracks.slice(0, 10).map((row, i) => {
                    const t = tracksById.get(row.id);
                    if (!t) return null;
                    return (
                      <li key={row.id}>
                        <button className="rank-row" type="button" onClick={() => onOpen({ trackId: row.id })}>
                          <span className="rank-idx">{String(i + 1).padStart(2, "0")}</span>
                          <span className="rank-meta">
                            <b>{t.title}</b>
                            <small>
                              完播 {row.completed} · 跳过 {row.skips} · 最近 {shortDate(row.lastPlayed)}
                            </small>
                          </span>
                          <span className="rank-stat">
                            <b>{row.plays} 次</b>
                            <small>{listenTime(row.seconds)}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}

            <section className="detail-section">
              <div className="section-head">
                <h4>
                  听歌记录
                  {bucket ? <span className="chip">{bucketLabel(bucket.start, bucket.end, stats.unit)}</span> : null}
                </h4>
                <label className="check">
                  <input type="checkbox" checked={hideSkips} onChange={(e) => setHideSkips(e.target.checked)} />
                  隐藏跳过
                </label>
              </div>
              <ListenHistory
                tracksById={tracksById}
                from={bucket ? bucket.start : stats.from}
                to={bucket ? bucket.end : stats.to}
                filter={filter}
                hideSkips={hideSkips}
                version={version}
                compact={"trackId" in filter}
                pageSize={20}
                onOpenTrack={(t) => onOpen({ trackId: t.id })}
                onPlay={onPlay}
              />
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
