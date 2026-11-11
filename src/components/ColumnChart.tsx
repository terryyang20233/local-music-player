import { useState } from "react";
import { niceMax } from "../statsFormat";

export type Column = {
  key: string;
  /** 提示框和读屏用的完整名称，如"11月3日"。 */
  label: string;
  value: number;
  /** 提示框第二行的补充，如"跳过 3 · 48 分钟"。 */
  detail?: string;
  /** 横轴刻度，只给部分柱子设置，免得挤在一起。 */
  tick?: string;
};

type Props = {
  columns: Column[];
  ariaLabel: string;
  unit?: string;
  height?: number;
  /** 传了 onSelect 柱子就可以点：再点一次取消选择。 */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
};

/** 单系列柱状图：一条基线、顶部 4px 圆角、柱间 2px 间隔，悬停或聚焦时显示数值。 */
export function ColumnChart({ columns, ariaLabel, unit = "次", height = 140, selected = null, onSelect }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const tip = hover != null ? columns[hover] : null;
  const tipPct = hover != null ? ((hover + 0.5) / columns.length) * 100 : 0;
  // 靠近两端时提示框往里对齐，不超出卡片
  const tipShift = tipPct < 15 ? "0%" : tipPct > 85 ? "-100%" : "-50%";
  const grid = { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` };

  return (
    <div className={`col-chart ${selected != null ? "has-selection" : ""}`}>
      <div className="col-axis" style={{ height }} aria-hidden>
        <span>{max.toLocaleString("zh-CN")}</span>
        <span>0</span>
      </div>
      <div
        className="col-plot"
        style={{ ...grid, height }}
        role={onSelect ? "group" : "img"}
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {columns.map((c, i) => {
          const className = `col ${hover === i ? "is-hover" : ""} ${selected === i ? "is-selected" : ""}`;
          const bar = (
            <span
              className={`col-bar ${c.value > 0 ? "" : "is-zero"}`}
              style={{ height: `${max ? (c.value / max) * 100 : 0}%` }}
            />
          );
          return onSelect ? (
            <button
              key={c.key}
              className={className}
              type="button"
              aria-pressed={selected === i}
              aria-label={`${c.label}，${c.value} ${unit}${c.detail ? `，${c.detail}` : ""}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(selected === i ? null : i)}
            >
              {bar}
            </button>
          ) : (
            <span key={c.key} className={className} onMouseEnter={() => setHover(i)}>
              {bar}
            </span>
          );
        })}
        {tip ? (
          <div className="chart-tip" style={{ left: `${tipPct}%`, transform: `translate(${tipShift}, -100%)` }}>
            <b>
              {tip.value.toLocaleString("zh-CN")} {unit}
            </b>
            <span>
              {tip.label}
              {tip.detail ? ` · ${tip.detail}` : ""}
            </span>
          </div>
        ) : null}
      </div>
      <span />
      <div className="col-ticks" style={grid} aria-hidden>
        {columns.map((c) => (
          <span key={c.key}>{c.tick ?? ""}</span>
        ))}
      </div>
    </div>
  );
}
