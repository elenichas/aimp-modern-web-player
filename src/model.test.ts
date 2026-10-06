import { describe, expect, it } from "vitest";
import {
  BASIC_EQ_INDICES,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  LEGACY_EQ_FREQUENCIES,
  formatTime,
  getPresetName,
  migrateLegacyGains,
  nextTrackIndex,
  quantizeEQGain,
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

describe("nextTrackIndex compatibility helper", () => {
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

describe("equalizer layout", () => {
  it("uses all eighteen original band centers and the shared compact subset", () => {
    expect(EQ_FREQUENCIES).toEqual([
      31, 63, 87, 125, 175, 250, 350, 500, 700, 1000, 1400, 2000, 2800, 4000,
      5600, 8000, 11200, 16000,
    ]);
    expect(BASIC_EQ_INDICES).toEqual([1, 3, 5, 7, 8, 9, 11, 13, 15, 17]);
    expect(BASIC_EQ_INDICES.map((index) => EQ_FREQUENCIES[index])).toEqual([
      63, 125, 250, 500, 700, 1000, 2000, 4000, 8000, 16000,
    ]);
  });
  it("provides eighteen in-range values for every clearly labeled web preset", () => {
    for (const [name, preset] of Object.entries(EQ_PRESETS)) {
      expect(name === "Flat" || name.endsWith("(web)")).toBe(true);
      expect(preset.gains).toHaveLength(18);
      expect(preset.gains.every((gain) => gain >= -15 && gain <= 15)).toBe(
        true,
      );
      expect(preset.preamp).toBeLessThanOrEqual(0);
      expect(preset.gains.every((gain) => Number.isInteger(gain * 2))).toBe(
        true,
      );
    }
  });
});

describe("legacy equalizer migration", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it("preserves values at shared frequencies rather than copying array positions", () => {
    const result = migrateLegacyGains(values);
    for (const frequency of [
      63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
    ]) {
      const oldIndex = LEGACY_EQ_FREQUENCIES.indexOf(frequency as never);
      const newIndex = EQ_FREQUENCIES.indexOf(frequency as never);
      expect(result[newIndex]).toBe(values[oldIndex]);
    }
    expect(result[0]).toBe(values[0]);
    expect(values).toHaveLength(10);
  });
  it("interpolates missing centers by log frequency and rounds to half-decibel steps", () => {
    const result = migrateLegacyGains(values);
    expect(result[8]).toBe(4.5);
    expect(result[16]).toBe(9);
    expect(result.every((gain) => Number.isInteger(gain * 2))).toBe(true);
  });
  it("preserves valid half-decibel values at all shared old centers", () => {
    const values = [0.5, -1.5, 2.5, -3.5, 4.5, -5.5, 6.5, -7.5, 8.5, -9.5];
    const migrated = migrateLegacyGains(values);
    for (const frequency of [
      63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
    ]) {
      expect(migrated[EQ_FREQUENCIES.indexOf(frequency as never)]).toBe(
        values[LEGACY_EQ_FREQUENCIES.indexOf(frequency as never)],
      );
    }
    expect(migrateLegacyGains([0.94, ...Array(9).fill(1.2)])[0]).toBe(1);
    expect(migrateLegacyGains([0.94, ...Array(9).fill(1.2)])[17]).toBe(1);
  });
  it("sanitizes corrupt legacy values and rejects wrong band counts", () => {
    expect(migrateLegacyGains([99, -99, null, 0, 0, 0, 0, 0, 0, NaN])[0]).toBe(
      15,
    );
    expect(migrateLegacyGains([99, -99, null, 0, 0, 0, 0, 0, 0, NaN])[3]).toBe(
      -15,
    );
    expect(migrateLegacyGains([99, -99, null, 0, 0, 0, 0, 0, 0, NaN])[5]).toBe(
      0,
    );
    expect(migrateLegacyGains([1, 2, 3])).toEqual(Array(18).fill(0));
  });
});

describe("derived preset labels", () => {
  it("matches all values including preamp for every web preset", () => {
    for (const [name, preset] of Object.entries(EQ_PRESETS)) {
      expect(getPresetName([...preset.gains], preset.preamp)).toBe(name);
      expect(getPresetName(preset.gains, preset.preamp + 1)).toBe("Custom");
    }
  });
  it("detects a change to a hidden compact-layout band", () => {
    const gains = [...EQ_PRESETS.Flat.gains];
    gains[0] = 1;
    expect(getPresetName(gains, 0)).toBe("Custom");
  });
  it("supports saved presets and rejects malformed or nonfinite gains", () => {
    const preset = { gains: Array(18).fill(2), preamp: -3 };
    expect(
      getPresetName(preset.gains, -3, { ...EQ_PRESETS, Mine: preset }),
    ).toBe("Mine");
    expect(getPresetName(Array(10).fill(0), 0)).toBe("Custom");
    expect(getPresetName([NaN, ...Array(17).fill(0)], 0)).toBe("Custom");
    expect(getPresetName(Array(18).fill(0), Infinity)).toBe("Custom");
  });
});

describe("equalizer gain quantization", () => {
  it("clamps, rounds, and sanitizes consistently with the half-decibel controls", () => {
    expect(
      [0.94, -0.94, 1.24, 1.26, 99, -99, null, NaN, Infinity].map(
        quantizeEQGain,
      ),
    ).toEqual([1, -1, 1, 1.5, 15, -15, 0, 0, 0]);
    expect(Object.is(quantizeEQGain(-0.1), -0)).toBe(false);
  });
});
