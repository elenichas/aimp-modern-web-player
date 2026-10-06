import { describe, expect, it } from "vitest";
import {
  EQ_FREQUENCIES,
  EQ_PRESETS,
  formatTime,
  nextTrackIndex,
} from "./model";

describe("formatTime", () => {
  it("formats progress and long durations", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9.9)).toBe("0:09");
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(3601)).toBe("60:01");
  });
  it("handles invalid metadata safely", () => {
    for (const input of [NaN, Infinity, -Infinity, -1])
      expect(formatTime(input)).toBe("0:00");
  });
});

describe("nextTrackIndex", () => {
  it("handles an empty playlist and a single track", () => {
    expect(nextTrackIndex(0, 0, false)).toBe(-1);
    expect(nextTrackIndex(0, NaN, true)).toBe(-1);
    expect(nextTrackIndex(0, 1, true)).toBe(0);
  });
  it("advances and wraps sequentially", () => {
    expect(nextTrackIndex(-1, 3, false)).toBe(0);
    expect(nextTrackIndex(0, 3, false)).toBe(1);
    expect(nextTrackIndex(2, 3, false)).toBe(0);
    expect(nextTrackIndex(99, 3, false)).toBe(0);
  });
  it("shuffles across every other track without immediate repeats", () => {
    for (let current = 0; current < 4; current++) {
      const results = [0, 0.34, 0.67, 1].map((random) =>
        nextTrackIndex(current, 4, true, () => random),
      );
      expect(results).not.toContain(current);
      expect([...new Set(results)].sort()).toEqual(
        [0, 1, 2, 3].filter((index) => index !== current),
      );
    }
  });
  it("handles invalid random values without invalid indexes", () => {
    for (const random of [NaN, Infinity, -1, 1, 2]) {
      const index = nextTrackIndex(0, 3, true, () => random);
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThan(3);
    }
  });
});

describe("equalizer presets", () => {
  it("provides ten in-range values for every preset", () => {
    expect(EQ_FREQUENCIES).toEqual([
      63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
    ]);
    for (const preset of Object.values(EQ_PRESETS)) {
      expect(preset.gains).toHaveLength(10);
      expect(preset.gains.every((gain) => gain >= -12 && gain <= 12)).toBe(
        true,
      );
      expect(preset.preamp).toBeLessThanOrEqual(0);
    }
  });
});
