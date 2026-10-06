import { describe, expect, it } from "vitest";
import { PlaybackSequence } from "./sequencing";

const ids = ["a", "b", "c", "d"];

describe("sequential playback", () => {
  it("advances and stops at the playlist boundary unless repeat is enabled", () => {
    const sequence = new PlaybackSequence();
    sequence.sync(ids, "a", false);
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBe("c");
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBeNull();
    expect(sequence.currentId).toBe("d");
    expect(sequence.next(true)).toBe("a");
    expect(sequence.previous()).toBeNull();
    expect(sequence.previous(true)).toBe("d");
    expect(sequence.previous()).toBe("c");
  });
  it("handles empty and single-item playlists", () => {
    const sequence = new PlaybackSequence();
    sequence.sync([], null, false);
    expect(sequence.next(true)).toBeNull();
    expect(sequence.previous(true)).toBeNull();
    sequence.sync(["only"], "only", false);
    expect(sequence.next()).toBeNull();
    expect(sequence.next(true)).toBe("only");
    expect(sequence.previous()).toBeNull();
    expect(sequence.previous(true)).toBe("only");
  });
  it("starts with the first valid track when no track is selected", () => {
    const sequence = new PlaybackSequence();
    sequence.sync(ids, null, false);
    expect(sequence.next()).toBe("a");
  });
  it("wraps to the final track when going back without a selected track", () => {
    const sequence = new PlaybackSequence();
    sequence.sync(ids, null, false);
    expect(sequence.previous()).toBeNull();
    expect(sequence.previous(true)).toBe("d");
  });
  it("uses the actual order after reordering the playlist", () => {
    const sequence = new PlaybackSequence();
    sequence.sync(ids, "b", false);
    sequence.sync(["c", "a", "b", "d"], "b", false);
    expect(sequence.previous()).toBe("a");
    expect(sequence.next()).toBe("b");
  });
});

describe("shuffle playback cycles and history", () => {
  it("visits every track once before stopping, not just avoiding immediate repeats", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", true);
    const cycle = [
      sequence.currentId,
      sequence.next(),
      sequence.next(),
      sequence.next(),
    ];
    expect(cycle).toEqual(ids);
    expect(new Set(cycle).size).toBe(ids.length);
    expect(sequence.next()).toBeNull();
    expect(sequence.next()).toBeNull();
  });
  it("repeats full cycles without immediately replaying the previous cycle's last track", () => {
    const sequence = new PlaybackSequence(() => 1);
    sequence.sync(ids, "a", true);
    let last = "a";
    const firstCycle = [last];
    for (let i = 1; i < ids.length; i++) {
      last = sequence.next(true)!;
      firstCycle.push(last);
    }
    expect(new Set(firstCycle).size).toBe(ids.length);
    for (let cycle = 0; cycle < 10; cycle++) {
      const current: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const next = sequence.next(true)!;
        expect(next).not.toBe(last);
        current.push(next);
        last = next;
      }
      expect([...current].sort()).toEqual(ids);
    }
  });
  it("goes back through actual history and forwards through the same history", () => {
    const sequence = new PlaybackSequence(() => 1);
    sequence.sync(ids, "a", true);
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBe("c");
    expect(sequence.previous()).toBe("d");
    expect(sequence.previous()).toBe("a");
    expect(sequence.previous(true)).toBeNull();
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBe("c");
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBeNull();
  });
  it("does not duplicate history when UI synchronizes after navigation", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", true);
    const next = sequence.next();
    sequence.sync(ids, next, true);
    expect(sequence.previous()).toBe("a");
    sequence.sync(ids, "a", true);
    expect(sequence.previous()).toBeNull();
    expect(sequence.next()).toBe("b");
  });
  it("records manual selections and drops obsolete forward history", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", true);
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBe("c");
    expect(sequence.previous()).toBe("b");
    sequence.sync(ids, "d", true);
    expect(sequence.previous()).toBe("b");
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBeNull();
  });
  it("consumes replayed history after toggling shuffle so it cannot immediately repeat", () => {
    const sequence = new PlaybackSequence(() => 1);
    sequence.sync(ids, "a", true);
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBe("c");
    expect(sequence.previous()).toBe("d");
    sequence.sync(ids, "d", false);
    sequence.sync(ids, "d", true);
    expect(sequence.next()).toBe("c");
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBe("a");
    expect(sequence.next()).toBeNull();
  });
  it("handles invalid random values and singleton repeat cycles", () => {
    for (const sample of [NaN, Infinity, -Infinity, -1, 0, 1, 2]) {
      const sequence = new PlaybackSequence(() => sample);
      sequence.sync(ids, "a", true);
      const rest = [sequence.next(), sequence.next(), sequence.next()];
      expect([...rest].sort()).toEqual(["b", "c", "d"]);
    }
    const sequence = new PlaybackSequence();
    sequence.sync(["a"], "a", true);
    expect(sequence.next()).toBeNull();
    expect(sequence.next(true)).toBe("a");
    expect(sequence.next()).toBeNull();
  });
  it("restarts the shuffle cycle from the current track when shuffle is enabled", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", false);
    expect(sequence.next()).toBe("b");
    sequence.sync(ids, "b", true);
    expect([sequence.next(), sequence.next(), sequence.next()].sort()).toEqual([
      "a",
      "c",
      "d",
    ]);
    expect(sequence.next()).toBeNull();
  });
});

describe("playlist mutations", () => {
  it("adds newly imported tracks to an unfinished or exhausted shuffle cycle", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(["a", "b"], "a", true);
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBeNull();
    sequence.sync(ids, "b", true);
    expect(sequence.next()).toBe("c");
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBeNull();
  });
  it("prunes deleted tracks from history and the remaining cycle", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", true);
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBe("c");
    sequence.sync(["a", "c"], "c", true);
    expect(sequence.previous()).toBe("a");
    expect(sequence.next()).toBe("c");
    expect(sequence.next()).toBeNull();
  });
  it("reconciles deletion of the selected track and selection of its replacement", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", true);
    expect(sequence.next()).toBe("b");
    sequence.sync(["a", "c", "d"], "c", true);
    expect(sequence.previous()).toBe("a");
    expect(sequence.next()).toBe("c");
    expect(sequence.next()).toBe("d");
    expect(sequence.next()).toBeNull();
  });
  it("clears stale history when the playlist is emptied and reloaded", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(ids, "a", true);
    sequence.next();
    sequence.sync([], null, true);
    expect(sequence.currentId).toBeNull();
    expect(sequence.next(true)).toBeNull();
    sequence.sync(["x", "y"], "x", true);
    expect(sequence.previous()).toBeNull();
    expect(sequence.next()).toBe("y");
    expect(sequence.next()).toBeNull();
  });
  it("deduplicates IDs and ignores empty IDs", () => {
    const sequence = new PlaybackSequence(() => 0);
    sequence.sync(["a", "", "a", "b", "b"], "a", true);
    expect(sequence.next()).toBe("b");
    expect(sequence.next()).toBeNull();
  });
});
