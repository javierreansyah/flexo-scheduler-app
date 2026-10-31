import { inkCostMatrix } from "../lib/ink-costs";
import fixtures from "./native-fixtures.json";
import { test, expect } from "@playwright/test";
test("industry scheduling, arrivals, history, views and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Industry example" }).click();
  await page.getByRole("button", { name: "Optimize schedule" }).click();
  await expect(page.getByText("A schedule, with perspective.")).toBeVisible();
  await expect(page.locator(".metrics")).toContainText("4.63594");
  await page.getByRole("button", { name: "shift", exact: true }).click();
  await expect(page.getByText("Shift 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "scroll", exact: true }).click();
  await expect(page.getByLabel("Timeline zoom")).toBeVisible();
  await page.getByLabel("Next batch arrival hour").fill("1");
  await page.getByRole("button", { name: "Start arrival batch" }).click();
  await expect(page.getByText(/locked.*current time 1h/)).toBeVisible();
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await page.getByRole("button", { name: "Optimize schedule" }).click();
  await expect(
    page.getByLabel("Schedule history").locator("option"),
  ).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByLabel("Schedule history").locator("option"),
  ).toHaveCount(2);
  await page.getByLabel("Schedule history").selectOption("0");
  await expect(page.locator(".metrics")).toContainText("4.63594");
  expect(errors).toEqual([]);
});
test("cancel keeps input; mobile layout fits viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Industry example" }).click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("evaluations", { exact: true }).fill("1000000000");
  await page.getByRole("button", { name: "Optimize schedule" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".error[role=alert]")).toContainText("cancelled");
  await expect(page.getByLabel("Quantity row 1", { exact: true })).toHaveValue(
    "16539",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("spreadsheet paste appends rows atomically", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const cell = page.getByLabel("Job ID row 1", { exact: true });
  await cell.evaluate((el) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "alpha\t6000\t1,2\nbeta\t7000\t3" },
    });
    el.dispatchEvent(event);
  });
  await expect(page.getByLabel("Job ID row 2", { exact: true })).toHaveValue(
    "beta",
  );
  await expect(page.getByLabel("Quantity row 1", { exact: true })).toHaveValue(
    "6000",
  );
  await expect(page.getByLabel("Inks row 2", { exact: true })).toHaveValue("3");
});

test("ink editing and selected row deletion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const inks = page.getByLabel("Inks row 1", { exact: true });
  await inks.fill("1,2,2");
  await inks.press("Tab");
  await expect(inks).toHaveValue("1, 2, 2");
  await page.getByLabel("Select row 1", { exact: true }).check();
  await page
    .getByRole("button", { name: "Delete 1 selected", exact: true })
    .click();
  await expect(page.getByLabel("Job ID row 1", { exact: true })).toHaveCount(0);
});

test("industry cost matrix edits persist and affect actual WASM scoring", async ({
  page,
}) => {
  await page.goto("/");
  const project = {
    version: 1,
    snapshot: {
      now: 0,
      machines: { A: 100 },
      jobs: [{ id: "probe", quantity: 6000, inks: [1], arrival_time: 0 }],
      locked: {},
      machine_states: { A: { available_time: 0, inks: [9] } },
      setup_time: 0.75,
      ink_weight: 0.4,
      batch_flow_time_weight: 0.6,
      ink_costs: inkCostMatrix(["empty", "1", "9"]),
    },
    history: [],
    preset: "low",
    custom: fixtures[0].parameters,
    seed: "42",
  };
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole("button", { name: "changeovers", exact: true }).click();
  const cost = page.getByLabel("Ink cost 9 to 1", { exact: true });
  await expect(cost).toHaveValue("1");
  await expect(page.getByLabel("Ink cost 1 to 9", { exact: true })).toHaveValue(
    "0",
  );
  await expect(
    page.getByLabel("Ink cost 9 to 9", { exact: true }),
  ).toBeDisabled();
  await cost.fill("3");
  await cost.press("Enter");
  await expect(
    page.getByText("Custom ink costs:", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "changeovers", exact: true }).click();
  await expect(cost).toHaveValue("3");
  await page.getByRole("button", { name: "Optimize schedule" }).click();
  await expect(page.locator(".metrics")).toContainText("2.25000");
  await expect(cost).toBeDisabled();
});
test("matrix adds new inks without overwriting existing cells", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "changeovers", exact: true }).click();
  const cost = page.getByLabel("Ink cost 9 to 1", { exact: true });
  await cost.fill("2.5");
  await cost.press("Enter");
  await page.getByRole("button", { name: "jobs / 0", exact: true }).click();
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await page.getByLabel("Inks row 1", { exact: true }).fill("12");
  await page.getByLabel("Inks row 1", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "changeovers", exact: true }).click();
  await expect(cost).toHaveValue("2.5");
  await expect(
    page.getByLabel("Ink cost 12 to 1", { exact: true }),
  ).toHaveValue("1");
  await page.getByRole("button", { name: "Restore industry defaults" }).click();
  await expect(cost).toHaveValue("1");
});
