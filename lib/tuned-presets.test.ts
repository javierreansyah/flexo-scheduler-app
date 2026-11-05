import { expect, test } from "vitest";
import { canOptimize } from "./can-optimize";
import { example, importProject, parameters } from "./model";

test("calibrated presets stay unchanged", () => {
  const presets = [10, 30, 50, 100].map((size) =>
    ["low", "medium", "high"].map((preset) => parameters(size, preset)),
  );
  expect(presets).toMatchSnapshot();
});

test("20-start custom settings are runnable and survive import", () => {
  const project = example();
  project.preset = "custom";
  project.custom = { ...project.custom, starts: 20 };
  expect(canOptimize(project, project.custom)).toBe(true);
  expect(importProject(JSON.parse(JSON.stringify(project))).custom.starts).toBe(
    20,
  );
  expect(canOptimize(project, { ...project.custom, starts: 21 })).toBe(false);
});
