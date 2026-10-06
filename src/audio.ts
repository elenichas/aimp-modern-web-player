import { EQ_FREQUENCIES, type Track } from "./model";

const clamp = (value: number, min: number, max: number, fallback = 0) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const decibelsToGain = (decibels: number) => 10 ** (decibels / 20);
const EQ_Q = 1.05;
const PREVIEW_SAMPLE_RATE = 48000;

export interface AudioEffects {
  /** Each effect is a browser approximation; 0 is dry and 1 is fully wet. */
  echo: number;
  reverb: number;
  chorus: number;
  flanger: number;
  /** Rate multipliers, 0.5..2. Tempo takes priority when both are nonneutral. */
  speed: number;
  tempo: number;
}

type WetEffect = "echo" | "reverb" | "chorus" | "flanger";
interface EffectStage {
  dry: GainNode;
  wet: GainNode;
  output: GainNode;
}

/**
 * Steady-state EQ response in dB, including preamp and bypass. The coefficients
 * match this engine's Web Audio peaking filters, not a measured AIMP response.
 * Before audio initialization the preview assumes 48 kHz.
 * https://www.w3.org/TR/audio-eq-cookbook/
 */
export function calculateEQResponse(
  frequencies: readonly number[],
  gains: readonly number[],
  preamp: number,
  enabled: boolean,
  sampleRate = PREVIEW_SAMPLE_RATE,
): number[] {
  const rate =
    Number.isFinite(sampleRate) && sampleRate > 2
      ? sampleRate
      : PREVIEW_SAMPLE_RATE;
  const coefficients = EQ_FREQUENCIES.map((frequency, index) => {
    const gain = clamp(gains[index] ?? 0, -15, 15);
    const w0 = (2 * Math.PI * Math.min(frequency, rate / 2 - 1)) / rate;
    const a = 10 ** (gain / 40);
    const alpha = Math.sin(w0) / (2 * EQ_Q);
    return {
      gain,
      b0: 1 + alpha * a,
      b1: -2 * Math.cos(w0),
      b2: 1 - alpha * a,
      a0: 1 + alpha / a,
      a2: 1 - alpha / a,
    };
  });
  return frequencies.map((frequency) => {
    if (!Number.isFinite(frequency) || frequency < 0 || frequency > rate / 2)
      return NaN;
    if (!enabled) return 0;
    const w = (2 * Math.PI * frequency) / rate;
    const cos = Math.cos(w),
      sin = Math.sin(w);
    const cos2 = Math.cos(2 * w),
      sin2 = Math.sin(2 * w);
    let db = clamp(preamp, -15, 15);
    for (const { gain, b0, b1, b2, a0, a2 } of coefficients) {
      if (gain === 0) continue;
      const numerator =
        (b0 + b1 * cos + b2 * cos2) ** 2 + (b1 * sin + b2 * sin2) ** 2;
      const denominator =
        (a0 + b1 * cos + a2 * cos2) ** 2 + (b1 * sin + a2 * sin2) ** 2;
      db += 10 * Math.log10(numerator / denominator);
    }
    return db;
  });
}

/** A single media element and a lazily created, gesture-activated Web Audio graph. */
export class AudioEngine {
  readonly audio: HTMLAudioElement;
  analyser?: AnalyserNode;
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private preamp?: GainNode;
  private filters: BiquadFilterNode[] = [];
  private left?: GainNode;
  private right?: GainNode;
  private stages: Partial<Record<WetEffect, EffectStage>> = {};
  private oscillators: OscillatorNode[] = [];
  private output?: GainNode;
  private nodes: AudioNode[] = [];
  private disposed = false;
  private playbackToken = 0;
  private volume = 0.75;
  private muted = false;
  private transportOpen = false;
  private gains = EQ_FREQUENCIES.map(() => 0);
  private preampDB = 0;
  private eqEnabled = true;
  private balance = 0;
  private effects: AudioEffects = {
    echo: 0,
    reverb: 0,
    chorus: 0,
    flanger: 0,
    speed: 1,
    tempo: 1,
  };

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = 1;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? PREVIEW_SAMPLE_RATE;
  }

  /** Whether this browser can explicitly choose pitch-preserving rate changes. */
  get supportsPitchPreservation(): boolean {
    return this.pitchProperty !== undefined;
  }

  private get pitchProperty():
    | "preservesPitch"
    | "mozPreservesPitch"
    | "webkitPreservesPitch"
    | undefined {
    return (
      ["preservesPitch", "mozPreservesPitch", "webkitPreservesPitch"] as const
    ).find((property) => property in this.audio);
  }

  private remember<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  private createStage(
    context: AudioContext,
    upstream: AudioNode,
    wetPath: (input: AudioNode) => AudioNode,
  ): EffectStage {
    const dry = this.remember(context.createGain());
    const wet = this.remember(context.createGain());
    const output = this.remember(context.createGain());
    upstream.connect(dry);
    dry.connect(output);
    wetPath(upstream).connect(wet);
    wet.connect(output);
    return { dry, wet, output };
  }

  private createModulatedDelay(
    context: AudioContext,
    upstream: AudioNode,
    base: number,
    depth: number,
    rate: number,
    feedback = 0,
  ): DelayNode {
    const delay = this.remember(context.createDelay(0.1));
    delay.delayTime.value = base;
    upstream.connect(delay);
    const lfo = this.remember(context.createOscillator());
    const modulation = this.remember(context.createGain());
    lfo.type = "sine";
    lfo.frequency.value = rate;
    modulation.gain.value = depth;
    lfo.connect(modulation);
    modulation.connect(delay.delayTime);
    this.oscillators.push(lfo);
    lfo.start();
    if (feedback) {
      const loop = this.remember(context.createGain());
      loop.gain.value = feedback;
      delay.connect(loop);
      loop.connect(delay);
    }
    return delay;
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
      this.source = this.remember(context.createMediaElementSource(this.audio));
      this.preamp = this.remember(context.createGain());
      // Explicit speaker upmix duplicates mono into L/R before channel splitting.
      this.preamp.channelCount = 2;
      this.preamp.channelCountMode = "explicit";
      this.preamp.channelInterpretation = "speakers";
      this.filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = this.remember(context.createBiquadFilter());
        filter.type = "peaking";
        filter.frequency.value = Math.min(
          frequency,
          context.sampleRate / 2 - 1,
        );
        filter.Q.value = EQ_Q;
        return filter;
      });
      this.source.connect(this.preamp);
      let upstream: AudioNode = this.preamp;
      for (const filter of this.filters) {
        upstream.connect(filter);
        upstream = filter;
      }

      // These are deliberately modest browser DSP approximations. Their native
      // AIMP algorithms, timing and wet/dry laws have not been established.
      this.stages.echo = this.createStage(context, upstream, (input) => {
        const delay = this.remember(context.createDelay(1));
        const feedback = this.remember(context.createGain());
        delay.delayTime.value = 0.285;
        feedback.gain.value = 0.28;
        input.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        return delay;
      });
      this.stages.reverb = this.createStage(
        context,
        this.stages.echo.output,
        (input) => {
          const convolver = this.remember(context.createConvolver());
          const length = Math.round(context.sampleRate * 1.6);
          const impulse = context.createBuffer(2, length, context.sampleRate);
          let seed = 0x41a1;
          for (let channel = 0; channel < 2; channel++) {
            const samples = impulse.getChannelData(channel);
            for (let index = 0; index < length; index++) {
              seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
              samples[index] =
                ((seed / 0x100000000) * 2 - 1) *
                Math.exp((-7 * index) / length) *
                (1 - index / length);
            }
          }
          convolver.buffer = impulse;
          convolver.normalize = true;
          input.connect(convolver);
          return convolver;
        },
      );
      this.stages.chorus = this.createStage(
        context,
        this.stages.reverb.output,
        (input) => {
          const mix = this.remember(context.createGain());
          mix.gain.value = 0.5;
          this.createModulatedDelay(context, input, 0.018, 0.004, 0.8).connect(
            mix,
          );
          this.createModulatedDelay(context, input, 0.026, 0.005, 1.1).connect(
            mix,
          );
          return mix;
        },
      );
      this.stages.flanger = this.createStage(
        context,
        this.stages.chorus.output,
        (input) =>
          this.createModulatedDelay(context, input, 0.005, 0.003, 0.2, 0.3),
      );

      // Balance attenuates an existing channel; it never folds it into the other.
      const splitter = this.remember(context.createChannelSplitter(2));
      const merger = this.remember(context.createChannelMerger(2));
      this.left = this.remember(context.createGain());
      this.right = this.remember(context.createGain());
      this.stages.flanger.output.connect(splitter);
      splitter.connect(this.left, 0);
      splitter.connect(this.right, 1);
      this.left.connect(merger, 0, 0);
      this.right.connect(merger, 0, 1);
      this.output = this.remember(context.createGain());
      this.analyser = this.remember(context.createAnalyser());
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = -85;
      this.analyser.maxDecibels = -20;
      merger.connect(this.output);
      this.output.connect(this.analyser);
      this.analyser.connect(context.destination);
      this.applySettings(true);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  async play(): Promise<void> {
    if (this.disposed) throw new Error("The audio engine has been closed.");
    if (!this.audio.getAttribute("src"))
      throw new Error("Choose a track to start listening.");
    const token = ++this.playbackToken;
    // Both calls retain the original click's activation for mobile browsers.
    const ready = this.init();
    const playback = this.audio.play();
    try {
      await Promise.all([ready, playback]);
      if (token === this.playbackToken) {
        this.transportOpen = true;
        this.updateOutput(true);
      }
    } catch (error) {
      if (token === this.playbackToken) this.pause();
      throw error;
    }
  }

  pause(): void {
    this.playbackToken++;
    this.audio.pause();
    this.transportOpen = false;
    // Cut effect tails while paused/stopped. Wet buffers are not cleared; a very
    // quick resume or track switch may retain a short residual effect tail.
    this.updateOutput(true);
  }

  stop(): void {
    this.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      /* No seekable media loaded yet. */
    }
  }

  load(url: string): void {
    if (this.disposed) throw new Error("The audio engine has been closed.");
    this.pause();
    this.audio.src = url;
    this.audio.load();
    // load() can reset playbackRate to defaultPlaybackRate in media elements.
    this.applyPlaybackRate();
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    this.updateOutput();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.audio.muted = value;
    this.updateOutput(value);
  }

  setEQ(gains: number[], preamp: number, enabled: boolean): void {
    this.gains = EQ_FREQUENCIES.map((_, index) =>
      clamp(gains[index] ?? 0, -15, 15),
    );
    this.preampDB = clamp(preamp, -15, 15);
    this.eqEnabled = enabled;
    this.updateParam(
      this.preamp?.gain,
      enabled ? decibelsToGain(this.preampDB) : 1,
    );
    this.filters.forEach((filter, index) =>
      this.updateParam(filter.gain, enabled ? this.gains[index] : 0),
    );
  }

  /** Live browser filter response; excludes balance, volume and time-varying DSP. */
  getFrequencyResponse(frequencies: readonly number[]): number[] {
    if (!this.context || !this.preamp || !this.filters.length)
      return calculateEQResponse(
        frequencies,
        this.gains,
        this.preampDB,
        this.eqEnabled,
        this.sampleRate,
      );
    if (!this.eqEnabled)
      return frequencies.map((frequency) =>
        Number.isFinite(frequency) &&
        frequency >= 0 &&
        frequency <= this.sampleRate / 2
          ? 0
          : NaN,
      );
    const input = new Float32Array(frequencies);
    const magnitude = new Float32Array(input.length);
    const phase = new Float32Array(input.length);
    const response = frequencies.map(
      () => 20 * Math.log10(this.preamp!.gain.value),
    );
    for (const filter of this.filters) {
      filter.getFrequencyResponse(input, magnitude, phase);
      for (let index = 0; index < response.length; index++)
        response[index] += 20 * Math.log10(magnitude[index]);
    }
    return response;
  }

  setBalance(value: number): void {
    this.balance = clamp(value, -1, 1);
    this.updateParam(this.left?.gain, 1 - Math.max(0, this.balance));
    this.updateParam(this.right?.gain, 1 + Math.min(0, this.balance));
  }

  setEcho(value: number): void {
    this.setEffects({ echo: value });
  }

  setEffects(values: Partial<AudioEffects>): void {
    for (const effect of ["echo", "reverb", "chorus", "flanger"] as const) {
      if (values[effect] !== undefined)
        this.effects[effect] = clamp(values[effect], 0, 1);
      this.updateParam(this.stages[effect]?.dry.gain, 1 - this.effects[effect]);
      this.updateParam(this.stages[effect]?.wet.gain, this.effects[effect]);
    }
    if (values.speed !== undefined)
      this.effects.speed = clamp(values.speed, 0.5, 2, 1);
    if (values.tempo !== undefined)
      this.effects.tempo = clamp(values.tempo, 0.5, 2, 1);
    this.applyPlaybackRate();
  }

  private applyPlaybackRate(): void {
    // Old saved tempo settings must not silently change pitch on a browser that
    // cannot preserve it. Speed remains a usable browser-controlled rate there.
    const tempoMode =
      this.supportsPitchPreservation && this.effects.tempo !== 1;
    const rate = tempoMode ? this.effects.tempo : this.effects.speed;
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
    const property = this.pitchProperty;
    if (property) {
      const media = this.audio as HTMLAudioElement & {
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      media[property] = tempoMode;
    }
  }

  private updateOutput(immediate = false): void {
    this.updateParam(
      this.output?.gain,
      !this.transportOpen || this.muted ? 0 : this.volume,
      immediate,
    );
  }

  private updateParam(
    param: AudioParam | undefined,
    value: number,
    immediate = false,
  ): void {
    if (!param || !this.context) return;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    if (immediate) {
      // A value assignment alone does not override an in-progress target ramp.
      param.setValueAtTime(value, now);
      return;
    }
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
    this.updateParam(this.left?.gain, 1 - Math.max(0, this.balance), immediate);
    this.updateParam(
      this.right?.gain,
      1 + Math.min(0, this.balance),
      immediate,
    );
    for (const effect of ["echo", "reverb", "chorus", "flanger"] as const) {
      this.updateParam(
        this.stages[effect]?.dry.gain,
        1 - this.effects[effect],
        immediate,
      );
      this.updateParam(
        this.stages[effect]?.wet.gain,
        this.effects[effect],
        immediate,
      );
    }
    this.updateOutput(immediate);
    this.applyPlaybackRate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playbackToken++;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    for (const oscillator of this.oscillators) {
      try {
        oscillator.stop();
      } catch {
        /* Already stopped. */
      }
    }
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    this.nodes = [];
    this.filters = [];
    this.stages = {};
    this.oscillators = [];
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
