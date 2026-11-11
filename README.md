# 唱机 — Local Music Player

[中文](README.zh.md)

A local FLAC player with on-device recommendations. It scans a folder on your machine, plays audio in the browser, and learns what you finish or skip — without uploading listening history.

The UI is in Chinese. Audio files and play history are **not** in this repo.

## Features

- FLAC from a local folder, read with a built-in parser (Vorbis tags, track/disc numbers, ReplayGain, embedded cover); MP3 / M4A / OGG / Opus through `music-metadata`
- Album art from the embedded picture or a `cover.jpg` / `folder.jpg` next to the files
- Synced lyrics from a `.lrc` with the same name or the file's own lyrics tag; otherwise downloaded from [LRCLIB](https://lrclib.net) (open, no account) when a track starts, cached on disk and converted to simplified Chinese
- Repeat one, repeat artist, shuffle, repeat all, plus a **smart** mode that picks the next track
- Playing from an artist, album, playlist or search plays *that list*; right-click any track for **play next**, **add to queue**, playlists, like / dislike
- Playlists, a **Liked** view and a **Listening stats** page: 7 / 30 / 90 days, this year or everything; plays per day, hour and weekday; top songs, artists, albums and most-skipped; every listen with time and how much was heard; click any song, artist or album for its own stats
- Search by title, artist, album — or by pinyin (`zjl`, `zhoujielun`)
- Media keys, headset buttons and macOS Now Playing (Media Session API)
- Picks up where you left off (track, position, queue) after a reload
- Optional ReplayGain volume levelling
- The library folder is watched; added, moved or retagged files show up without a manual rescan
- **For you**: logistic regression + Item2Vec + listening transitions, trained on this device
- Optional macOS app wrapper so you can launch from the Dock

## Requirements

- Node.js 20.19+
- A folder of audio files (default `~/Desktop/music-resources`)
- macOS only if you want the Dock app (`npm run install-app`); Linux/Windows can use `npm run dev` / `npm start`

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Production (built UI + API) is [http://localhost:8787](http://localhost:8787):

```bash
npm run preview
```

Set the library path in `config.json` (`musicDir`) or with an env var:

```bash
MUSIC_DIR="/path/to/music" npm run dev
```

On macOS, generate a local **唱机.app** (Desktop + `~/Applications`) with:

```bash
npm run install-app
```

The first launch builds the UI and opens a browser. Quitting from the Dock stops the background server. Do not commit `唱机.app`; it is machine-specific (it stores your clone path). The launcher only builds the UI when `dist/` is missing, so after pulling or editing code run:

```bash
npm install && npm run restart
```

`npm run restart` rebuilds the UI, stops the server the Dock app started and launches it again.

## Playback

- **Repeat one** / **repeat artist** / **shuffle** / **repeat all** / **smart**: cycle with the mode button on the right of the player bar
- **Seek ±10s**: arrows beside play, or `←` / `→` (Shift for 30 seconds)
- **Speed**: `0.5x`–`2x`; click to cycle, hover or focus to pick an exact value
- The progress bar is draggable and keyboard-operable; volume is at the bottom right
- 👎 marks a track as disliked: it is skipped now and recommended much less later
- The right panel switches between **Up next** and **Lyrics** (click a line to jump there). The lyrics panel shows where the lyrics came from; **Search again** retries a track that had none
- A track that fails to play is skipped automatically; after three failures in a row playback stops

## Data files

All under `data/` (gitignored):

| File | Contents |
| --- | --- |
| `listens.json` | Listening events (up to 10,000), likes and dislikes |
| `playlists.json` | Playlists |
| `library-cache.json` | Parsed tags keyed by path, size and mtime, so rescans only re-read changed files |
| `lyrics/` | Downloaded lyrics, one file per track. A track with no match is retried after 14 days |

Writes are atomic (temp file + rename). If a file cannot be parsed it is renamed to `*.corrupt-<time>.json` instead of being overwritten.

Track IDs come from the FLAC STREAMINFO audio MD5 (other formats: the path relative to the library), so renaming, moving or retagging files keeps their history. History recorded by older versions (absolute-path IDs) is migrated automatically on startup.

## Recommendation algorithm

Everything runs locally. See `server/recommend.js` and `server/ml.js`.

### How feedback becomes labels

Listening time is measured as audio actually played — dragging the progress bar does not count.

| Behavior | Label |
| --- | --- |
| Like | Positive `1` |
| Dislike (👎) | Negative `0` |
| Played ≥ 80%, or ended naturally after playing ≥ 50% | Positive `1` |
| Played ≥ 55% | Soft positive `0.7` |
| Played < 22% and under 25 seconds | Negative `0` (skip) |
| Un-liking, anything else | Ignored |

Training replays events in time order, so every sample only sees statistics from *before* it (no leakage of the label or the future into the features). Positives usually far outnumber skips, so the two classes are re-weighted. If there are only positives, a few random tracks from unheard artists are used as negatives. Training uses a fixed random seed, so the same history always gives the same model.

### Per-track feature vector (68 dims)

| Block | Dims | Contents |
| --- | --- | --- |
| Artist hash | 32 | Artist name hashed with FNV-1a into signed slots |
| Album hash | 16 | Album artist + album |
| Genre hash | 8 | Genre tag, when present |
| Audio scalars | 4 | Duration, `log(1 + duration)`, sample rate, bit depth (down-weighted) |
| Affinity | 4 | Artist/album complete rates, artist play share, never-played flag |
| Behavior | 4 | Play count, skip rate, complete rate, recency decay |

Time-of-day features were removed: in a linear model they are identical for every candidate and cannot change the ranking.

### Scorers

1. **Logistic regression** (SGD, L2, soft labels, class weights) → `pLike`.
2. **Sequence**: sessions are split at 30-minute gaps. With a seed track, `seqSim` mixes how often a candidate followed the seed (first-order transitions) with Item2Vec (16-d skip-gram) similarity to the seed; without a seed it is Item2Vec similarity to your average completed track.
3. **Content**: cosine similarity of the content block with the seed.
4. **Your own favorites**: `log(1 + plays)`, normalized — songs you keep replaying are a preference, not a penalty.

### Final score and diversity

```
score = 0.20 × pLike + 0.50 × seqSim + 0.15 × plays + 0.10 × contentSim
      − 0.30 × e^(−hours since last play / 6)
      + 0.12 (liked) − 0.60 (disliked) + 0.02 (never played)
```

Then tracks are picked one by one with **MMR** (`0.8 × score − 0.2 × max similarity to already picked`). Smart mode usually takes the top pick, but 15% of the time takes one of the next four, so it does not loop over the same handful of songs.

### Offline evaluation

```bash
npm run eval
```

Splits your history by time (first 80% train, last 20% test) and reports hit@10: how often the track you actually played next appears in the top 10 recommended after the previous track. On one real history (166 tracks, ~1,500 events) the current model scores 18.9%, against 6.1% random, 4.5% "most played" and 6.4% "same artist"; the previous scoring formula scored 3.0%.

## Development

```bash
npm run check      # lint + typecheck (UI and server) + tests
npm test           # vitest
npm run lint       # eslint
npm run typecheck
```

CI runs the same checks and a production build on every push and pull request.

## Privacy

- No accounts, analytics, or remote ML APIs. Everything stays in `data/` on disk.
- The one network request: when a track without local lyrics starts, its title, artist, album and duration are sent to [lrclib.net](https://lrclib.net) to find lyrics. Listening history is never sent. Turn it off with `"onlineLyrics": false` in `config.json` or `ONLINE_LYRICS=0`.
- The HTTP server binds to **127.0.0.1** by default so the library is not exposed on your LAN, and rejects requests whose `Host` is not local (protection against DNS rebinding). Override with `HOST=0.0.0.0` only if you intend to share it on a trusted network.
- `/api/library` and `/api/stream` can list and play local files for anyone who can reach the process. Keep the bind address loopback unless you know you need otherwise.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Seek −10s / +10s |
| Shift + ← / → | 30 seconds |
| N / P | Next / previous |
| ↑ / ↓ | Volume |
| M | Mute |
| Menu key / Shift + F10 on a track | Track menu |

Safari, Chrome, and Firefox can play FLAC directly. Filenames may be hashes; the player reads title, artist, and album from the tags.

## License

[MIT](LICENSE)
