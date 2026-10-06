export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  duration: number;
  format: string;
  /** Encoded file size in bytes. */
  size: number;
  source: "demo" | "local";
  /** Metadata is optional: do not infer it from a file extension. */
  channels?: number;
  /** Samples per second. */
  sampleRate?: number;
  /** Encoded audio bits per second, when known. */
  bitrate?: number;
}

/** AIMP's full equalizer band centers, in hertz. */
export const EQ_FREQUENCIES = [
  31, 63, 87, 125, 175, 250, 350, 500, 700, 1000, 1400, 2000, 2800, 4000, 5600,
  8000, 11200, 16000,
] as const;

/** The compact layout controls the same underlying bands as the full layout. */
export const BASIC_EQ_INDICES = [1, 3, 5, 7, 8, 9, 11, 13, 15, 17] as const;
export const EQ_GAIN_LIMIT = 15;
export const EQ_GAIN_STEP = 0.5;

/** The old web player's ten-band centers, used only to migrate saved settings. */
export const LEGACY_EQ_FREQUENCIES = [
  63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
] as const;

export interface EQPreset {
  gains: number[];
  preamp: number;
}

const clampGain = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, value))
    : 0;

/** Match the half-decibel range controls, including persisted and preset values. */
export function quantizeEQGain(value: unknown): number {
  const gain = Math.round(clampGain(value) / EQ_GAIN_STEP) * EQ_GAIN_STEP;
  return gain === 0 ? 0 : gain;
}

/** Interpolate the old curve in log-frequency space, then round to half-decibel steps. */
export function migrateLegacyGains(gains: readonly unknown[]): number[] {
  if (gains.length !== LEGACY_EQ_FREQUENCIES.length)
    return EQ_FREQUENCIES.map(() => 0);
  const clean = gains.map(clampGain);
  return EQ_FREQUENCIES.map((frequency) => {
    if (frequency <= LEGACY_EQ_FREQUENCIES[0]) return quantizeEQGain(clean[0]);
    const upper = LEGACY_EQ_FREQUENCIES.findIndex(
      (center) => center >= frequency,
    );
    if (upper < 0) return quantizeEQGain(clean[clean.length - 1]);
    const lower = upper - 1;
    const fraction =
      Math.log(frequency / LEGACY_EQ_FREQUENCIES[lower]) /
      Math.log(LEGACY_EQ_FREQUENCIES[upper] / LEGACY_EQ_FREQUENCIES[lower]);
    return quantizeEQGain(
      clean[lower] + (clean[upper] - clean[lower]) * fraction,
    );
  });
}

/** Original web-player curves, not reproductions of AIMP's factory presets. */
export const EQ_PRESETS: Record<string, EQPreset> = {
  Flat: { gains: EQ_FREQUENCIES.map(() => 0), preamp: 0 },
  "Warm (web)": {
    gains: migrateLegacyGains([3, 3, 2, 1, 0, -1, -2, -2, -1, 0]),
    preamp: -2,
  },
  "Bass Boost (web)": {
    gains: migrateLegacyGains([6, 5, 3, 1, 0, 0, 0, 0, 0, 0]),
    preamp: -4,
  },
  "Vocal (web)": {
    gains: migrateLegacyGains([-3, -2, -1, 1, 3, 4, 3, 1, -1, -2]),
    preamp: -3,
  },
  "Electronic (web)": {
    gains: migrateLegacyGains([4, 3, 1, -1, -2, 0, 2, 3, 4, 3]),
    preamp: -3,
  },
  "Acoustic (web)": {
    gains: migrateLegacyGains([1, 2, 2, 0, 1, 2, 3, 2, 1, 0]),
    preamp: -2,
  },
};

/** Derive the label from every band and the preamp, including after reload/reset. */
export function getPresetName(
  gains: readonly number[],
  preamp: number,
  presets: Readonly<Record<string, EQPreset>> = EQ_PRESETS,
): string {
  if (gains.length !== EQ_FREQUENCIES.length || !Number.isFinite(preamp))
    return "Custom";
  const matches = (left: number, right: number) =>
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) < 1e-6;
  return (
    Object.entries(presets).find(
      ([, preset]) =>
        preset.gains.length === gains.length &&
        matches(preamp, preset.preamp) &&
        gains.every((gain, index) => matches(gain, preset.gains[index])),
    )?.[0] ?? "Custom"
  );
}

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Stateless compatibility helper; use PlaybackSequence for full shuffle history. */
export function nextTrackIndex(
  current: number,
  length: number,
  shuffle: boolean,
  random: () => number = Math.random,
): number {
  const count = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (!count) return -1;
  if (count === 1) return 0;
  const validCurrent =
    Number.isInteger(current) && current >= 0 && current < count;
  if (!shuffle) return validCurrent ? (current + 1) % count : 0;
  const sample = random();
  const unit = Number.isFinite(sample)
    ? Math.min(0.9999999999999999, Math.max(0, sample))
    : 0;
  if (!validCurrent) return Math.floor(unit * count);
  const index = Math.floor(unit * (count - 1));
  return index >= current ? index + 1 : index;
}
