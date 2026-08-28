import { formatHiFi, formatTime } from "../api";
import { CoverArt } from "./CoverArt";
import { IconPlay } from "./Icons";
import type { Track } from "../types";

type Props = {
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  onPlay: (track: Track) => void;
};

export function TrackList({ tracks, currentId, playing, onPlay }: Props) {
  if (tracks.length === 0) {
    return <div className="empty">没有匹配的歌曲</div>;
  }

  return (
    <div className="track-table" role="table">
      <div className="track-head" role="row">
        <span className="col-idx">#</span>
        <span className="col-title">歌曲</span>
        <span className="col-album">专辑</span>
        <span className="col-hifi">规格</span>
        <span className="col-time">时长</span>
      </div>
      {tracks.map((track, i) => {
        const active = track.id === currentId;
        return (
          <button
            key={track.id}
            className={`track-row ${active ? "is-active" : ""}`}
            onDoubleClick={() => onPlay(track)}
            onClick={() => onPlay(track)}
            type="button"
            role="row"
          >
            <span className="col-idx">
              {active && playing ? <span className="eq-mini" /> : i + 1}
            </span>
            <span className="col-title">
              <CoverArt seed={`${track.album}|${track.artist}`} label={track.album} size="sm" />
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
      })}
    </div>
  );
}
