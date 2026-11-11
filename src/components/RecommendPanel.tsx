import { memo } from "react";
import { coverUrl } from "../api";
import { CoverArt } from "./CoverArt";
import { IconPlay, IconSpark } from "./Icons";
import type { RecommendItem, RecommendResponse, Track } from "../types";

type Props = {
  items: RecommendItem[];
  metrics: RecommendResponse["metrics"] | null;
  currentId: string | null;
  playing: boolean;
  onPlay: (track: Track) => void;
  onPlaySmart: () => void;
  onMenu: (e: React.MouseEvent, track: Track) => void;
};

export const RecommendPanel = memo(function RecommendPanel({ items, metrics, currentId, playing, onPlay, onPlaySmart, onMenu }: Props) {
  const trained = Boolean(metrics?.trained);
  return (
    <div className="rec-wrap">
      <div className="rec-status">
        <IconSpark size={16} />
        <div className="rec-text">
          <p>
            {trained
              ? "根据你听完、跳过和常连着听的歌挑选，听得越多越准。不想再听到的歌，可以右键选「不喜欢」。"
              : "先随便听几首，听完或跳过都算。之后这里会按你的口味推荐。"}
          </p>
          <details className="rec-how">
            <summary>推荐原理</summary>
            <p>
              {trained && metrics
                ? `本地逻辑回归模型，已用 ${metrics.positives} 次完播 / ${metrics.negatives} 次跳过训练，再叠加听歌序列（Item2Vec + 连听关系）和多样性重排。`
                : "听歌记录还不够训练模型，暂时按歌曲内容（歌手、专辑、风格）的相似度推荐。"}
              全部在本机计算，听歌记录不会上传。
            </p>
          </details>
        </div>
        {items.length > 0 ? (
          <button className="primary-btn" type="button" onClick={onPlaySmart}>
            <IconPlay size={14} />
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
              onContextMenu={(e) => onMenu(e, track)}
            >
              <span className="rec-rank">{String(i + 1).padStart(2, "0")}</span>
              <CoverArt
                seed={`${track.album}|${track.artist}`}
                label={track.album}
                size="md"
                spinning={active && playing}
                src={track.hasCover ? coverUrl(track.id) : null}
              />
              <span className="rec-meta">
                <b>{track.title}</b>
                <small>{track.artist}</small>
                <em>{item.reason}</em>
              </span>
              {trained ? (
                <span className="rec-score" title="估计你会喜欢这首歌的程度">
                  <small>匹配</small>
                  {Math.round(item.pLike * 100)}%
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});
