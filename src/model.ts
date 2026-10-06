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
}

export const EQ_FREQUENCIES = [
  63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
] as const;

export interface EQPreset {
  gains: number[];
  preamp: number;
}

export const EQ_PRESETS: Record<string, EQPreset> = {
  Flat: { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  Warm: { gains: [3, 3, 2, 1, 0, -1, -2, -2, -1, 0], preamp: -2 },
  "Bass Boost": { gains: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0], preamp: -4 },
  Vocal: { gains: [-3, -2, -1, 1, 3, 4, 3, 1, -1, -2], preamp: -3 },
  Electronic: { gains: [4, 3, 1, -1, -2, 0, 2, 3, 4, 3], preamp: -3 },
  Acoustic: { gains: [1, 2, 2, 0, 1, 2, 3, 2, 1, 0], preamp: -2 },
};

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Picks a next track without immediately repeating the current track in shuffle mode. */
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
