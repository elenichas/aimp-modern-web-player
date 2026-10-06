import { describe, it, expect } from "vitest";
import { EQ_FREQUENCIES } from "./model";
import {
  defaults,
  MAX_PRESET_NAME_LENGTH,
  MAX_USER_PRESETS,
  parseSettings,
  sanitizePresetName,
  sanitizeUserPresets,
  SETTINGS_VERSION,
} from "./settings";

describe("persisted settings", () => {
  it("falls back safely for invalid JSON and non-objects", () => {
    for (const raw of [null, "broken", "null", "5", "[]"])
      expect(parseSettings(raw)).toEqual(defaults);
  });
  it("uses a versioned schema with eighteen bands and neutral new effects", () => {
    const s = parseSettings(null);
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.gains).toEqual(Array(EQ_FREQUENCIES.length).fill(0));
    expect([s.reverb, s.chorus, s.flanger, s.speed, s.tempo]).toEqual([
      0, 0, 0, 1, 1,
    ]);
    expect(s.repeatPlaylist).toBe(false);
    expect(s.advanced).toBe(false);
    expect(s.userPresets).toEqual({});
  });
  it("clamps audio parameters to the original control bounds", () => {
    const s = parseSettings(
      JSON.stringify({
        volume: 4,
        echo: -1,
        balance: -8,
        preamp: 99,
        reverb: 3,
        chorus: -5,
        flanger: 8,
        speed: 99,
        tempo: -9,
      }),
    );
    expect([s.volume, s.echo, s.balance, s.preamp]).toEqual([1, 0, -1, 15]);
    expect([s.reverb, s.chorus, s.flanger, s.speed, s.tempo]).toEqual([
      1, 0, 1, 1, 0.5,
    ]);
  });
  it("normalizes conflicting speed and tempo modes to the active tempo mode", () => {
    expect(parseSettings('{"speed":1.7,"tempo":1.2}').speed).toBe(1);
    expect(parseSettings('{"speed":1.7,"tempo":1}').speed).toBe(1.7);
    expect(parseSettings('{"speed":0.75,"tempo":null}').speed).toBe(0.75);
  });
  it("rejects wrong types and invalid current-schema gains", () => {
    const s = parseSettings(
      JSON.stringify({
        version: 2,
        volume: "loud",
        muted: "true",
        advanced: 1,
        repeatPlaylist: "yes",
        gains: [null, 2, "x", 99, -99, ...Array(13).fill(0)],
      }),
    );
    expect(s.volume).toBe(defaults.volume);
    expect(s.muted).toBe(false);
    expect(s.advanced).toBe(false);
    expect(s.repeatPlaylist).toBe(false);
    expect(s.gains.slice(0, 5)).toEqual([0, 2, 0, 15, -15]);
  });
  it("quantizes restored gains and preamp to the visible half-decibel controls", () => {
    const s = parseSettings(
      JSON.stringify({
        version: 2,
        gains: Array(18).fill(0.94),
        preamp: -2.26,
      }),
    );
    expect(s.gains).toEqual(Array(18).fill(1));
    expect(s.preamp).toBe(-2.5);
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
  });
  it("ignores nonfinite persisted numbers", () => {
    const s = parseSettings('{"speed":1e999,"tempo":null,"preamp":-1e999}');
    expect([s.speed, s.tempo, s.preamp]).toEqual([1, 1, 0]);
  });
  it("migrates versionless and version 1 ten-band curves by frequency", () => {
    for (const version of [undefined, 1]) {
      const s = parseSettings(
        JSON.stringify({ version, gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
      );
      expect(s.version).toBe(2);
      expect(s.gains).toHaveLength(18);
      expect(s.gains[1]).toBe(1);
      expect(s.gains[3]).toBe(2);
      expect(s.gains[9]).toBe(5);
      expect(s.gains[17]).toBe(10);
    }
  });
  it("does not mistake malformed new-schema arrays for legacy data", () => {
    for (const version of [2, 3]) {
      expect(
        parseSettings(JSON.stringify({ version, gains: Array(10).fill(5) }))
          .gains,
      ).toEqual(defaults.gains);
    }
  });
  it("preserves preferences and creates independent arrays and preset maps", () => {
    const raw = JSON.stringify({
      version: 2,
      volume: 0.3,
      eq: false,
      shuffle: true,
      repeat: true,
      repeatPlaylist: true,
      advanced: true,
      visual: false,
      speed: 1.2,
      tempo: 0.8,
      userPresets: { Mine: { gains: Array(18).fill(1), preamp: -2 } },
    });
    const s = parseSettings(raw);
    expect(s.volume).toBe(0.3);
    expect(s.eq).toBe(false);
    expect(s.shuffle).toBe(true);
    expect(s.repeat).toBe(true);
    expect(s.repeatPlaylist).toBe(true);
    expect(s.advanced).toBe(true);
    expect(s.visual).toBe(false);
    expect([s.speed, s.tempo]).toEqual([1, 0.8]);
    s.gains[0] = 12;
    s.userPresets.Mine.gains[0] = 15;
    expect(defaults.gains[0]).toBe(0);
    expect(defaults.userPresets).toEqual({});
    expect(parseSettings(raw).userPresets.Mine.gains[0]).toBe(1);
  });
  it("round-trips the recognized schema without restoring tracks or unknown data", () => {
    const saved = parseSettings(
      JSON.stringify({
        ...defaults,
        title: "Private song",
        tracks: [{ url: "blob:private" }],
      }),
    );
    expect(saved).toEqual(defaults);
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
    expect(JSON.stringify(saved)).not.toContain("Private song");
    expect(JSON.stringify(saved)).not.toContain("blob:private");
  });
});

describe("user equalizer presets", () => {
  const valid = () => ({ gains: Array(18).fill(2), preamp: -1 });
  it("sanitizes names, blocks reserved names, and enforces a length limit", () => {
    expect(sanitizePresetName(" \n  My\t preset \u0000 ")).toBe("My preset");
    expect(sanitizePresetName("a".repeat(100))).toHaveLength(
      MAX_PRESET_NAME_LENGTH,
    );
    for (const name of [
      "",
      "  ",
      "__proto__",
      "prototype",
      "constructor",
      "Custom",
      "Flat",
      "Warm (web)",
    ])
      expect(sanitizePresetName(name)).toBe("");
  });
  it("restores only correctly shaped presets and clamps every gain", () => {
    const presets = sanitizeUserPresets({
      " My curve ": { gains: Array(18).fill(999), preamp: -99 },
      TooShort: { gains: [1, 2], preamp: 0 },
      BadGain: { gains: [null, ...Array(17).fill(0)], preamp: 0 },
      NoPreamp: { gains: Array(18).fill(0) },
      BadPreamp: { gains: Array(18).fill(0), preamp: "loud" },
      String: "wrong",
      Array: [],
    });
    expect(presets).toEqual({
      "My curve": { gains: Array(18).fill(15), preamp: -15 },
    });
  });
  it("quantizes saved presets to the same half-decibel steps as the sliders", () => {
    expect(
      sanitizeUserPresets({
        Mine: { gains: Array(18).fill(-0.94), preamp: 1.3 },
      }),
    ).toEqual({ Mine: { gains: Array(18).fill(-1), preamp: 1.5 } });
  });
  it("bounds saved preset count and does not overwrite sanitized-name collisions", () => {
    const source = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`Preset ${index}`, valid()]),
    );
    expect(Object.keys(sanitizeUserPresets(source))).toHaveLength(
      MAX_USER_PRESETS,
    );
    expect(
      sanitizeUserPresets({
        Mine: valid(),
        " Mine ": { gains: Array(18).fill(9), preamp: 9 },
      }).Mine,
    ).toEqual(valid());
  });
  it("rejects prototype keys without mutating object prototypes", () => {
    const source = JSON.parse(
      JSON.stringify(
        Object.fromEntries([
          ["__proto__", valid()],
          ["constructor", valid()],
          ["prototype", valid()],
          ["Mine", valid()],
        ]),
      ),
    );
    const presets = sanitizeUserPresets(source);
    expect(Object.keys(presets)).toEqual(["Mine"]);
    expect(Object.getPrototypeOf(presets)).toBe(Object.prototype);
    expect(Object.hasOwn(presets, "__proto__")).toBe(false);
  });
  it("returns independent values and safe empty results for invalid input", () => {
    for (const source of [null, [], "text", 1])
      expect(sanitizeUserPresets(source)).toEqual({});
    const source = { Mine: valid() };
    const presets = sanitizeUserPresets(source);
    presets.Mine.gains[0] = 10;
    expect(source.Mine.gains[0]).toBe(2);
  });
});
