import { coverUrl, formatTime } from "../api";
import { CoverArt } from "./CoverArt";
import { Visualizer } from "./Visualizer";
import {
  IconArtistLoop,
  IconBack,
  IconFwd,
  IconGain,
  IconHeart,
  IconHeartFill,
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeatAll,
  IconRepeatOne,
  IconShuffle,
  IconSpark,
  IconThumbDown,
  IconVolume,
} from "./Icons";
import { usePlaybackTime } from "../hooks/usePlayer";
import type { PlayMode, Track } from "../types";
import { useRef } from "react";

type Props = {
  current: Track | null;
  playing: boolean;
  subscribeTime: (listener: () => void) => () => void;
  getTime: () => number;
  duration: number;
  mode: PlayMode;
  setMode: (mode: PlayMode) => void;
  rate: number;
  rates: number[];
  setRate: (rate: number) => void;
  cycleRate: () => void;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (v: boolean | ((m: boolean) => boolean)) => void;
  getAnalyser: () => AnalyserNode | null;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (t: number) => void;
  onSeekBy: (d: number) => void;
  liked?: boolean;
  onToggleLike?: () => void;
  onDislike?: () => void;
  replayGain: boolean;
  onToggleReplayGain: () => void;
  onSelectArtist: (artist: string) => void;
  onSelectAlbum: (track: Track) => void;
};

const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: "repeat-all", label: "全部循环", hint: "播完整张曲库后从头再来" },
  { id: "repeat-one", label: "单曲循环", hint: "只循环当前这一首" },
  { id: "repeat-artist", label: "歌手循环", hint: "只播放当前歌手的作品" },
  { id: "shuffle", label: "随机播放", hint: "打乱顺序播放" },
  { id: "smart", label: "智能推荐", hint: "根据你的听歌习惯挑下一首" },
];

function ModeIcon({ mode }: { mode: PlayMode }) {
  if (mode === "repeat-one") return <IconRepeatOne size={18} />;
  if (mode === "repeat-artist") return <IconArtistLoop size={18} />;
  if (mode === "shuffle") return <IconShuffle size={18} />;
  if (mode === "smart") return <IconSpark size={18} />;
  return <IconRepeatAll size={18} />;
}

export function PlayerBar({
  current,
  playing,
  subscribeTime,
  getTime,
  duration,
  mode,
  setMode,
  rate,
  rates,
  setRate,
  cycleRate,
  volume,
  setVolume,
  muted,
  setMuted,
  getAnalyser,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onSeekBy,
  liked = false,
  onToggleLike,
  onDislike,
  replayGain,
  onToggleReplayGain,
  onSelectArtist,
  onSelectAlbum,
}: Props) {
  const cycleMode = () => {
    const i = MODES.findIndex((m) => m.id === mode);
    setMode(MODES[(i + 1) % MODES.length].id);
  };

  const modeMeta = MODES.find((m) => m.id === mode)!;

  return (
    <footer className="player">
      <div className="player-now">
        {current ? (
          <CoverArt
            seed={`${current.album}|${current.artist}`}
            label={current.album}
            spinning={playing}
            size="md"
            src={current.hasCover ? coverUrl(current.id) : null}
          />
        ) : (
          <div className="cover cover-md cover-empty" />
        )}
        <div className="now-text">
          <strong>{current?.title || "尚未播放"}</strong>
          {current ? (
            <span>
              <button className="row-link" type="button" onClick={() => onSelectArtist(current.artist)} title={`查看歌手 ${current.artist}`}>
                {current.artist}
              </button>
              {" · "}
              <button className="row-link" type="button" onClick={() => onSelectAlbum(current)} title={`查看专辑 ${current.album}`}>
                {current.album}
              </button>
            </span>
          ) : (
            <span>从曲库里选一首开始</span>
          )}
        </div>
        <Visualizer getAnalyser={getAnalyser} playing={playing} />
      </div>

      <div className="player-main">
        <div className="transport">
          <button className="icon-btn" title="快退 10 秒  ←" aria-label="快退 10 秒" onClick={() => onSeekBy(-10)} type="button">
            <IconBack size={18} />
            <em>10</em>
          </button>
          <button className="icon-btn" title="上一首  P" aria-label="上一首" onClick={onPrev} type="button">
            <IconPrev size={18} />
          </button>
          <button className="play-btn" title={playing ? "暂停  Space" : "播放  Space"} aria-label={playing ? "暂停" : "播放"} onClick={onToggle} type="button">
            {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
          </button>
          <button className="icon-btn" title="下一首  N" aria-label="下一首" onClick={onNext} type="button">
            <IconNext size={18} />
          </button>
          <button className="icon-btn" title="快进 10 秒  →" aria-label="快进 10 秒" onClick={() => onSeekBy(10)} type="button">
            <IconFwd size={18} />
            <em>10</em>
          </button>
        </div>

        <SeekRow subscribeTime={subscribeTime} getTime={getTime} duration={duration} onSeek={onSeek} />
      </div>

      <div className="player-extra">
        <button
          className={`icon-btn like-btn ${liked ? "is-liked" : ""}`}
          title={liked ? "取消喜欢" : "喜欢：之后多推荐类似的歌"}
          aria-label={liked ? "取消喜欢" : "喜欢"}
          aria-pressed={liked}
          onClick={onToggleLike}
          type="button"
          disabled={!current}
        >
          {liked ? <IconHeartFill size={18} /> : <IconHeart size={18} />}
        </button>
        <button
          className="icon-btn"
          title="不喜欢：跳过，之后少推荐类似的歌"
          aria-label="不喜欢"
          onClick={onDislike}
          type="button"
          disabled={!current}
        >
          <IconThumbDown size={18} />
        </button>
        <button
          className={`icon-btn ${replayGain ? "is-on" : ""}`}
          title={replayGain ? "音量均衡已开启（ReplayGain）" : "音量均衡已关闭（ReplayGain）"}
          aria-label="音量均衡"
          aria-pressed={replayGain}
          onClick={onToggleReplayGain}
          type="button"
        >
          <IconGain size={18} />
        </button>
        <button
          className={`mode-btn is-on`}
          title={`${modeMeta.label}：${modeMeta.hint}`}
          onClick={cycleMode}
          type="button"
        >
          <ModeIcon mode={mode} />
          <span>{modeMeta.label}</span>
        </button>

        <div className="rate-wrap">
          <button className="rate-btn" title="切换倍速" aria-label={`倍速 ${rate}x`} onClick={cycleRate} type="button">
            {rate.toFixed(2).replace(/\.00$/, ".0")}x
          </button>
          <div className="rate-menu">
            {rates.map((r) => (
              <button
                key={r}
                className={r === rate ? "is-active" : ""}
                onClick={() => setRate(r)}
                type="button"
              >
                {r}x
              </button>
            ))}
          </div>
        </div>

        <div className="vol-wrap">
          <button
            className="icon-btn"
            title={muted ? "取消静音  M" : "静音  M"}
            aria-label={muted ? "取消静音" : "静音"}
            onClick={() => setMuted((m) => !m)}
            type="button"
          >
            {muted || volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
          </button>
          <input
            className="vol"
            type="range"
            aria-label="音量"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </div>
      </div>
    </footer>
  );
}

type SeekRowProps = {
  subscribeTime: (listener: () => void) => () => void;
  getTime: () => number;
  duration: number;
  onSeek: (t: number) => void;
};

/** 进度条单独订阅播放进度，其他部分不会因为时间走动而重渲染。 */
function SeekRow({ subscribeTime, getTime, duration, onSeek }: SeekRowProps) {
  const currentTime = usePlaybackTime(subscribeTime, getTime);
  const barRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div className="seek-row">
      <span>{formatTime(currentTime)}</span>
      <div
        className="seek"
        ref={barRef}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return;
          seekFromEvent(e.clientX);
        }}
        onKeyDown={(e) => {
          // 方向键 ±5 秒，PageUp / PageDown ±30 秒，Home / End 跳到开头结尾
          const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key];
          if (step != null) onSeek(Math.min(duration, Math.max(0, currentTime + step)));
          else if (e.key === "Home") onSeek(0);
          else if (e.key === "End") onSeek(Math.max(0, duration - 1));
          else return;
          e.preventDefault();
        }}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
        tabIndex={0}
      >
        <div className="seek-fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{formatTime(duration)}</span>
    </div>
  );
}
