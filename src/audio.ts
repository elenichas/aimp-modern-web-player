import { EQ_FREQUENCIES, type Track } from "./model";

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
const decibelsToGain = (decibels: number) => 10 ** (decibels / 20);

/** A single media element and a lazily created, gesture-activated Web Audio graph. */
export class AudioEngine {
  readonly audio: HTMLAudioElement;
  analyser?: AnalyserNode;
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private preamp?: GainNode;
  private filters: BiquadFilterNode[] = [];
  private panner?: StereoPannerNode;
  private dry?: GainNode;
  private delay?: DelayNode;
  private wet?: GainNode;
  private feedback?: GainNode;
  private output?: GainNode;
  private nodes: AudioNode[] = [];
  private disposed = false;
  private playbackToken = 0;
  private volume = 0.75;
  private muted = false;
  private gains = EQ_FREQUENCIES.map(() => 0);
  private preampDB = 0;
  private eqEnabled = true;
  private balance = 0;
  private echo = 0;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = 1;
  }

  async init(): Promise<void> {
    if (this.disposed) throw new Error("The audio engine has been closed.");
    if (!this.context) {
      const AudioContextClass =
        globalThis.AudioContext ||
        (
          globalThis as typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextClass)
        throw new Error("This browser does not support the Web Audio API.");
      const context = new AudioContextClass();
      this.context = context;
      this.source = context.createMediaElementSource(this.audio);
      this.preamp = context.createGain();
      this.filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = context.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = Math.min(
          frequency,
          context.sampleRate / 2 - 1,
        );
        filter.Q.value = 1.05;
        return filter;
      });
      this.panner = context.createStereoPanner();
      this.dry = context.createGain();
      this.delay = context.createDelay(1);
      this.delay.delayTime.value = 0.285;
      this.wet = context.createGain();
      this.feedback = context.createGain();
      this.feedback.gain.value = 0.28;
      this.output = context.createGain();
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = -85;
      this.analyser.maxDecibels = -20;

      // Equalization and balance happen before the parallel dry / echo paths.
      this.source.connect(this.preamp);
      let upstream: AudioNode = this.preamp;
      for (const filter of this.filters) {
        upstream.connect(filter);
        upstream = filter;
      }
      upstream.connect(this.panner);
      this.panner.connect(this.dry);
      this.dry.connect(this.output);
      this.panner.connect(this.delay);
      this.delay.connect(this.wet);
      this.wet.connect(this.output);
      this.delay.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.output.connect(this.analyser);
      this.analyser.connect(context.destination);
      this.nodes = [
        this.source,
        this.preamp,
        ...this.filters,
        this.panner,
        this.dry,
        this.delay,
        this.wet,
        this.feedback,
        this.output,
        this.analyser,
      ];
      this.applySettings(true);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  async play(): Promise<void> {
    if (this.disposed) throw new Error("The audio engine has been closed.");
    if (!this.audio.getAttribute("src"))
      throw new Error("Choose a track to start listening.");
    const token = ++this.playbackToken;
    // init() constructs / resumes the graph synchronously before its first await.
    // Calling both here retains the original click's activation for mobile browsers.
    const ready = this.init();
    const playback = this.audio.play();
    try {
      await Promise.all([ready, playback]);
    } catch (error) {
      // A superseded play() rejection must never interrupt a newer track.
      if (token === this.playbackToken) this.audio.pause();
      throw error;
    }
  }

  pause(): void {
    this.playbackToken++;
    this.audio.pause();
  }

  stop(): void {
    this.playbackToken++;
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      /* No seekable media loaded yet. */
    }
  }

  load(url: string): void {
    if (this.disposed) throw new Error("The audio engine has been closed.");
    this.playbackToken++;
    this.audio.pause();
    this.audio.src = url;
    this.audio.load();
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    this.updateParam(this.output?.gain, this.muted ? 0 : this.volume);
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.audio.muted = value;
    this.updateParam(this.output?.gain, value ? 0 : this.volume);
  }

  setEQ(gains: number[], preamp: number, enabled: boolean): void {
    this.gains = EQ_FREQUENCIES.map((_, index) =>
      clamp(gains[index] ?? 0, -12, 12),
    );
    this.preampDB = clamp(preamp, -12, 12);
    this.eqEnabled = enabled;
    this.updateParam(
      this.preamp?.gain,
      enabled ? decibelsToGain(this.preampDB) : 1,
    );
    this.filters.forEach((filter, index) =>
      this.updateParam(filter.gain, enabled ? this.gains[index] : 0),
    );
  }

  setBalance(value: number): void {
    this.balance = clamp(value, -1, 1);
    this.updateParam(this.panner?.pan, this.balance);
  }

  setEcho(value: number): void {
    this.echo = clamp(value, 0, 1);
    this.updateParam(this.dry?.gain, 1 - this.echo * 0.2);
    this.updateParam(this.wet?.gain, this.echo * 0.55);
  }

  private updateParam(
    param: AudioParam | undefined,
    value: number,
    immediate = false,
  ): void {
    if (!param || !this.context) return;
    if (immediate) {
      param.value = value;
      return;
    }
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, 0.015);
  }

  private applySettings(immediate = false): void {
    this.updateParam(
      this.preamp?.gain,
      this.eqEnabled ? decibelsToGain(this.preampDB) : 1,
      immediate,
    );
    this.filters.forEach((filter, index) =>
      this.updateParam(
        filter.gain,
        this.eqEnabled ? this.gains[index] : 0,
        immediate,
      ),
    );
    this.updateParam(this.panner?.pan, this.balance, immediate);
    this.updateParam(this.dry?.gain, 1 - this.echo * 0.2, immediate);
    this.updateParam(this.wet?.gain, this.echo * 0.55, immediate);
    this.updateParam(
      this.output?.gain,
      this.muted ? 0 : this.volume,
      immediate,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playbackToken++;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    this.nodes = [];
    this.filters = [];
    this.analyser = undefined;
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
  }
}

interface DemoScore {
  title: string;
  duration: number;
  bpm: number;
  root: number;
  seed: number;
  chords: number[][];
  melody: number[];
}

const DEMO_SCORES: DemoScore[] = [
  {
    title: "Midnight Circuit",
    duration: 42,
    bpm: 82,
    root: 45,
    seed: 1701,
    chords: [
      [0, 3, 7, 10],
      [5, 8, 12, 15],
      [3, 7, 10, 14],
      [7, 10, 14, 17],
    ],
    melody: [12, 19, 15, 22, 19, 15, 10, 15],
  },
  {
    title: "Soft Focus",
    duration: 48,
    bpm: 72,
    root: 48,
    seed: 2402,
    chords: [
      [0, 4, 7, 11],
      [5, 9, 12, 16],
      [2, 5, 9, 12],
      [7, 11, 14, 17],
    ],
    melody: [19, 16, 12, 16, 21, 19, 16, 14],
  },
  {
    title: "Afterglow",
    duration: 54,
    bpm: 88,
    root: 43,
    seed: 3203,
    chords: [
      [0, 4, 7, 11],
      [9, 12, 16, 19],
      [5, 9, 12, 16],
      [7, 11, 14, 17],
    ],
    melody: [12, 16, 19, 23, 21, 19, 16, 14],
  },
];

const TAU = Math.PI * 2;
const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
// A wavetable avoids millions of trigonometric calls during initial demo creation.
const SINE_TABLE_SIZE = 16384;
const SINE_TABLE = Float32Array.from({ length: SINE_TABLE_SIZE }, (_, index) =>
  Math.sin((TAU * index) / SINE_TABLE_SIZE),
);
const sine = (cycles: number) =>
  SINE_TABLE[(cycles * SINE_TABLE_SIZE) & (SINE_TABLE_SIZE - 1)];

/** Original procedural compositions. No downloads, sample packs, or third-party music. */
export function createDemoWav(scoreIndex: number): Blob {
  const score = DEMO_SCORES[scoreIndex];
  if (!score) throw new RangeError("Unknown demo track.");
  const sampleRate = 22050;
  const frames = sampleRate * score.duration;
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, frames * 4, true);

  const beatLength = 60 / score.bpm;
  const barLength = beatLength * 4;
  const chordLength = barLength * 2;
  const chordFrequencies = score.chords.map((chord) =>
    chord.map((note) => frequency(score.root + note)),
  );
  const bassFrequencies = score.chords.map((chord) =>
    frequency(score.root + chord[0] - 12),
  );
  const melodyFrequencies = score.melody.map((note) =>
    frequency(score.root + note + 12),
  );
  const melodyPans = score.melody.map(
    (_, index) => Math.sin(index * 1.7) * 0.3,
  );
  let noiseSeed = score.seed;
  let noiseLowpass = 0;
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / sampleRate;
    const chordPosition = t / chordLength;
    const chordIndex = Math.floor(chordPosition) % score.chords.length;
    const chordAge = t % chordLength;
    const chordEnvelope =
      Math.min(1, chordAge / 1.5) * Math.min(1, (chordLength - chordAge) / 1.5);
    const tones = chordFrequencies[chordIndex];
    let left = 0;
    let right = 0;
    for (let note = 0; note < tones.length; note++) {
      const hz = tones[note];
      const body = sine(hz * t) + 0.2 * sine(hz * 2 * t);
      const airLeft = sine(hz * 1.0017 * t + note / TAU);
      const airRight = sine(hz * 0.9983 * t + note / TAU);
      left += (body + airLeft * 0.35) * 0.046 * chordEnvelope;
      right += (body + airRight * 0.35) * 0.046 * chordEnvelope;
    }
    const beat = Math.floor(t / beatLength);
    const beatAge = t % beatLength;
    const bass =
      sine(bassFrequencies[chordIndex] * t) *
      0.16 *
      Math.min(1, beatAge / 0.02) *
      Math.exp(-beatAge * 2.5);
    const kick =
      sine(48 * beatAge + (70 * (1 - Math.exp(-beatAge * 30))) / 30) *
      Math.exp(-beatAge * 18) *
      (beat % 4 === 0 || beat % 4 === 2 ? 0.25 : 0.07);
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) | 0;
    const noise = noiseSeed / 2147483648;
    noiseLowpass += 0.06 * (noise - noiseLowpass);
    const hatAge = t % (beatLength / 2);
    const hat = (noise - noiseLowpass) * Math.exp(-hatAge * 100) * 0.025;
    const snare =
      beat % 4 === 1 || beat % 4 === 3
        ? noiseLowpass * Math.exp(-beatAge * 25) * 0.12
        : 0;
    const melodyStep =
      Math.floor(t / (beatLength * 2)) % melodyFrequencies.length;
    const melodyAge = t % (beatLength * 2);
    const melodyEnvelope =
      Math.min(1, melodyAge / 0.012) * Math.exp(-melodyAge * 2.8);
    const melodyHz = melodyFrequencies[melodyStep];
    const pluck =
      (sine(melodyHz * t) + sine(melodyHz * 2 * t) * 0.15) *
      melodyEnvelope *
      0.09;
    const pan = melodyPans[melodyStep];
    const center = bass + kick + hat + snare;
    const fade = Math.min(1, t / 1.6) * Math.min(1, (score.duration - t) / 3);
    left = Math.tanh((left + center + pluck * (1 - pan)) * 1.15) * fade * 0.84;
    right =
      Math.tanh((right + center + pluck * (1 + pan)) * 1.15) * fade * 0.84;
    view.setInt16(44 + frame * 4, Math.round(left * 32767), true);
    view.setInt16(46 + frame * 4, Math.round(right * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Caller owns these object URLs and should revoke them when their playlist is discarded. */
export function createDemoTracks(): Track[] {
  const tracks: Track[] = [];
  try {
    for (let index = 0; index < DEMO_SCORES.length; index++) {
      const score = DEMO_SCORES[index];
      const blob = createDemoWav(index);
      tracks.push({
        id: `demo-${index + 1}`,
        title: score.title,
        artist: "Modern Sessions",
        url: URL.createObjectURL(blob),
        duration: score.duration,
        format: "WAV",
        size: blob.size,
        source: "demo",
      });
    }
    return tracks;
  } catch (error) {
    tracks.forEach((track) => URL.revokeObjectURL(track.url));
    throw error;
  }
}
