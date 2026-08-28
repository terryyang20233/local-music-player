import { CoverArt } from "./CoverArt";
import { IconSpark } from "./Icons";
import type { RecommendItem, RecommendResponse, Track } from "../types";

type Props = {
  items: RecommendItem[];
  metrics: RecommendResponse["metrics"] | null;
  currentId: string | null;
  playing: boolean;
  onPlay: (track: Track) => void;
  onPlaySmart: () => void;
};

export function RecommendPanel({ items, metrics, currentId, playing, onPlay, onPlaySmart }: Props) {
  return (
    <div className="rec-wrap">
      <div className="rec-status">
        <IconSpark size={16} />
        <p>
          {metrics?.trained
            ? `逻辑回归已用 ${metrics.positives} 次完播 / ${metrics.negatives} 次跳过训练，并叠加 Item2Vec 听歌序列。`
            : "先听几首（完播或跳过都行）。本地模型会用这些隐式反馈学习你的口味。"}
        </p>
        {items.length > 0 ? (
          <button className="ghost-btn" type="button" onClick={onPlaySmart}>
            按推荐播放
          </button>
        ) : null}
      </div>

      <div className="rec-grid">
        {items.map((item, i) => {
          const track = item.track;
          if (!track) return null;
          const active = track.id === currentId;
          return (
            <button
              key={track.id}
              className={`rec-card ${active ? "is-active" : ""}`}
              type="button"
              onClick={() => onPlay(track)}
            >
              <span className="rec-rank">{String(i + 1).padStart(2, "0")}</span>
              <CoverArt seed={`${track.album}|${track.artist}`} label={track.album} size="md" spinning={active && playing} />
              <span className="rec-meta">
                <b>{track.title}</b>
                <small>{track.artist}</small>
                <em>{item.reason}</em>
              </span>
              <span className="rec-score">{Math.round(item.pLike * 100)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
