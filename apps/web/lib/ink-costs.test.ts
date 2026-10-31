import { describe, it, expect } from "vitest";
import {
  industryInkCost,
  inkCostMatrix,
  inkLabels,
  isIndustryInkMatrix,
} from "./ink-costs";
import { initial } from "./model";
describe("industry ink matrix", () => {
  it("matches directed darkness, addition and removal rules", () => {
    for (const a of ["empty", "1", "6", "9"])
      for (const b of ["empty", "1", "6", "9"])
        expect(industryInkCost(a, b)).toBe(
          Number(Number(a === "empty" ? 0 : a) > Number(b === "empty" ? 0 : b)),
        );
    expect(industryInkCost("9", "1")).toBe(1);
    expect(industryInkCost("1", "9")).toBe(0);
  });
  it("seeds projects with an explicit industry matrix", () => {
    const p = initial();
    expect(p.snapshot.ink_costs?.["9"]["1"]).toBe(1);
    expect(isIndustryInkMatrix(p.snapshot.ink_costs)).toBe(true);
    expect(inkLabels(p.snapshot)).toEqual([
      "empty",
      "1",
      "2",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
  });
  it("extends catalog preserving custom directed costs", () => {
    const old = inkCostMatrix(["empty", "1", "9"]);
    old["9"]["1"] = 2.5;
    const p = initial();
    p.snapshot.ink_costs = old;
    p.snapshot.jobs = [
      { id: "new", quantity: 1000, inks: [12], arrival_time: 0 },
    ];
    const matrix = inkCostMatrix(inkLabels(p.snapshot), old);
    expect(matrix["9"]["1"]).toBe(2.5);
    expect(matrix["1"]["9"]).toBe(0);
    expect(matrix["12"]["1"]).toBe(1);
    expect(matrix.empty["12"]).toBe(0);
    expect(matrix["12"].empty).toBe(1);
    expect(isIndustryInkMatrix(matrix)).toBe(false);
  });
});
