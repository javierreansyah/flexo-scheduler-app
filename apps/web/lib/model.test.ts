import { describe, it, expect } from "vitest";
import {
  advance,
  example,
  importProject,
  initial,
  parameters,
  randomJobs,
} from "./model";
describe("project workflows", () => {
  it("preserves original industry input", () => {
    const p = example();
    expect(p.snapshot.jobs).toHaveLength(15);
    expect(p.snapshot.jobs[0].quantity).toBe(16539);
    expect(importProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it("generates deterministic template quantities", () => {
    const a = randomJobs(100, 42, 2, "new-");
    expect(a).toEqual(randomJobs(100, 42, 2, "new-"));
    expect(a.every((j) => j.arrival_time === 2 && j.quantity >= 1000)).toBe(
      true,
    );
  });
  it("orders effective preset costs", () => {
    for (const n of [10, 30, 50, 100, 500]) {
      expect(parameters(n, "low").evaluations).toBeLessThanOrEqual(
        parameters(n, "medium").evaluations,
      );
      expect(parameters(n, "medium").evaluations).toBeLessThanOrEqual(
        parameters(n, "high").evaluations,
      );
    }
  });
  it("locks setup that has started and preserves old arrivals", () => {
    const p = example();
    const a = {
      ...p.snapshot.jobs[0],
      setup_start: 0,
      start: 0.75,
      completion: 2,
      ink_change_cost: 1,
    };
    const b = {
      ...p.snapshot.jobs[1],
      setup_start: 2,
      start: 2,
      completion: 3,
      ink_change_cost: 0,
    };
    p.history = [
      {
        schedule: { "Flexo A": [a, b] },
        fitness: 1,
        ink_changes: 1,
        batch_flow_time: 3,
        makespan: 3,
        seconds: 0.1,
        parameters: parameters(10),
        seed: "42",
        now: 0,
      },
    ];
    const next = advance(p, 1);
    expect(next.snapshot.locked["Flexo A"]).toEqual([{ ...a, locked: true }]);
    expect(next.snapshot.jobs[0].arrival_time).toBe(0);
    expect(p.snapshot.locked).toEqual({});
    expect(() => advance(next, 0)).toThrow();
  });
  it("rejects malformed and unknown project formats", () => {
    expect(() => importProject({ version: 99 })).toThrow();
    expect(() => importProject({ ...initial(), history: [{}] })).toThrow();
  });
});
