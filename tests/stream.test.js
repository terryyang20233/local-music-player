import { describe, expect, it } from "vitest";
import { parseRange } from "../server/stream.js";

describe("parseRange", () => {
  const size = 1000;

  it("普通范围和开放范围", () => {
    expect(parseRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
  });

  it("后缀范围表示最后 N 字节", () => {
    expect(parseRange("bytes=-100", size)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", size)).toEqual({ start: 0, end: 999 });
  });

  it("结尾越界时截到文件末尾", () => {
    expect(parseRange("bytes=900-5000", size)).toEqual({ start: 900, end: 999 });
  });

  it("起点越界或倒置返回 unsatisfiable", () => {
    expect(parseRange("bytes=1000-", size)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", size)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", size)).toBe("unsatisfiable");
  });

  it("格式错误返回 null（按 RFC 忽略 Range）", () => {
    expect(parseRange("bytes=abc", size)).toBeNull();
    expect(parseRange("bytes=-", size)).toBeNull();
    expect(parseRange("items=0-1", size)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", size)).toBeNull();
  });
});
