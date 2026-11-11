import type { Column } from "./components/ColumnChart";
import type { ListeningStats, ListenOutcome, StatsRange } from "./types";

export const RANGE_OPTIONS: { id: StatsRange; label: string; long: string }[] = [
  { id: "7d", label: "7 天", long: "近 7 天" },
  { id: "30d", label: "30 天", long: "近 30 天" },
  { id: "90d", label: "90 天", long: "近 90 天" },
  { id: "year", label: "今年", long: "今年" },
  { id: "all", label: "全部", long: "全部记录" },
];

export const rangeLabel = (range: StatsRange) => RANGE_OPTIONS.find((r) => r.id === range)?.long ?? "";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** 1,234 / 1.2 万 */
export function compactNumber(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString("zh-CN");
}

/** 收听时长：45 秒 / 12 分钟 / 3 小时 5 分 / 12.5 小时 */
export function listenTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} 秒`;
  const hours = totalSeconds / 3600;
  if (hours >= 10) return `${hours.toFixed(1)} 小时`;
  const h = Math.floor(hours);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h === 0 ? `${m} 分钟` : `${h} 小时 ${m} 分`;
}

export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function sameYear(ts: number) {
  return new Date(ts).getFullYear() === new Date().getFullYear();
}

/** 11月3日；不是今年时带年份。 */
export function shortDate(ts: number): string {
  const d = new Date(ts);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return sameYear(ts) ? md : `${d.getFullYear()}年${md}`;
}

/** 21:05 */
export function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 记录分组的标题：今天 · 11月10日 周二 */
export function dayHeading(ts: number): string {
  const d = new Date(ts);
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
  const prefix = diff === 0 ? "今天 · " : diff === 1 ? "昨天 · " : "";
  return `${prefix}${shortDate(ts)} 周${WEEKDAYS[d.getDay()]}`;
}

/** 时间轴上一根柱子代表的时间段。 */
export function bucketLabel(start: number, end: number, unit: "day" | "week" | "month"): string {
  if (unit === "day") return shortDate(start);
  if (unit === "month") {
    const d = new Date(start);
    return sameYear(start) ? `${d.getMonth() + 1}月` : `${d.getFullYear()}年${d.getMonth() + 1}月`;
  }
  const last = new Date(end - 1);
  const first = new Date(start);
  const tail = first.getMonth() === last.getMonth() ? `${last.getDate()}日` : `${last.getMonth() + 1}月${last.getDate()}日`;
  return `${shortDate(start)}–${tail}`;
}

/** 坐标轴上的简短刻度：11/3、11月、2025年 */
export function bucketTick(start: number, unit: "day" | "week" | "month"): string {
  const d = new Date(start);
  if (unit === "month") return d.getMonth() === 0 ? `${d.getFullYear()}年` : `${d.getMonth() + 1}月`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function outcomeLabel(outcome: ListenOutcome, progress: number): string {
  if (outcome === "completed") return "完播";
  if (outcome === "skipped") return "跳过";
  if (outcome === "most") return "听了大半";
  return `听了 ${Math.max(1, Math.round(progress * 100))}%`;
}

/** 一个比 max 大的整齐刻度：7 → 8，23 → 25，143 → 150。 */
export function niceMax(max: number): number {
  if (max <= 5) return Math.max(1, max);
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

/** 时间轴的柱子：值是播放次数，提示里带上跳过和时长；刻度从最右（最新）往左每隔几根标一个。 */
export function timelineColumns(stats: ListeningStats): Column[] {
  const n = stats.timeline.length;
  const every = Math.max(1, Math.ceil(n / 6));
  return stats.timeline.map((b, i) => ({
    key: String(b.start),
    label: bucketLabel(b.start, b.end, stats.unit),
    value: b.plays,
    detail: `跳过 ${b.skips} · ${listenTime(b.seconds)}`,
    tick: (n - 1 - i) % every === 0 ? bucketTick(b.start, stats.unit) : undefined,
  }));
}
