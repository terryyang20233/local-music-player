export type PlayMode = "repeat-one" | "repeat-artist" | "shuffle" | "repeat-all" | "smart";

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  filename: string;
  ext: string;
  size: number;
  mtime: number;
};

export type LibraryResponse = {
  musicDir: string;
  tracks: Track[];
};

export type ViewFilter =
  | { kind: "all" }
  | { kind: "artist"; artist: string }
  | { kind: "album"; album: string; artist: string }
  | { kind: "recommend" };

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
};
