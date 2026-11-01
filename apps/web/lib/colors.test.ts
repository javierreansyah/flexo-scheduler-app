import { it, expect } from "vitest";
import { initial, example, importProject } from "./model";
import { projectColors, colorNames, parseColors } from "./colors";
it("supports named colors while preserving numeric engine inputs", () => {
  const p = initial(),
    colors = projectColors(p);
  expect(parseColors("Red, Green, Green", colors)).toEqual([1, 2, 2]);
  expect(colorNames([1, 2, 2], colors)).toBe("Red, Green, Green");
  expect(parseColors("1,2", colors)).toEqual([1, 2]);
  expect(importProject(JSON.parse(JSON.stringify(p))).colors).toEqual(p.colors);
  expect(projectColors(example()).map((c) => c.id)).toContain(9);
});
