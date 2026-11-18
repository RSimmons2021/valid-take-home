import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy";

describe("command palette matching", () => {
  it("matches subsequences and rejects non-matches", () => {
    expect(fuzzyScore("exp", "Export plan")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Export plan")).toBe(-1);
  });

  it("ranks word starts and runs above scattered hits", () => {
    expect(fuzzyScore("lp", "Pin 3: Lincoln Park, Chicago")).toBeGreaterThan(fuzzyScore("lp", "Learn from results: help"));
    expect(fuzzyScore("den", "Go to Denver")).toBeGreaterThan(fuzzyScore("den", "Describe your business (AI)"));
  });

  it("treats an empty query as a neutral match", () => {
    expect(fuzzyScore("  ", "Anything")).toBe(0);
  });
});
