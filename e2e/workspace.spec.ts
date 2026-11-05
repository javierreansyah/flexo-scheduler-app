import { addJob, addColor } from "./helpers";
import { expect, test } from "@playwright/test";

test("industry scheduling, arrivals, history, views and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const projectControls = page.getByRole("region", {
    name: "Project controls",
  });
  await expect(
    projectControls.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await projectControls
    .getByRole("button", { name: "Project actions" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Import Project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Project" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect(
    page.getByRole("button", { name: "Optimize", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export Schedule CSV", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  const firstFitness = await page
    .locator('[data-slot="metrics"] strong')
    .first()
    .innerText();
  expect(Number.isFinite(Number(firstFitness))).toBe(true);
  const timelineScroll = page.locator(".timeline-scroll");
  await expect
    .poll(() =>
      timelineScroll.evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBe(0);
  await page.getByRole("button", { name: "Shift", exact: true }).click();
  await expect(page.getByText("Shift 1", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      timelineScroll.evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBe(0);
  await page.getByRole("button", { name: "Scroll", exact: true }).click();
  await page.getByLabel("Timeline Zoom").press("End");
  await expect
    .poll(() =>
      timelineScroll.evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByLabel("Timeline Zoom")).toBeVisible();
  await page.getByLabel("Next batch arrival hour").fill("1");
  await page.getByRole("button", { name: "Start Next Batch" }).click();
  await expect(page.getByText(/locked.*current time 1h/)).toBeVisible();
  await addJob(page);
  await page.getByRole("button", { name: "Optimize" }).click();
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await page.getByRole("option", { name: "Horizon 0h · C1" }).click();
  await expect(page.locator('[data-slot="metrics"] strong').first()).toHaveText(
    firstFitness,
  );
  expect(errors).toEqual([]);
});
test("cancel keeps input; mobile layout fits viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("Evaluations", { exact: true }).fill("1000000000");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await page.getByRole("button", { name: "Optimize" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Optimize", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#workspace [role=alert]")).toHaveCount(0);
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
  await addJob(page);
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
  await expect(
    page.getByRole("button", { name: "Remove Brown" }),
  ).toBeVisible();
});

test("ink editing and selected row deletion", async ({ page }) => {
  await page.goto("/");
  await addJob(page);
  const inks = page.getByLabel("Inks row 1", { exact: true });
  await inks.fill("re");
  const emptyMessage = page
    .getByRole("listbox")
    .locator("..")
    .locator('[role="status"]');
  await expect(emptyMessage).toBeEmpty();
  expect((await emptyMessage.boundingBox())?.height).toBe(0);
  await inks.fill("no matching color");
  await expect(emptyMessage).toHaveText("No colors found.");
  await inks.fill("re");
  await inks.press("Tab");
  await expect(page.getByRole("button", { name: "Remove Red" })).toBeVisible();
  await inks.fill("green");
  await inks.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove Green" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Red" }).click();
  await expect(page.getByRole("button", { name: "Remove Red" })).toHaveCount(0);
  const deleteButton = page.getByRole("button", {
    name: "Delete row 1",
    exact: true,
  });
  const deleteSize = await deleteButton.boundingBox();
  expect(deleteSize?.width).toBeGreaterThanOrEqual(36);
  expect(deleteSize?.height).toBeGreaterThanOrEqual(36);
  await page.getByLabel("Select row 1", { exact: true }).check();
  await page
    .getByRole("button", { name: "Delete 1 selected", exact: true })
    .click();
  await expect(page.getByLabel("Job ID row 1", { exact: true })).toHaveCount(0);
});

test("matrix adds new inks without overwriting existing cells", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  const cost = page.getByLabel("Transition time Brown to Red (minutes)", {
    exact: true,
  });
  await cost.fill("150");
  await cost.press("Enter");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await addJob(page);
  await page.getByRole("tab", { name: "Colors", exact: true }).click();
  await addColor(page);
  await page.getByLabel("Color Name 4", { exact: true }).fill("Color L");
  await page.getByLabel("Color Name 4", { exact: true }).press("Tab");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await page.getByLabel("Inks row 1", { exact: true }).fill("Color L");
  await page.getByLabel("Inks row 1", { exact: true }).press("Tab");
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  await expect(cost).toHaveValue("150");
  await expect(
    page.getByLabel("Transition time Color L to Red (minutes)", {
      exact: true,
    }),
  ).toHaveValue("45");
  await page.getByRole("button", { name: "Restore Defaults" }).click();
  await expect(cost).toHaveValue("45");
});

test("portfolio typography and stable header during edits and search", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    (window as any).headerContexts = 0;
    (HTMLCanvasElement.prototype as any).getContext = function (
      ...args: any[]
    ) {
      if (
        this.parentElement?.classList.contains("masthead") &&
        args[0] === "webgl2"
      )
        (window as any).headerContexts++;
      return (original as any).apply(this, args);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).headerContexts))
    .toBe(0);
  const initial = await page.evaluate(() => (window as any).headerContexts);
  const sizes = await page.evaluate(() => ({
    body: parseFloat(getComputedStyle(document.body).fontSize),
    header: parseFloat(
      getComputedStyle(document.querySelector(".hero h1")!).fontSize,
    ),
    weight: getComputedStyle(document.querySelector(".hero h1")!).fontWeight,
  }));
  expect(sizes.body).toBeCloseTo(0.9712 * 16 + 0.1282 * 3.9, 1);
  expect(sizes.header).toBeCloseTo(2.4686 * 16 + 4.9539 * 3.9, 1);
  expect(sizes.weight).toBe("400");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("Evaluations", { exact: true }).fill("1000000000");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await page.getByRole("button", { name: "Optimize" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).headerContexts)).toBe(
    initial,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("named palette drives job input and matrix labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Colors", exact: true }).click();
  await addColor(page);
  const name = page.getByLabel("Color Name 4", { exact: true });
  await name.fill("Blue");
  await name.press("Tab");
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Blue", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Transition time Blue to Red (minutes)", { exact: true }),
  ).toHaveValue("45");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await addJob(page);
  const inks = page.getByLabel("Inks row 1", { exact: true });
  await inks.fill("Red");
  await inks.press("Tab");
  await inks.fill("Blue");
  await inks.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Blue" })).toBeVisible();
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect(
    page.getByRole("button", { name: "Optimize", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export Schedule CSV", exact: true }),
  ).toBeEnabled();
});

test("schedule is visible and follows machine changes before optimization", async ({
  page,
}) => {
  await page.goto("/");
  const schedule = page.getByRole("region", { name: "Schedule timeline" });
  await expect(schedule).toBeVisible();
  await expect(page.locator('[data-slot="metrics"] strong')).toHaveText([
    "0.00",
    "0.00h",
    "0.00h",
    "0.00h",
    "0.00s",
  ]);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await expect(schedule).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Schedule Table" }).getByRole("table"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export Schedule CSV" }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(schedule).toBeVisible();
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  const machine = page.getByLabel("Machine row 1", { exact: true });
  await machine.fill("Renamed press");
  await machine.press("Tab");
  await expect(
    schedule.locator(".lane strong", { hasText: "Renamed press" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add Machine", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Add Machine" })
    .getByLabel("Machine", { exact: true })
    .fill("Machine 4");
  await page
    .getByRole("dialog", { name: "Add Machine" })
    .getByLabel("Pieces / min", { exact: true })
    .fill("150");
  await page
    .getByRole("dialog", { name: "Add Machine" })
    .getByRole("button", { name: "Add Machine", exact: true })
    .click();
  await expect(
    schedule.locator(".lane strong", { hasText: "Machine 4" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete row 4", exact: true }).click();
  await expect(
    schedule.locator(".lane strong", { hasText: "Machine 4" }),
  ).toHaveCount(0);
});
