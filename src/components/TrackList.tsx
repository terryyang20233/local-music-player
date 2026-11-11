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
  onSelectArtist: (artist: string) => void;
  onSelectAlbum: (track: Track) => void;
};

type RowProps = {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: (track: Track) => void;
  onMenu: (e: React.MouseEvent, track: Track) => void;
  onSelectArtist: (artist: string) => void;
  onSelectAlbum: (track: Track) => void;
};

/**
 * 单行单独 memo：切歌时只有新旧两行重渲染。
 * 标题按钮的 ::after 铺满整行，点行内任意空白处都是播放；歌手、专辑叠在上面，点了跳转。
 * 歌手 / 专辑链接不进 Tab 顺序（每行只占一个 Tab 位），键盘用户可以在右键菜单里"查看歌手 / 专辑"。
 */
const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  playing,
  onPlay,
  onMenu,
  onSelectArtist,
  onSelectAlbum,
}: RowProps) {
  return (
    <div
      className={`track-row ${active ? "is-active" : ""}`}
      onContextMenu={(e) => onMenu(e, track)}
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
          <button className="row-play" type="button" onClick={() => onPlay(track)}>
            {track.title}
          </button>
          <small>
            <button className="row-link" type="button" tabIndex={-1} onClick={() => onSelectArtist(track.artist)}>
              {track.artist}
            </button>
          </small>
        </span>
        {active ? (
          <span className="now-badge">
            <IconPlay size={10} />
            正在播放
          </span>
        ) : null}
      </span>
      <span className="col-album">
        <button className="row-link" type="button" tabIndex={-1} onClick={() => onSelectAlbum(track)}>
          {track.album}
        </button>
      </span>
      <span className="col-hifi">{formatHiFi(track) || "—"}</span>
      <span className="col-time">{formatTime(track.duration)}</span>
    </div>
  );
});

export const TrackList = memo(function TrackList({
  tracks,
  currentId,
  playing,
  onPlay,
  onMenu,
  onSelectArtist,
  onSelectAlbum,
}: Props) {
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
            onSelectArtist={onSelectArtist}
            onSelectAlbum={onSelectAlbum}
          />
        );
      })}
    </div>
  );
});
