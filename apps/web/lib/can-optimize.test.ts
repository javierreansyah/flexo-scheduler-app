import { expect, test } from "vitest";
import { canOptimize } from "./can-optimize";
import { example, initial, parameters } from "./model";

test("requires jobs, machines and valid settings before optimization", () => {
  const project = example();
  const params = parameters(project.snapshot.jobs.length);
  expect(canOptimize(project, params)).toBe(true);
  expect(canOptimize(initial(), params)).toBe(false);
  expect(
    canOptimize(
      { ...project, snapshot: { ...project.snapshot, machines: {} } },
      params,
    ),
  ).toBe(false);
  for (const seed of ["", "-1", "1.5", "18446744073709551616"]) {
    expect(canOptimize({ ...project, seed }, params)).toBe(false);
  }
  for (const invalid of [
    { starts: 0 },
    { starts: 21 },
    { evaluations: 1.5 },
    { t_min: -1 },
    { p_shift: 2 },
  ]) {
    expect(canOptimize(project, { ...params, ...invalid })).toBe(false);
  }
});
