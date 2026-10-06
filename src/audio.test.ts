import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, createDemoTracks, createDemoWav } from "./audio";

class MockParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class MockNode {
  gain = new MockParam();
  frequency = new MockParam();
  Q = new MockParam();
  pan = new MockParam();
  delayTime = new MockParam();
  type = "";
  fftSize = 0;
  smoothingTimeConstant = 0;
  minDecibels = 0;
  maxDecibels = 0;
  connections: MockNode[] = [];
  connect = vi.fn((node: MockNode) => {
    this.connections.push(node);
    return node;
  });
  disconnect = vi.fn();
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
    this.nodes.push({ kind, node });
    return node;
  }
  createMediaElementSource = vi.fn(() => this.create("source"));
  createGain = vi.fn(() => this.create("gain"));
  createBiquadFilter = vi.fn(() => this.create("filter"));
  createStereoPanner = vi.fn(() => this.create("panner"));
  createDelay = vi.fn(() => this.create("delay"));
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
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
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

describe("AudioEngine", () => {
  it("creates no audio context until initialized, then reuses it", async () => {
    const engine = new AudioEngine();
    expect(MockContext.instances).toHaveLength(0);
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

  it("connects all ten bands, balance, a genuine feedback delay, and the analyser", async () => {
    const engine = new AudioEngine();
    await engine.init();
    const context = MockContext.instances[0];
    const filters = context.nodes
      .filter(({ kind }) => kind === "filter")
      .map(({ node }) => node);
    expect(filters).toHaveLength(10);
    expect(filters.map((filter) => filter.frequency.value)).toEqual([
      63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
    ]);
    expect(filters.every((filter) => filter.type === "peaking")).toBe(true);
    for (let index = 0; index < 9; index++)
      expect(filters[index].connections).toContain(filters[index + 1]);
    const delay = context.nodes.find(({ kind }) => kind === "delay")!.node;
    const panner = context.nodes.find(({ kind }) => kind === "panner")!.node;
    expect(panner.connections).toContain(delay);
    expect(delay.delayTime.value).toBeGreaterThan(0);
    expect(delay.connections).toHaveLength(2);
    expect(
      delay.connections.some((node) => node.connections.includes(delay)),
    ).toBe(true);
    expect((engine.analyser as unknown as MockNode).connections).toContain(
      context.destination,
    );
    engine.dispose();
  });

  it("applies controls set before initialization, and bypasses equalization", async () => {
    const engine = new AudioEngine();
    engine.setEQ([6, -20, 20], -3, true);
    engine.setVolume(0.4);
    engine.setBalance(-0.5);
    engine.setEcho(0.6);
    await engine.init();
    const context = MockContext.instances[0];
    const filters = context.nodes
      .filter(({ kind }) => kind === "filter")
      .map(({ node }) => node);
    const gains = context.nodes
      .filter(({ kind }) => kind === "gain")
      .map(({ node }) => node);
    expect(filters.map((filter) => filter.gain.value)).toEqual([
      6, -12, 12, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(gains[0].gain.value).toBeCloseTo(10 ** (-3 / 20));
    expect(gains[1].gain.value).toBeCloseTo(0.88);
    expect(gains[2].gain.value).toBeCloseTo(0.33);
    expect(gains[4].gain.value).toBeCloseTo(0.4);
    expect(
      context.nodes.find(({ kind }) => kind === "panner")!.node.pan.value,
    ).toBe(-0.5);
    engine.setEQ([6], -3, false);
    expect(filters.every((filter) => filter.gain.value === 0)).toBe(true);
    expect(gains[0].gain.value).toBe(1);
    engine.setMuted(true);
    expect(engine.audio.muted).toBe(true);
    expect(gains[4].gain.value).toBe(0);
    engine.setMuted(false);
    expect(gains[4].gain.value).toBe(0.4);
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

  it("cleans up nodes, media, and its context safely and only once", async () => {
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
    expect(engine.analyser).toBeUndefined();
    await expect(engine.init()).rejects.toThrow("closed");
    await expect(engine.play()).rejects.toThrow("closed");
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
