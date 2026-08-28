import { formatTime } from "../api";
import { CoverArt } from "./CoverArt";
import type { PlayMode, Track, UpcomingItem } from "../types";

const MODE_HINT: Record<PlayMode, string> = {
  "repeat-all": "按曲库顺序",
  "repeat-one": "切歌后按顺序",
  "repeat-artist": "同一歌手",
  shuffle: "随机队列",
  smart: "模型下一首",
};

type Props = {
  items: UpcomingItem[];
  mode: PlayMode;
  smartPreview: boolean;
  hasCurrent: boolean;
  onPlay: (track: Track) => void;
};

export function UpcomingPanel({ items, mode, smartPreview, hasCurrent, onPlay }: Props) {
  const hint = smartPreview || mode === "smart" ? "模型下一首" : MODE_HINT[mode];
  return (
    <aside className="upcoming" aria-label="即将播放">
      <div className="upcoming-head">
        <p className="kicker">Up Next</p>
        <h3>即将播放</h3>
        <p className="sub">{hint}</p>
      </div>

      {items.length === 0 ? (
        <p className="upcoming-empty">
          {hasCurrent ? "队列里没有更多歌曲" : "选一首歌开始播放后，这里会预告接下来几首"}
        </p>
      ) : (
        <ol className="upcoming-list">
          {items.map((item, i) => {
            const { track } = item;
            return (
              <li key={`${track.id}-${i}`}>
                <button className="upcoming-row" type="button" onClick={() => onPlay(track)}>
                  <span className="upcoming-idx">{String(i + 1).padStart(2, "0")}</span>
                  <CoverArt seed={`${track.album}|${track.artist}`} label={track.album} size="sm" />
                  <span className="upcoming-meta">
                    <b>{track.title}</b>
                    <small>{item.reason || `${track.artist} · ${track.album}`}</small>
                  </span>
                  <span className="upcoming-time">{formatTime(track.duration)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
