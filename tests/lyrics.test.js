import { describe, expect, it } from "vitest";
import { parseLrc } from "../server/lyrics.js";

describe("parseLrc", () => {
  it("按时间排序，支持一行多个时间标签", () => {
    const { synced, lines } = parseLrc("[ti:歌]\n[00:10.50]第二句\n[00:01.00][00:20]副歌\n");
    expect(synced).toBe(true);
    expect(lines).toEqual([
      { time: 1, text: "副歌" },
      { time: 10.5, text: "第二句" },
      { time: 20, text: "副歌" },
    ]);
  });

  it("应用 offset（正数表示歌词提前）", () => {
    const { lines } = parseLrc("[offset:500]\n[00:02.00]a");
    expect(lines[0].time).toBeCloseTo(1.5);
  });

  it("支持三位毫秒和 BOM", () => {
    const { lines } = parseLrc("﻿[01:02.345]x");
    expect(lines[0].time).toBeCloseTo(62.345);
  });

  it("没有时间标签时当作纯文本歌词", () => {
    const { synced, lines } = parseLrc("第一行\n\n第二行");
    expect(synced).toBe(false);
    expect(lines.map((l) => l.text)).toEqual(["第一行", "第二行"]);
  });
});
