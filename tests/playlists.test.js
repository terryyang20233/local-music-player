import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Playlists } from "../server/playlists.js";

describe("Playlists", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const store = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changji-pl-"));
    dirs.push(dir);
    return { dir, playlists: new Playlists(dir) };
  };

  it("新建、加歌去重、改名、移除，并持久化", () => {
    const { dir, playlists } = store();
    expect(playlists.create("   ")).toBeNull();
    const p = playlists.create("  通勤  ");
    expect(p.name).toBe("通勤");
    playlists.addTrack(p.id, "x");
    playlists.addTrack(p.id, "x");
    playlists.addTrack(p.id, "y");
    playlists.update(p.id, { name: "晚上" });
    playlists.removeTrack(p.id, "x");

    const reloaded = new Playlists(dir);
    expect(reloaded.get(p.id)).toMatchObject({ name: "晚上", trackIds: ["y"] });
    expect(reloaded.remove(p.id)).toBe(true);
    expect(new Playlists(dir).list()).toEqual([]);
  });

  it("migrateIds 改写歌单里的歌曲 ID", () => {
    const { playlists } = store();
    const p = playlists.create("a");
    playlists.addTrack(p.id, "old");
    expect(playlists.migrateIds(new Map([["old", "new"]]))).toBe(1);
    expect(playlists.get(p.id).trackIds).toEqual(["new"]);
  });
});
