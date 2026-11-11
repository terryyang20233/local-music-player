import crypto from "node:crypto";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./store.js";

const MAX_NAME = 60;

function cleanName(name) {
  const text = String(name ?? "").trim().slice(0, MAX_NAME);
  return text || null;
}

/** 歌单，存在 data/playlists.json。 */
export class Playlists {
  constructor(dataDir) {
    this.file = path.join(dataDir, "playlists.json");
    const raw = readJson(this.file, {});
    this.items = Array.isArray(raw.playlists) ? raw.playlists : [];
  }

  #save() {
    writeJsonAtomic(this.file, { playlists: this.items });
  }

  list() {
    return this.items;
  }

  get(id) {
    return this.items.find((p) => p.id === id) || null;
  }

  create(name) {
    const clean = cleanName(name);
    if (!clean) return null;
    const now = Date.now();
    const playlist = { id: crypto.randomUUID().slice(0, 8), name: clean, trackIds: [], createdAt: now, updatedAt: now };
    this.items.push(playlist);
    this.#save();
    return playlist;
  }

  /** @param {string} id @param {{ name?: string, trackIds?: string[] }} [changes] */
  update(id, { name, trackIds } = {}) {
    const playlist = this.get(id);
    if (!playlist) return null;
    if (name !== undefined) {
      const clean = cleanName(name);
      if (clean) playlist.name = clean;
    }
    if (Array.isArray(trackIds)) {
      playlist.trackIds = [...new Set(trackIds.filter((t) => typeof t === "string"))];
    }
    playlist.updatedAt = Date.now();
    this.#save();
    return playlist;
  }

  addTrack(id, trackId) {
    const playlist = this.get(id);
    if (!playlist || typeof trackId !== "string") return null;
    if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
    playlist.updatedAt = Date.now();
    this.#save();
    return playlist;
  }

  removeTrack(id, trackId) {
    const playlist = this.get(id);
    if (!playlist) return null;
    playlist.trackIds = playlist.trackIds.filter((t) => t !== trackId);
    playlist.updatedAt = Date.now();
    this.#save();
    return playlist;
  }

  /**
   * 撤销删除：按原 ID 放回 index 位置。同 ID 的歌单已经存在时直接返回它（重复撤销不会多出一份）。
   * @param {{ id?: unknown, name?: unknown, trackIds?: unknown, createdAt?: unknown }} playlist
   * @param {unknown} index
   */
  restore(playlist, index) {
    if (!playlist || typeof playlist.id !== "string" || !/^[\w-]{1,64}$/.test(playlist.id)) return null;
    const existing = this.get(playlist.id);
    if (existing) return existing;
    const name = cleanName(playlist.name);
    if (!name) return null;
    const now = Date.now();
    const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds.filter((t) => typeof t === "string") : [];
    const restored = {
      id: playlist.id,
      name,
      trackIds: [...new Set(trackIds)],
      createdAt: Number.isFinite(playlist.createdAt) ? Number(playlist.createdAt) : now,
      updatedAt: now,
    };
    const at = Number.isInteger(index) ? Math.max(0, Math.min(Number(index), this.items.length)) : this.items.length;
    this.items.splice(at, 0, restored);
    this.#save();
    return restored;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((p) => p.id !== id);
    if (this.items.length !== before) this.#save();
    return this.items.length !== before;
  }

  /** ID 规则升级时同步改写歌单里的歌曲 ID。 */
  migrateIds(idMap) {
    let changed = 0;
    for (const playlist of this.items) {
      playlist.trackIds = playlist.trackIds.map((t) => {
        const next = idMap.get(t);
        if (next && next !== t) {
          changed += 1;
          return next;
        }
        return t;
      });
    }
    if (changed) this.#save();
    return changed;
  }
}
