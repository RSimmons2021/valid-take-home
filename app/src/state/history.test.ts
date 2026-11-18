import { describe, expect, it } from "vitest";
import { COALESCE_MS, type Stacks, describeChange, record, same, snapshot } from "./history";
import type { PlanState } from "./url";

const base: PlanState = { metroId: "sf-bay", profileId: "pet-care", weights: { homes: 1, pet_life: 2 }, minHomes: 25, pins: 8, radiusMi: 1.5 };
const empty: Stacks = { past: [], future: [], last: null };

describe("plan history", () => {
  it("treats weight objects by value, with 0 equal to absent", () => {
    expect(same(base, { ...base, weights: { pet_life: 2, homes: 1, fitness: 0 } })).toBe(true);
    expect(same(base, { ...base, pins: 9 })).toBe(false);
  });

  it("names the kind of change for the undo toast", () => {
    expect(describeChange(base, { ...base, radiusMi: 2 })).toBe("radius");
    expect(describeChange(base, { ...base, weights: { homes: 2 } })).toBe("weights");
    expect(describeChange(base, { ...base, metroId: "austin", pins: 3 })).toBe("metro");
  });

  it("records a step and clears redo", () => {
    const st = record({ ...empty, future: [base] }, base, { ...base, pins: 9 }, 0);
    expect(st.past).toEqual([snapshot(base)]);
    expect(st.future).toEqual([]);
  });

  it("collapses rapid changes of one kind into a single step", () => {
    let st = record(empty, base, { ...base, pins: 9 }, 0);
    st = record(st, { ...base, pins: 9 }, { ...base, pins: 10 }, COALESCE_MS - 1);
    expect(st.past).toHaveLength(1);
    expect(st.past[0].pins).toBe(8); // undo goes back to before the burst
    st = record(st, { ...base, pins: 10 }, { ...base, pins: 10, radiusMi: 2 }, COALESCE_MS);
    expect(st.past).toHaveLength(2); // a different kind of change is its own step
  });

  it("ignores no-op changes", () => {
    expect(record(empty, base, { ...base }, 0)).toBe(empty);
  });
});
