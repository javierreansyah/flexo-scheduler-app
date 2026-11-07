import { expect, test } from "vitest";
import { initial, example } from "./model";
import { canOptimize } from "./can-optimize";
import { parseColors, colorNames } from "./colors";
import { importCsv } from "./csv";
import { validateJobs, validateMachines } from "./validation";
test("numeric catalog names take precedence over legacy IDs", () => {
  const colors = [{ id: 4, name: "123", hex: "#ffffff" }];
  expect(parseColors(colorNames([4, 4], colors), colors)).toEqual([4, 4]);
  expect(parseColors("4", colors)).toEqual([4]);
});
test("optimizer gate rejects equal temperatures and zero objectives", () => {
  const p = example();
  expect(canOptimize(p, { ...p.custom, t_max: 1, t_min: 1 })).toBe(false);
  p.snapshot.ink_weight = 0;
  p.snapshot.batch_flow_time_weight = 0;
  expect(canOptimize(p, p.custom)).toBe(false);
});
test("all row commits reject invalid quantities, IDs, inks and machines", () => {
  const p = initial(),
    job = { id: "a", quantity: 100, inks: [1], arrival_time: 0 };
  for (const jobs of [
    [{ ...job, quantity: 0 }],
    [job, job],
    [{ ...job, inks: [NaN] }],
  ])
    expect(() => validateJobs(jobs, p.colors!)).toThrow();
  expect(() => validateMachines({ A: Infinity }, {}, p.colors!)).toThrow();
  expect(() =>
    validateMachines(
      { A: 100 },
      { A: { available_time: -1, inks: [] } },
      p.colors!,
    ),
  ).toThrow();
  for (const text of [
    "id,quantity,inks\na,100,Unknown",
    "id,quantity,inks\na,0,Red",
  ])
    expect(() =>
      importCsv(text, "jobs", p.snapshot, p.colors!, false),
    ).toThrow();
  expect(() =>
    importCsv(
      "name,rate,available_time\nA,Infinity,-5",
      "machines",
      p.snapshot,
      p.colors!,
      false,
    ),
  ).toThrow();
});
