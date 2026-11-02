import { describe, expect, it } from "vitest";
import { replayGainFactor } from "../src/audio";

describe("replayGainFactor", () => {
  it("没有增益信息时为 1", () => {
    expect(replayGainFactor(null)).toBe(1);
    expect(replayGainFactor({ trackGain: null, trackPeak: null, albumGain: null, albumPeak: null })).toBe(1);
  });

  it("按 dB 换算倍数，优先单曲增益", () => {
    expect(replayGainFactor({ trackGain: -6, trackPeak: null, albumGain: 3, albumPeak: null })).toBeCloseTo(0.501, 3);
    expect(replayGainFactor({ trackGain: null, trackPeak: null, albumGain: -6, albumPeak: null })).toBeCloseTo(0.501, 3);
  });

  it("正增益受峰值限制，不会削波", () => {
    expect(replayGainFactor({ trackGain: 6, trackPeak: 0.8, albumGain: null, albumPeak: null })).toBeCloseTo(1.25);
  });
});
