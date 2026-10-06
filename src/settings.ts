export type Settings = {
  volume: number;
  muted: boolean;
  balance: number;
  echo: number;
  gains: number[];
  preamp: number;
  eq: boolean;
  shuffle: boolean;
  repeat: boolean;
  visual: boolean;
};
export const defaults: Settings = {
  volume: 0.65,
  muted: false,
  balance: 0,
  echo: 0,
  gains: Array(10).fill(0),
  preamp: 0,
  eq: true,
  shuffle: false,
  repeat: false,
  visual: true,
};
export function parseSettings(raw: string | null): Settings {
  const fresh = { ...defaults, gains: [...defaults.gains] };
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fresh;
    const s = value as Record<string, unknown>;
    const number = (key: keyof Settings, min: number, max: number) =>
      typeof s[key] === "number" && Number.isFinite(s[key])
        ? Math.max(min, Math.min(max, s[key] as number))
        : (defaults[key] as number);
    const boolean = (key: keyof Settings) =>
      typeof s[key] === "boolean"
        ? (s[key] as boolean)
        : (defaults[key] as boolean);
    return {
      volume: number("volume", 0, 1),
      balance: number("balance", -1, 1),
      echo: number("echo", 0, 1),
      preamp: number("preamp", -12, 12),
      muted: boolean("muted"),
      eq: boolean("eq"),
      shuffle: boolean("shuffle"),
      repeat: boolean("repeat"),
      visual: boolean("visual"),
      gains:
        Array.isArray(s.gains) && s.gains.length === 10
          ? s.gains.map((v) =>
              typeof v === "number" && Number.isFinite(v)
                ? Math.max(-12, Math.min(12, v))
                : 0,
            )
          : fresh.gains,
    };
  } catch {
    return fresh;
  }
}
