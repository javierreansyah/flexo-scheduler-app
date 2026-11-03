import { industryInkCost } from "./ink-costs";
import { test, expect } from "vitest";
import { example } from "./model";
import { colorNames } from "./colors";
test("industry jobs distinguish equal-darkness colors", () => {
  const p = example();
  expect(p.colors).toHaveLength(11);
  expect(colorNames(p.snapshot.jobs[3].inks, p.colors!)).toBe("Red, Blue");
  expect(colorNames(p.snapshot.jobs[9].inks, p.colors!)).toBe(
    "Brown, Gray, Black",
  );
  expect(colorNames(p.snapshot.jobs[14].inks, p.colors!)).toBe(
    "Pink, Orange, Blue",
  );
  expect(p.colors!.find((c) => c.name === "Red")!.darkness).toBe(
    p.colors!.find((c) => c.name === "Blue")!.darkness,
  );
  expect(industryInkCost("7", "6")).toBe(0);
  expect(industryInkCost("10", "9")).toBe(0);
  expect(industryInkCost("11", "1")).toBe(1);
  expect(new Set(p.colors!.map((c) => c.id)).size).toBe(11);
});
