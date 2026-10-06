import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioEngine,
  calculateEQResponse,
  createDemoTracks,
  createDemoWav,
} from "./audio";
import { EQ_FREQUENCIES } from "./model";

class MockParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class MockNode {
  gain = new MockParam();
  frequency = new MockParam();
  Q = new MockParam();
  delayTime = new MockParam();
  type = "";
  fftSize = 0;
  smoothingTimeConstant = 0;
  minDecibels = 0;
  maxDecibels = 0;
  channelCount = 2;
  channelCountMode = "max";
  channelInterpretation = "speakers";
  buffer?: MockBuffer;
  normalize = false;
  connections: MockNode[] = [];
  connect = vi.fn((node: MockNode, _output?: number, _input?: number) => {
    this.connections.push(node);
    return node;
  });
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  // Tests verify delegation and multiplication, not actual rendered browser DSP.
  getFrequencyResponse = vi.fn(
    (_input: Float32Array, magnitude: Float32Array, phase: Float32Array) => {
      magnitude.fill(10 ** (this.gain.value / 20));
      phase.fill(0);
    },
  );
}

class MockBuffer {
  channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }
  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class MockContext {
  static instances: MockContext[] = [];
  currentTime = 10;
  sampleRate = 48000;
  state = "suspended";
  destination = new MockNode();
  nodes: { kind: string; node: MockNode }[] = [];
  constructor() {
    MockContext.instances.push(this);
  }
  private create(kind: string) {
    const node = new MockNode();
    if (kind === "gain") node.gain.value = 1;
    this.nodes.push({ kind, node });
    return node;
  }
  createMediaElementSource = vi.fn(() => this.create("source"));
  createGain = vi.fn(() => this.create("gain"));
  createBiquadFilter = vi.fn(() => this.create("filter"));
  createChannelSplitter = vi.fn(() => this.create("splitter"));
  createChannelMerger = vi.fn(() => this.create("merger"));
  createDelay = vi.fn(() => this.create("delay"));
  createConvolver = vi.fn(() => this.create("convolver"));
  createOscillator = vi.fn(() => this.create("oscillator"));
  createBuffer = vi.fn(
    (channels: number, length: number, rate: number) =>
      new MockBuffer(channels, length, rate),
  );
  createAnalyser = vi.fn(() => this.create("analyser"));
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

class MockAudio {
  src = "";
  preload = "";
  crossOrigin = "";
  volume = 1;
  muted = false;
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn(() => {
    this.playbackRate = this.defaultPlaybackRate;
  });
  getAttribute(name: string) {
    return name === "src" ? this.src || null : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

beforeEach(() => {
  MockContext.instances = [];
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("AudioContext", MockContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const kind = (context: MockContext, type: string) =>
  context.nodes.filter(({ kind }) => kind === type).map(({ node }) => node);
const effects = (context: MockContext) => {
  let upstream = kind(context, "filter").at(-1)!;
  return ["echo", "reverb", "chorus", "flanger"].map((name) => {
    const dry = upstream.connections[0];
    const output = dry.connections[0];
    const wet = kind(context, "gain").find(
      (node) => node !== dry && node.connections.includes(output),
    )!;
    upstream = output;
    return { name, dry, wet, output };
  });
};

describe("AudioEngine", () => {
  it("creates no audio context until initialized, then reuses it", async () => {
    const engine = new AudioEngine();
    expect(MockContext.instances).toHaveLength(0);
    expect(engine.sampleRate).toBe(48000);
    await engine.init();
    await engine.init();
    expect(MockContext.instances).toHaveLength(1);
    expect(MockContext.instances[0].resume).toHaveBeenCalledOnce();
    expect(
      MockContext.instances[0].createMediaElementSource,
    ).toHaveBeenCalledOnce();
    expect(engine.analyser).toBeDefined();
    engine.dispose();
  });

  it("connects every EQ band and four effect stages before channel balance and analyser", async () => {
    const engine = new AudioEngine();
    await engine.init();
    const context = MockContext.instances[0];
    const filters = kind(context, "filter");
    expect(filters).toHaveLength(18);
    expect(filters.map((filter) => filter.frequency.value)).toEqual([
      ...EQ_FREQUENCIES,
    ]);
    expect(
      filters.every(
        (filter) => filter.type === "peaking" && filter.Q.value === 1.05,
      ),
    ).toBe(true);
    for (let index = 0; index < filters.length - 1; index++)
      expect(filters[index].connections).toContain(filters[index + 1]);
    const delay = kind(context, "delay")[0];
    expect(delay.delayTime.value).toBe(0.285);
    expect(delay.connections).toHaveLength(2);
    const feedback = delay.connections.find((node) =>
      node.connections.includes(delay),
    )!;
    expect(feedback.gain.value).toBe(0.28);
    const stages = effects(context);
    expect(
      stages.every(
        ({ dry, wet }) => dry.gain.value === 1 && wet.gain.value === 0,
      ),
    ).toBe(true);
    const splitter = kind(context, "splitter")[0];
    const merger = kind(context, "merger")[0];
    expect(stages[3].output.connections).toEqual([splitter]);
    expect(splitter.connect).toHaveBeenCalledWith(splitter.connections[0], 0);
    expect(splitter.connect).toHaveBeenCalledWith(splitter.connections[1], 1);
    expect(splitter.connections[0].connect).toHaveBeenCalledWith(merger, 0, 0);
    expect(splitter.connections[1].connect).toHaveBeenCalledWith(merger, 0, 1);
    expect((engine.analyser as unknown as MockNode).connections).toContain(
      context.destination,
    );
    engine.dispose();
  });

  it("upmixes mono before independent balance attenuation without crossfeed", async () => {
    const engine = new AudioEngine();
    engine.setBalance(-0.5);
    await engine.init();
    const context = MockContext.instances[0];
    const preamp = kind(context, "source")[0].connections[0];
    expect(preamp.channelCount).toBe(2);
    expect(preamp.channelCountMode).toBe("explicit");
    expect(preamp.channelInterpretation).toBe("speakers");
    const [left, right] = kind(context, "splitter")[0].connections;
    expect([left.gain.value, right.gain.value]).toEqual([1, 0.5]);
    engine.setBalance(1);
    expect([left.gain.value, right.gain.value]).toEqual([0, 1]);
    engine.setBalance(-1);
    expect([left.gain.value, right.gain.value]).toEqual([1, 0]);
    engine.setBalance(0);
    expect([left.gain.value, right.gain.value]).toEqual([1, 1]);
    engine.setBalance(NaN);
    expect([left.gain.value, right.gain.value]).toEqual([1, 1]);
    engine.dispose();
  });

  it("applies pre-init settings, clamps to ±15dB, and bypasses EQ without disabling DSP", async () => {
    const engine = new AudioEngine();
    engine.setEQ([6, -20, 20], -3, true);
    engine.setVolume(0.4);
    engine.setEffects({ echo: 0.6, reverb: 0.2, chorus: 0.3, flanger: 0.4 });
    await engine.init();
    const context = MockContext.instances[0];
    const filters = kind(context, "filter");
    expect(filters.map((filter) => filter.gain.value)).toEqual([
      6,
      -15,
      15,
      ...Array(EQ_FREQUENCIES.length - 3).fill(0),
    ]);
    const preamp = kind(context, "source")[0].connections[0];
    const output = kind(context, "merger")[0].connections[0];
    expect(preamp.gain.value).toBeCloseTo(10 ** (-3 / 20));
    expect(effects(context).map(({ wet }) => wet.gain.value)).toEqual([
      0.6, 0.2, 0.3, 0.4,
    ]);
    expect(output.gain.value).toBe(0);
    engine.load("blob:demo");
    await engine.play();
    expect(output.gain.value).toBe(0.4);
    engine.setEQ([6], -3, false);
    expect(filters.every((filter) => filter.gain.value === 0)).toBe(true);
    expect(preamp.gain.value).toBe(1);
    expect(effects(context)[0].wet.gain.value).toBe(0.6);
    engine.setEQ([], 90, true);
    expect(preamp.gain.value).toBeCloseTo(10 ** (15 / 20));
    engine.setMuted(true);
    expect(engine.audio.muted).toBe(true);
    expect(output.gain.value).toBe(0);
    engine.setMuted(false);
    expect(output.gain.value).toBe(0.4);
    engine.dispose();
  });

  it("uses actual dry/wet endpoints for every effect and preserves unspecified settings", async () => {
    const engine = new AudioEngine();
    await engine.init();
    const stages = effects(MockContext.instances[0]);
    engine.setEffects({ echo: 1, reverb: 1, chorus: 1, flanger: 1 });
    for (const { dry, wet } of stages) {
      expect(dry.gain.value).toBe(0);
      expect(wet.gain.value).toBe(1);
    }
    engine.setEcho(0.4);
    expect(stages[0].dry.gain.value).toBe(0.6);
    expect(stages[0].wet.gain.value).toBe(0.4);
    expect(stages[1].wet.gain.value).toBe(1);
    engine.setEffects({ echo: -2, reverb: NaN, chorus: 0, flanger: 0 });
    for (const { dry, wet } of stages) {
      expect(dry.gain.value).toBe(1);
      expect(wet.gain.value).toBe(0);
    }
    engine.dispose();
  });

  it("creates a finite decaying stereo reverb impulse and bounded modulated delays", async () => {
    const engine = new AudioEngine();
    await engine.init();
    const context = MockContext.instances[0];
    const convolver = kind(context, "convolver")[0];
    expect(convolver.normalize).toBe(true);
    const impulse = convolver.buffer!;
    expect(impulse.numberOfChannels).toBe(2);
    expect(impulse.length).toBe(48000 * 1.6);
    for (const samples of impulse.channels) {
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(Math.abs(samples.at(-1)!)).toBeLessThan(1e-7);
      expect(samples.some((sample) => Math.abs(sample) > 0.1)).toBe(true);
    }
    expect(impulse.channels[0][1]).not.toBe(impulse.channels[1][1]);
    const delays = kind(context, "delay").slice(1);
    const oscillators = kind(context, "oscillator");
    expect(oscillators).toHaveLength(3);
    oscillators.forEach((lfo, index) => {
      expect(lfo.start).toHaveBeenCalledOnce();
      const modulation = lfo.connections[0];
      expect(modulation.connections).toContain(delays[index].delayTime);
      expect(
        delays[index].delayTime.value - modulation.gain.value,
      ).toBeGreaterThan(0);
      expect(
        delays[index].delayTime.value + modulation.gain.value,
      ).toBeLessThan(0.1);
    });
    engine.dispose();
  });

  it("applies mutually exclusive speed/tempo modes and preserves the rate on load", async () => {
    const engine = new AudioEngine();
    expect(engine.supportsPitchPreservation).toBe(true);
    engine.setEffects({ speed: 1.5 });
    expect(engine.audio.playbackRate).toBe(1.5);
    expect(engine.audio.preservesPitch).toBe(false);
    engine.setEffects({ tempo: 0.75 });
    expect(engine.audio.playbackRate).toBe(0.75);
    expect(engine.audio.preservesPitch).toBe(true);
    engine.load("blob:demo");
    expect(engine.audio.playbackRate).toBe(0.75);
    expect(engine.audio.defaultPlaybackRate).toBe(0.75);
    engine.setEffects({ tempo: 1, speed: 100 });
    expect(engine.audio.playbackRate).toBe(2);
    expect(engine.audio.preservesPitch).toBe(false);
    engine.setEffects({ speed: NaN, tempo: Infinity });
    expect(engine.audio.playbackRate).toBe(1);
    engine.dispose();
  });

  it("detects missing or prefixed pitch-preservation controls", () => {
    const engine = new AudioEngine();
    const audio = engine.audio as unknown as {
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    delete audio.preservesPitch;
    expect(engine.supportsPitchPreservation).toBe(false);
    engine.setEffects({ tempo: 1.2 });
    expect(engine.audio.playbackRate).toBe(1);
    engine.setEffects({ speed: 0.8 });
    expect(engine.audio.playbackRate).toBe(0.8);
    audio.webkitPreservesPitch = false;
    expect(engine.supportsPitchPreservation).toBe(true);
    engine.setEffects({ tempo: 1.2 });
    expect(audio.webkitPreservesPitch).toBe(true);
    engine.dispose();
  });

  it("delegates live response to every Biquad and includes preamp, then returns flat bypass", async () => {
    const engine = new AudioEngine();
    const frequencies = [63, 1000, 16000];
    engine.setEQ([6], -3, true);
    expect(engine.getFrequencyResponse(frequencies)).toEqual(
      calculateEQResponse(frequencies, [6], -3, true),
    );
    expect(MockContext.instances).toHaveLength(0);
    await engine.init();
    const filters = kind(MockContext.instances[0], "filter");
    engine
      .getFrequencyResponse(frequencies)
      .forEach((db) => expect(db).toBeCloseTo(3, 5));
    filters.forEach((filter) =>
      expect(filter.getFrequencyResponse).toHaveBeenCalledOnce(),
    );
    engine.setEQ([6], -3, false);
    expect(engine.getFrequencyResponse(frequencies)).toEqual([0, 0, 0]);
    expect(
      engine.getFrequencyResponse([-1, Infinity, 25000]).every(Number.isNaN),
    ).toBe(true);
    engine.dispose();
  });

  it("loads, plays, pauses, and stops the same media element", async () => {
    const engine = new AudioEngine();
    await expect(engine.play()).rejects.toThrow("Choose a track");
    engine.load("blob:demo");
    await engine.play();
    expect(engine.audio.paused).toBe(false);
    engine.audio.currentTime = 15;
    engine.pause();
    expect(engine.audio.paused).toBe(true);
    expect(engine.audio.currentTime).toBe(15);
    engine.stop();
    expect(engine.audio.currentTime).toBe(0);
    engine.dispose();
  });

  it("silences all effect tails on pause, stop and load, including volume changes while paused", async () => {
    const engine = new AudioEngine();
    engine.setEffects({ echo: 1, reverb: 1 });
    engine.load("blob:first");
    await engine.play();
    const output = kind(MockContext.instances[0], "merger")[0].connections[0];
    expect(output.gain.value).toBe(0.75);
    engine.setVolume(0.9);
    engine.pause();
    expect(output.gain.value).toBe(0);
    expect(output.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
    expect(output.gain.cancelScheduledValues).toHaveBeenLastCalledWith(10);
    engine.setVolume(0.6);
    engine.setMuted(true);
    engine.setMuted(false);
    expect(output.gain.value).toBe(0);
    await engine.play();
    expect(output.gain.value).toBe(0.6);
    engine.stop();
    expect(output.gain.value).toBe(0);
    await engine.play();
    engine.load("blob:second");
    expect(output.gain.value).toBe(0);
    await engine.play();
    expect(output.gain.value).toBe(0.6);
    engine.dispose();
  });

  it("does not reopen output when an old play promise resolves after pause", async () => {
    const engine = new AudioEngine();
    engine.load("blob:first");
    let resolvePlayback: () => void = () => {};
    vi.mocked(engine.audio.play).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlayback = resolve;
        }),
    );
    const playback = engine.play();
    engine.pause();
    resolvePlayback();
    await playback;
    const output = kind(MockContext.instances[0], "merger")[0].connections[0];
    expect(output.gain.value).toBe(0);
    engine.dispose();
  });

  it("does not let an old interrupted play request pause a newer track", async () => {
    const engine = new AudioEngine();
    engine.load("blob:first");
    let rejectFirst: (reason: Error) => void = () => {};
    vi.mocked(engine.audio.play).mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectFirst = reject;
        }),
    );
    const first = engine.play();
    const firstResult = expect(first).rejects.toThrow("Interrupted");
    engine.load("blob:second");
    await engine.play();
    rejectFirst(new Error("Interrupted"));
    await firstResult;
    expect(engine.audio.paused).toBe(false);
    engine.dispose();
  });

  it("cleans up nodes, LFOs, media, and its context safely and only once", async () => {
    const engine = new AudioEngine();
    engine.load("blob:demo");
    await engine.init();
    const context = MockContext.instances[0];
    engine.dispose();
    engine.dispose();
    expect(engine.audio.getAttribute("src")).toBeNull();
    expect(context.close).toHaveBeenCalledOnce();
    expect(
      context.nodes.every(
        ({ node }) => node.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
    kind(context, "oscillator").forEach((lfo) =>
      expect(lfo.stop).toHaveBeenCalledOnce(),
    );
    expect(engine.analyser).toBeUndefined();
    await expect(engine.init()).rejects.toThrow("closed");
    await expect(engine.play()).rejects.toThrow("closed");
  });
});

describe("analytical EQ response", () => {
  it("is flat with unity filters and includes preamp unless bypassed", () => {
    const frequencies = [20, 63, 700, 1000, 16000, 20000];
    expect(calculateEQResponse(frequencies, [], 0, true)).toEqual(
      Array(6).fill(0),
    );
    expect(calculateEQResponse(frequencies, [], -9, true)).toEqual(
      Array(6).fill(-9),
    );
    expect(calculateEQResponse(frequencies, [12, -7, 5], 8, false)).toEqual(
      Array(6).fill(0),
    );
  });

  it("reaches the requested gain at each band's center and sums preamp", () => {
    EQ_FREQUENCIES.forEach((frequency, band) => {
      const gains = EQ_FREQUENCIES.map((_, index) => (index === band ? 12 : 0));
      expect(calculateEQResponse([frequency], gains, -3, true)[0]).toBeCloseTo(
        9,
        6,
      );
    });
  });

  it("combines interacting filters rather than joining slider values", () => {
    const gains = EQ_FREQUENCIES.map((_, index) => (index < 2 ? 6 : 0));
    const response = calculateEQResponse(
      [EQ_FREQUENCIES[0], 0, 24000],
      gains,
      0,
      true,
    );
    expect(response[0]).toBeGreaterThan(6);
    expect(response[1]).toBeCloseTo(0, 7);
    expect(response[2]).toBeCloseTo(0, 7);
    const inverted = calculateEQResponse(
      [EQ_FREQUENCIES[0]],
      gains.map((gain) => -gain),
      0,
      true,
    );
    expect(inverted[0]).toBeCloseTo(-response[0], 7);
  });

  it("honors sample rate and handles bounds consistently", () => {
    const gains = EQ_FREQUENCIES.map((_, index) =>
      index === EQ_FREQUENCIES.length - 1 ? 15 : 0,
    );
    expect(calculateEQResponse([11024], gains, 0, true, 22050)[0]).toBeCloseTo(
      15,
      5,
    );
    expect(
      calculateEQResponse([-1, NaN, 11026], gains, 0, true, 22050).every(
        Number.isNaN,
      ),
    ).toBe(true);
    expect(calculateEQResponse([1000], [], 100, true)).toEqual([15]);
    expect(calculateEQResponse([1000], [NaN], NaN, true)).toEqual([0]);
  });
});

describe("original demo audio", () => {
  it("creates a correctly sized stereo PCM WAV containing unclipped, audible music", async () => {
    const blob = createDemoWav(0);
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    const decoder = new TextDecoder();
    expect(blob.type).toBe("audio/wav");
    expect(decoder.decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(decoder.decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(40, true) / view.getUint32(28, true)).toBe(42);
    expect(bytes.byteLength).toBe(44 + 42 * 22050 * 4);
    let peak = 0;
    let energy = 0;
    let stereoDifference = 0;
    for (let offset = 44; offset < bytes.byteLength; offset += 4) {
      const left = view.getInt16(offset, true);
      const right = view.getInt16(offset + 2, true);
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      energy += left * left + right * right;
      stereoDifference += Math.abs(left - right);
    }
    expect(peak).toBeGreaterThan(1000);
    expect(peak).toBeLessThan(32767);
    expect(energy).toBeGreaterThan(0);
    expect(stereoDifference).toBeGreaterThan(100000);
  });

  it("provides three unique tracks with accurate metadata and locally generated URLs", () => {
    const url = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementationOnce(() => "blob:one")
      .mockImplementationOnce(() => "blob:two")
      .mockImplementationOnce(() => "blob:three");
    const tracks = createDemoTracks();
    expect(tracks.map((track) => track.title)).toEqual([
      "Midnight Circuit",
      "Soft Focus",
      "Afterglow",
    ]);
    expect(tracks.map((track) => track.duration)).toEqual([42, 48, 54]);
    expect(
      tracks.every(
        (track) =>
          track.artist === "Modern Sessions" &&
          track.source === "demo" &&
          track.format === "WAV",
      ),
    ).toBe(true);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(3);
    expect(new Set(tracks.map((track) => track.url)).size).toBe(3);
    for (const track of tracks)
      expect(track.size).toBe(44 + track.duration * 22050 * 4);
    expect(url).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid composition indexes", () => {
    expect(() => createDemoWav(-1)).toThrow("Unknown demo");
    expect(() => createDemoWav(3)).toThrow("Unknown demo");
  });
});
