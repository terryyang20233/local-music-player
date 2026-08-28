import { formatTime } from "../api";
import { CoverArt } from "./CoverArt";
import {
  IconArtistLoop,
  IconBack,
  IconFwd,
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
  IconVolume,
} from "./Icons";
import type { PlayMode, Track } from "../types";
import { useRef } from "react";

type Props = {
  current: Track | null;
  playing: boolean;
  currentTime: number;
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
  levels: number[];
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (t: number) => void;
  onSeekBy: (d: number) => void;
  liked?: boolean;
  onToggleLike?: () => void;
};

const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: "repeat-all", label: "全部循环", hint: "播完整张曲库后从头再来" },
  { id: "repeat-one", label: "单曲循环", hint: "只循环当前这一首" },
  { id: "repeat-artist", label: "歌手循环", hint: "只播放当前歌手的作品" },
  { id: "shuffle", label: "随机播放", hint: "打乱顺序播放" },
  { id: "smart", label: "智能推荐", hint: "下一首由本地机器学习模型挑选" },
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
  currentTime,
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
  levels,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onSeekBy,
  liked = false,
  onToggleLike,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

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
          />
        ) : (
          <div className="cover cover-md cover-empty" />
        )}
        <div className="now-text">
          <strong>{current?.title || "尚未播放"}</strong>
          <span>{current ? `${current.artist} · ${current.album}` : "从曲库里选一首开始"}</span>
        </div>
        <div className="viz" aria-hidden>
          {levels.map((n, i) => (
            <span key={i} style={{ height: `${Math.max(8, n * 100)}%` }} />
          ))}
        </div>
      </div>

      <div className="player-main">
        <div className="transport">
          <button className="icon-btn" title="快退 10 秒  ←" onClick={() => onSeekBy(-10)} type="button">
            <IconBack size={18} />
            <em>10</em>
          </button>
          <button className="icon-btn" title="上一首  P" onClick={onPrev} type="button">
            <IconPrev size={18} />
          </button>
          <button className="play-btn" title={playing ? "暂停  Space" : "播放  Space"} onClick={onToggle} type="button">
            {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
          </button>
          <button className="icon-btn" title="下一首  N" onClick={onNext} type="button">
            <IconNext size={18} />
          </button>
          <button className="icon-btn" title="快进 10 秒  →" onClick={() => onSeekBy(10)} type="button">
            <IconFwd size={18} />
            <em>10</em>
          </button>
        </div>

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
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            tabIndex={0}
          >
            <div className="seek-fill" style={{ width: `${pct}%` }} />
          </div>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-extra">
        <button
          className={`icon-btn like-btn ${liked ? "is-liked" : ""}`}
          title={liked ? "取消喜欢" : "喜欢，作为正样本"}
          onClick={onToggleLike}
          type="button"
          disabled={!current}
        >
          {liked ? <IconHeartFill size={18} /> : <IconHeart size={18} />}
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
          <button className="rate-btn" title="切换倍速" onClick={cycleRate} type="button">
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
            onClick={() => setMuted((m) => !m)}
            type="button"
          >
            {muted || volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
          </button>
          <input
            className="vol"
            type="range"
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
