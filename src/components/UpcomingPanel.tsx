import { memo, useState } from "react";
import { coverUrl, formatTime } from "../api";
import { CoverArt } from "./CoverArt";
import { LyricsPanel } from "./LyricsPanel";
import type { PlayMode, Track, UpcomingItem } from "../types";

const MODE_HINT: Record<PlayMode, string> = {
  "repeat-all": "按列表顺序",
  "repeat-one": "切歌后按顺序",
  "repeat-artist": "同一歌手",
  shuffle: "随机队列",
  smart: "按你的口味挑选",
};

type Props = {
  items: UpcomingItem[];
  mode: PlayMode;
  current: Track | null;
  onPlay: (track: Track) => void;
  onMenu: (e: React.MouseEvent, track: Track, queued: boolean) => void;
  subscribeTime: (listener: () => void) => () => void;
  getTime: () => number;
  onSeek: (t: number) => void;
};

export const UpcomingPanel = memo(function UpcomingPanel({
  items,
  mode,
  current,
  onPlay,
  onMenu,
  subscribeTime,
  getTime,
  onSeek,
}: Props) {
  const [tab, setTab] = useState<"next" | "lyrics">("next");
  const hint = MODE_HINT[mode];

  return (
    <aside className="upcoming" aria-label="即将播放与歌词">
      <div className="upcoming-head">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "next"}
            className={tab === "next" ? "is-active" : ""}
            onClick={() => setTab("next")}
          >
            即将播放
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "lyrics"}
            className={tab === "lyrics" ? "is-active" : ""}
            onClick={() => setTab("lyrics")}
          >
            歌词
          </button>
        </div>
        <p className="sub">{tab === "next" ? hint : current ? `${current.title} · ${current.artist}` : "　"}</p>
      </div>

      {tab === "lyrics" ? (
        <LyricsPanel track={current} subscribeTime={subscribeTime} getTime={getTime} onSeek={onSeek} />
      ) : items.length === 0 ? (
        <p className="upcoming-empty">
          {current ? "队列里没有更多歌曲" : "选一首歌开始播放后，这里会预告接下来几首"}
        </p>
      ) : (
        <ol className="upcoming-list">
          {items.map((item, i) => {
            const { track } = item;
            return (
              <li key={`${track.id}-${i}`}>
                <button
                  className={`upcoming-row ${item.queued ? "is-queued" : ""}`}
                  type="button"
                  onClick={() => onPlay(track)}
                  onContextMenu={(e) => onMenu(e, track, Boolean(item.queued))}
                >
                  <span className="upcoming-idx">{String(i + 1).padStart(2, "0")}</span>
                  <CoverArt
                    seed={`${track.album}|${track.artist}`}
                    label={track.album}
                    size="sm"
                    src={track.hasCover ? coverUrl(track.id) : null}
                  />
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
});
