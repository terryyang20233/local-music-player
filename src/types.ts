export type PlayMode = "repeat-one" | "repeat-artist" | "shuffle" | "repeat-all" | "smart";

export type Track = {
  id: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  trackNo: number;
  discNo: number;
  genre: string | null;
  year: number;
  duration: number;
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  replayGain: ReplayGain;
  hasCover: boolean;
  hasLyrics: boolean;
  /** 标题 / 歌手 / 专辑及其拼音，小写，用于搜索。 */
  search: string;
  filename: string;
  ext: string;
  size: number;
  mtime: number;
};

export type LibraryResponse = {
  musicDir: string;
  version: number;
  tracks: Track[];
};

export type ReplayGain = {
  trackGain: number | null;
  trackPeak: number | null;
  albumGain: number | null;
  albumPeak: number | null;
};

export type ViewFilter =
  | { kind: "all" }
  | { kind: "artist"; artist: string }
  | { kind: "album"; album: string; artist: string }
  | { kind: "recommend" }
  | { kind: "liked" }
  | { kind: "playlist"; id: string }
  | { kind: "stats" };

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type LyricLine = { time: number | null; text: string };

/** 歌词查找结果。source：同名 .lrc 文件 / 音频内嵌标签 / LRCLIB 在线歌词库。 */
export type LyricsResult =
  | { status: "found"; source: "file" | "embedded" | "lrclib"; synced: boolean; lines: LyricLine[] }
  | { status: "instrumental" | "missing" | "error"; source?: string; online?: boolean };

export type StatsRange = "7d" | "30d" | "90d" | "year" | "all";

/** 统计范围：某首歌、某位歌手或某张专辑。 */
export type StatsFilter = { trackId: string } | { artist: string } | { album: string; albumArtist: string };

/** 一次收听的结果：完播 / 听了大半 / 听了一部分 / 跳过。 */
export type ListenOutcome = "completed" | "most" | "partial" | "skipped";

export type StatsCount = { plays: number; seconds: number };

export type TrackStatRow = {
  id: string;
  plays: number;
  skips: number;
  completed: number;
  seconds: number;
  lastPlayed: number;
};

export type ListeningStats = {
  range: StatsRange;
  from: number;
  to: number;
  unit: "day" | "week" | "month";
  totals: {
    listens: number;
    plays: number;
    skips: number;
    completed: number;
    seconds: number;
    completionRate: number;
    skipRate: number;
    distinctTracks: number;
    distinctArtists: number;
    activeDays: number;
  };
  firstListen: number | null;
  lastListen: number | null;
  timeline: { start: number; end: number; plays: number; skips: number; seconds: number }[];
  hours: StatsCount[];
  weekdays: StatsCount[];
  topTracks: TrackStatRow[];
  topArtists: { artist: string; plays: number; seconds: number; tracks: number }[];
  topAlbums: { album: string; artist: string; plays: number; seconds: number; coverId: string | null }[];
  mostSkipped: TrackStatRow[];
};

export type HistoryItem = {
  ts: number;
  trackId: string;
  seconds: number;
  duration: number;
  progress: number;
  outcome: ListenOutcome;
};

export type HistoryPage = { items: HistoryItem[]; total: number; next: number | null };

export type ListenReport = {
  trackId: string;
  progress: number;
  seconds: number;
  duration: number;
  reason: string;
};

export type RecommendItem = {
  id: string;
  score: number;
  pLike: number;
  reason: string;
  track: Track;
};

export type UpcomingItem = {
  track: Track;
  reason?: string;
  /** 来自手动队列（"下一首播放 / 加入队列"）。 */
  queued?: boolean;
};

export type RecommendResponse = {
  metrics: {
    trained: boolean;
    positives: number;
    negatives: number;
    loss: number;
    events: number;
    likes: number;
  };
  items: RecommendItem[];
  likes: string[];
  dislikes: string[];
};
