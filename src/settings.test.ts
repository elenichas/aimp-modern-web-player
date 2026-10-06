import { describe, it, expect } from "vitest";
import { defaults, parseSettings } from "./settings";
describe("persisted settings", () => {
  it("falls back safely for invalid JSON and non-objects", () => {
    for (const raw of ["broken", "null", "5", "[]"])
      expect(parseSettings(raw)).toEqual(defaults);
  });
  it("clamps audio parameter bounds", () => {
    const s = parseSettings('{"volume":4,"echo":-1,"balance":-8,"preamp":99}');
    expect([s.volume, s.echo, s.balance, s.preamp]).toEqual([1, 0, -1, 12]);
  });
  it("rejects wrong types and invalid gains", () => {
    const s = parseSettings(
      '{"volume":"loud","muted":"true","gains":[null,2,"x",99,0,0,0,0,0,0]}',
    );
    expect(s.volume).toBe(defaults.volume);
    expect(s.muted).toBe(false);
    expect(s.gains.slice(0, 4)).toEqual([0, 2, 0, 12]);
  });
  it("preserves valid preferences without sharing mutable arrays", () => {
    const s = parseSettings('{"volume":0.3,"eq":false,"shuffle":true}');
    expect(s.volume).toBe(0.3);
    expect(s.eq).toBe(false);
    expect(s.shuffle).toBe(true);
    s.gains[0] = 12;
    expect(defaults.gains[0]).toBe(0);
  });
});
