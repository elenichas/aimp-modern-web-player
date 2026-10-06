import {
  EQ_FREQUENCIES,
  EQ_GAIN_LIMIT,
  EQ_PRESETS,
  migrateLegacyGains,
  quantizeEQGain,
  type EQPreset,
} from "./model";

export const SETTINGS_VERSION = 2;
export const MAX_USER_PRESETS = 32;
export const MAX_PRESET_NAME_LENGTH = 48;

export type Settings = {
  version: number;
  volume: number;
  muted: boolean;
  balance: number;
  echo: number;
  reverb: number;
  chorus: number;
  flanger: number;
  speed: number;
  tempo: number;
  gains: number[];
  preamp: number;
  eq: boolean;
  advanced: boolean;
  shuffle: boolean;
  /** Repeat the current track. */
  repeat: boolean;
  repeatPlaylist: boolean;
  visual: boolean;
  userPresets: Record<string, EQPreset>;
};

export const defaults: Settings = {
  version: SETTINGS_VERSION,
  volume: 0.65,
  muted: false,
  balance: 0,
  echo: 0,
  reverb: 0,
  chorus: 0,
  flanger: 0,
  speed: 1,
  tempo: 1,
  gains: EQ_FREQUENCIES.map(() => 0),
  preamp: 0,
  eq: true,
  advanced: false,
  shuffle: false,
  repeat: false,
  repeatPlaylist: false,
  visual: true,
  userPresets: {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Empty, reserved, or unsafe names cannot be saved as user presets. */
export function sanitizePresetName(value: string): string {
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_PRESET_NAME_LENGTH)
    .trim();
  if (
    !name ||
    ["__proto__", "prototype", "constructor", "Custom"].includes(name) ||
    Object.hasOwn(EQ_PRESETS, name)
  )
    return "";
  return name;
}

/** Keep bounded, valid local data; never restore arbitrary persisted properties. */
export function sanitizeUserPresets(value: unknown): Record<string, EQPreset> {
  const presets: Record<string, EQPreset> = {};
  if (!isRecord(value)) return presets;
  for (const [rawName, preset] of Object.entries(value)) {
    if (Object.keys(presets).length >= MAX_USER_PRESETS) break;
    const name = sanitizePresetName(rawName);
    if (
      !name ||
      Object.hasOwn(presets, name) ||
      !isRecord(preset) ||
      !Array.isArray(preset.gains) ||
      preset.gains.length !== EQ_FREQUENCIES.length ||
      !preset.gains.every(
        (gain) => typeof gain === "number" && Number.isFinite(gain),
      ) ||
      typeof preset.preamp !== "number" ||
      !Number.isFinite(preset.preamp)
    )
      continue;
    presets[name] = {
      gains: preset.gains.map(quantizeEQGain),
      preamp: quantizeEQGain(preset.preamp),
    };
  }
  return presets;
}

/** Parse only preferences. Track URLs, file names, and audio never enter this schema. */
export function parseSettings(raw: string | null): Settings {
  const fresh = { ...defaults, gains: [...defaults.gains], userPresets: {} };
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!isRecord(value)) return fresh;
    const s = value;
    const number = (key: keyof Settings, min: number, max: number) =>
      typeof s[key] === "number" && Number.isFinite(s[key])
        ? clamp(s[key] as number, min, max)
        : (defaults[key] as number);
    const boolean = (key: keyof Settings) =>
      typeof s[key] === "boolean"
        ? (s[key] as boolean)
        : (defaults[key] as boolean);
    let gains = fresh.gains;
    if (Array.isArray(s.gains)) {
      if (s.gains.length === EQ_FREQUENCIES.length) {
        gains = s.gains.map(quantizeEQGain);
      } else if (s.version === undefined || s.version === 1) {
        gains = migrateLegacyGains(s.gains);
      }
    }
    const tempo = number("tempo", 0.5, 2);
    return {
      version: SETTINGS_VERSION,
      volume: number("volume", 0, 1),
      balance: number("balance", -1, 1),
      echo: number("echo", 0, 1),
      reverb: number("reverb", 0, 1),
      chorus: number("chorus", 0, 1),
      flanger: number("flanger", 0, 1),
      // The browser engine uses one playback-rate mode at a time.
      speed: tempo !== 1 ? 1 : number("speed", 0.5, 2),
      tempo,
      preamp: quantizeEQGain(number("preamp", -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT)),
      muted: boolean("muted"),
      eq: boolean("eq"),
      advanced: boolean("advanced"),
      shuffle: boolean("shuffle"),
      repeat: boolean("repeat"),
      repeatPlaylist: boolean("repeatPlaylist"),
      visual: boolean("visual"),
      gains,
      userPresets: sanitizeUserPresets(s.userPresets),
    };
  } catch {
    return fresh;
  }
}
