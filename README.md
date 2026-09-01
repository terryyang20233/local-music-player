# 唱机 — Local Music Player

[中文](README.zh.md)

A local FLAC player with on-device recommendations. It scans a folder on your machine, plays audio in the browser, and learns what you finish or skip — without uploading listening history.

The UI is in Chinese. Audio files and play history are **not** in this repo.

## Features

- FLAC (and other common formats) from a local folder, using Vorbis tags for title / artist / album
- Repeat one, repeat artist, shuffle, repeat all, plus a **smart** mode that picks the next track
- Seek, playback speed (`0.5x`–`2x`), volume, keyboard shortcuts
- **For you**: logistic regression + Item2Vec + content neighbors, trained on this device
- Optional macOS app wrapper so you can launch from the Dock

## Requirements

- Node.js 18+
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

Then click **重新扫描** (rescan) in the sidebar.

On macOS, generate a local **唱机.app** (Desktop + `~/Applications`) with:

```bash
npm run install-app
```

The first launch builds the UI and opens a browser. Quitting from the Dock stops the background server. Do not commit `唱机.app`; it is machine-specific (it stores your clone path).

## Playback

- **Repeat one** / **repeat artist** / **shuffle** / **repeat all**: cycle with the mode button on the right of the player bar
- **Seek ±10s**: arrows beside play, or `←` / `→` (Shift for 30 seconds)
- **Speed**: `0.5x`–`2x`; click to cycle, hover to pick an exact value
- The progress bar is draggable; volume is at the bottom right
- **For you**: completes, skips, and likes go to `data/listens.json` (gitignored) and the model retrains immediately
- **Smart** play mode: the next track is chosen by the same model

## Recommendation algorithm

Everything runs locally. See `server/recommend.js` and `server/ml.js`.

### How feedback becomes labels

Each complete, skip, like, or dislike is stored as an event (up to 2500 events). Labeling:

| Behavior | Label |
| --- | --- |
| Like | Positive `1` |
| Dislike | Negative `0` |
| Natural end, or progress ≥ 80% | Positive `1` |
| Progress ≥ 55% (not finished) | Weak positive `0.7`; treated as positive in training |
| Progress < 22% and under 25 seconds | Negative `0` (skip) |
| Anything else | Ignored |

A like also adds extra complete-count to that track. If there are only positives, a few tracks from unheard artists are used as synthetic negatives so the model does not collapse to all 1s.

### Per-track feature vector (35 dims)

| Block | Dims | Contents |
| --- | --- | --- |
| Artist hash | 12 | Artist name hashed with FNV-1a into fixed slots |
| Album hash | 8 | Same for album name |
| Audio scalars | 4 | Duration, `log(1 + duration)`, sample rate, bit depth |
| Affinity | 4 | Artist/album complete rates, artist play share, never-played flag |
| Behavior | 4 | Play count, skip rate, complete rate, recency decay |
| Context | 3 | sin/cos of current hour, weekend flag |

### Three scorers

1. **Logistic regression** (SGD, L2): predicts `pLike` from the feature vector. Trains only when there are at least 3 samples with both classes; otherwise `pLike = 0.5`.
2. **Item2Vec** (16-d skip-gram): listening events are split into sessions at a 30-minute idle gap, window 2, 4 negative samples. Completed tracks are averaged into a user vector; cosine similarity with a candidate is `seqSim`.
3. **Content neighbors**: artist + album hashes plus audio scalars. If there is a seed (the current track), cosine similarity with the candidate is `contentSim`; without a seed this term is a neutral `0.5`.

### Final score and diversity

```
score = 0.46 × pLike + 0.24 × seqSim + 0.22 × contentSim
      + 0.08 (never played) + 0.12 (liked) − 0.03 × min(play count, 6)
```

Tracks are then picked one by one with **MMR** so the list is not all one artist or album:

```
mmr = 0.72 × score − 0.28 × max(content similarity to already picked tracks)
```

The **For you** sidebar requests 12 tracks. **Smart** next-track uses the same scores and takes the top of a 6-item list. Card copy (same artist, often played together, taste match %) follows whichever of `pLike`, sequence similarity, or content similarity stands out.

Cold start: until there is enough feedback the logistic model stays untrained. The list can still rank by content similarity and a small novelty bonus; the UI asks you to listen to a few tracks first.

## Privacy

- No accounts, analytics, or remote ML APIs. History stays in `data/listens.json` on disk.
- The HTTP server binds to **127.0.0.1** by default so the library is not exposed on your LAN. Override with `HOST=0.0.0.0` only if you intend to share it on a trusted network.
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

Safari, Chrome, and Firefox can play FLAC directly. Filenames may be hashes; the player reads title, artist, and album from Vorbis tags.

## License

[MIT](LICENSE)
