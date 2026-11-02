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

export type Lyrics = { synced: boolean; lines: LyricLine[] };

export type ListeningStats = {
  totalPlays: number;
  totalSeconds: number;
  completionRate: number;
  skipRate: number;
  distinctTracks: number;
  firstListen: number | null;
  daily: { day: string; plays: number }[];
  topTracks: { id: string; plays: number }[];
  topArtists: { artist: string; plays: number }[];
};

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
