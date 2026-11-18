import { describe, expect, it } from "vitest";
import { arrow, edgeToward, rng, scribble, smooth } from "./sketch";

describe("sketch", () => {
  it("is deterministic for a seed, and varies between seeds", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 200, y: 100 }, 7);
    const b = arrow({ x: 0, y: 0 }, { x: 200, y: 100 }, 7);
    const c = arrow({ x: 0, y: 0 }, { x: 200, y: 100 }, 8);
    expect(a).toEqual(b);
    expect(a.shaft[0]).not.toEqual(c.shaft[0]);
  });

  it("ends the arrow exactly at its target, head included", () => {
    const { shaft, head } = arrow({ x: 10, y: 10 }, { x: 300, y: 120 }, 3);
    for (const d of shaft) expect(d.endsWith("300.0 120.0")).toBe(true);
    expect(head).toContain("L300.0 120.0");
  });

  it("draws a scribble around the rectangle, not through it", () => {
    const rect = { x: 100, y: 100, w: 200, h: 60 };
    const d = scribble(rect, 1);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeLessThan(rect.x);
    expect(Math.max(...xs)).toBeGreaterThan(rect.x + rect.w);
    expect(Math.min(...ys)).toBeLessThan(rect.y);
    expect(Math.max(...ys)).toBeGreaterThan(rect.y + rect.h);
  });

  it("stops arrows at the target's edge, on the side facing the note", () => {
    const rect = { x: 100, y: 100, w: 100, h: 50 };
    const p = edgeToward(rect, { x: 500, y: 125 }, 0);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(125);
  });

  it("produces values in [0, 1)", () => {
    const r = rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("smooths through every point", () => {
    expect(smooth([{ x: 0, y: 0 }])).toBe("");
    expect(smooth([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }]).split("C")).toHaveLength(3);
  });
});
