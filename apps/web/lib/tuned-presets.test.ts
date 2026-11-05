import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { canOptimize } from "./can-optimize";
import { example, importProject, parameters } from "./model";

test("presets match all completed fixed-budget winners", () => {
  const summary = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../../packages/optimizer/docs/fixed-budget-summary.json",
      ),
      "utf8",
    ),
  );
  for (const [size, budgets] of Object.entries(summary.campaign.budgets) as [
    string,
    Record<string, number>,
  ][]) {
    for (const [preset, budget] of Object.entries(budgets)) {
      expect(parameters(Number(size), preset)).toEqual(
        summary.sizes[size].completed[budget].parameters,
      );
    }
  }
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
