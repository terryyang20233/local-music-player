import { memo } from "react";
import { coverUrl, formatHiFi, formatTime } from "../api";
import { CoverArt } from "./CoverArt";
import { IconPlay } from "./Icons";
import type { Track } from "../types";

type Props = {
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  onPlay: (track: Track) => void;
  onMenu: (e: React.MouseEvent, track: Track) => void;
};

type RowProps = {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: (track: Track) => void;
  onMenu: (e: React.MouseEvent, track: Track) => void;
};

/** 单行单独 memo：切歌时只有新旧两行重渲染。 */
const TrackRow = memo(function TrackRow({ track, index, active, playing, onPlay, onMenu }: RowProps) {
  return (
    <button
      className={`track-row ${active ? "is-active" : ""}`}
      onClick={() => onPlay(track)}
      onContextMenu={(e) => onMenu(e, track)}
      type="button"
      aria-current={active ? "true" : undefined}
    >
      <span className="col-idx">
        {active && playing ? <span className="eq-mini" /> : index + 1}
      </span>
      <span className="col-title">
        <CoverArt
          seed={`${track.album}|${track.artist}`}
          label={track.album}
          size="sm"
          src={track.hasCover ? coverUrl(track.id) : null}
        />
        <span className="title-stack">
          <b>{track.title}</b>
          <small>{track.artist}</small>
        </span>
        {active ? (
          <span className="now-badge">
            <IconPlay size={10} />
            正在播放
          </span>
        ) : null}
      </span>
      <span className="col-album">{track.album}</span>
      <span className="col-hifi">{formatHiFi(track) || "—"}</span>
      <span className="col-time">{formatTime(track.duration)}</span>
    </button>
  );
});

export const TrackList = memo(function TrackList({ tracks, currentId, playing, onPlay, onMenu }: Props) {
  if (tracks.length === 0) {
    return <div className="empty">没有匹配的歌曲</div>;
  }

  return (
    <div className="track-table">
      <div className="track-head" aria-hidden>
        <span className="col-idx">#</span>
        <span className="col-title">歌曲</span>
        <span className="col-album">专辑</span>
        <span className="col-hifi">规格</span>
        <span className="col-time">时长</span>
      </div>
      {tracks.map((track, i) => {
        const active = track.id === currentId;
        return (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            active={active}
            playing={active && playing}
            onPlay={onPlay}
            onMenu={onMenu}
          />
        );
      })}
    </div>
  );
});
