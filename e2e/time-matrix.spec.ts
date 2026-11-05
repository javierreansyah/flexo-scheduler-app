import { test, expect } from "@playwright/test";
import { initial } from "../lib/model";
import { inkCostMatrix } from "../lib/ink-costs";
test("matrix units persist and 10 + 20 minute parallel cleaning schedules as 20 minutes", async ({
  page,
}) => {
  const p = initial();
  p.colors = [
    { id: 1, name: "A", hex: "#ff0000" },
    { id: 2, name: "B", hex: "#00ff00" },
    { id: 3, name: "C", hex: "#0000ff" },
    { id: 4, name: "D", hex: "#ffffff" },
  ];
  const labels = ["empty", "1", "2", "3", "4"];
  p.snapshot = {
    ...p.snapshot,
    machines: { Press: 60 },
    machine_states: { Press: { available_time: 0, inks: [1, 2] } },
    jobs: [{ id: "probe", quantity: 60, inks: [3, 4], arrival_time: 0 }],
    ink_costs: inkCostMatrix(labels),
    ink_weight: 0,
    batch_flow_time_weight: 1,
    transition_times: Object.fromEntries(
      labels.map((a) => [
        a,
        Object.fromEntries(labels.map((b) => [b, a === b ? 0 : 1])),
      ]),
    ),
  };
  p.snapshot.transition_times!["1"]["3"] = 10 / 60;
  p.snapshot.transition_times!["2"]["4"] = 20 / 60;
  p.preset = "low";
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeEnabled();
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "time.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  await expect(
    page.getByText("Default setup duration (hours)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Setup duration override", { exact: true }),
  ).toHaveCount(0);
  const cell = page.getByLabel("Transition time B to D (minutes)", {
    exact: true,
  });
  await expect(cell).toHaveValue("20");
  await cell.fill("25");
  await cell.press("Enter");
  await cell.fill("20");
  await cell.press("Enter");
  await page.getByRole("combobox", { name: "Transition time unit" }).click();
  await page.getByRole("option", { name: "Hours", exact: true }).click();
  await expect(
    page.getByLabel("Transition time B to D (hours)", { exact: true }),
  ).toHaveValue("0.333333333333");
  await expect(
    page.getByLabel("Transition time A to A (hours)", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  await expect(cell).toHaveValue("20");
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect(page.locator('[data-slot="metrics"]')).toContainText("0.35h");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Export Project" }).click();
  const artifact = await download;
  const file = await artifact.path();
  const fs = await import("node:fs/promises");
  const saved = JSON.parse(await fs.readFile(file!, "utf8"));
  const job = saved.history.at(-1).schedule.Press[0];
  expect(saved.history.at(-1).ink_changes).toBeCloseTo(20 / 60, 10);
  expect(job.start - job.setup_start).toBeCloseTo(20 / 60, 10);
});
