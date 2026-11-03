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
    page.getByRole("menuitem", { name: "Import project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export project" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Industry example" }).click();
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect(
    page.getByRole("heading", { name: "Schedule", exact: true }),
  ).toBeVisible();
  const firstFitness = await page
    .locator('[data-slot="metrics"] strong')
    .first()
    .innerText();
  expect(Number.isFinite(Number(firstFitness))).toBe(true);
  await page.getByRole("button", { name: "shift", exact: true }).click();
  await expect(page.getByText("Shift 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "scroll", exact: true }).click();
  await expect(page.getByLabel("Timeline zoom")).toBeVisible();
  await page.getByLabel("Next batch arrival hour").fill("1");
  await page.getByRole("button", { name: "Start next batch" }).click();
  await expect(page.getByText(/locked.*current time 1h/)).toBeVisible();
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await page.getByRole("button", { name: "Optimize" }).click();
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await page.getByRole("option", { name: "Horizon 1 · 0h · C1" }).click();
  await expect(page.locator('[data-slot="metrics"] strong').first()).toHaveText(
    firstFitness,
  );
  expect(errors).toEqual([]);
});
test("cancel keeps input; mobile layout fits viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry example" }).click();
  await page.getByRole("combobox", { name: "Speed preset" }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("evaluations", { exact: true }).fill("1000000000");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await page.getByRole("button", { name: "Optimize" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#workspace [role=alert]")).toContainText(
    "cancelled",
  );
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
  await expect(page.getByLabel("Inks row 2", { exact: true })).toHaveValue(
    "Brown",
  );
});

test("ink editing and selected row deletion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const inks = page.getByLabel("Inks row 1", { exact: true });
  await inks.fill("1,2,2");
  await inks.press("Tab");
  await expect(inks).toHaveValue("Red, Green, Green");
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
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await page.getByLabel("Inks row 1", { exact: true }).fill("12");
  await page.getByLabel("Inks row 1", { exact: true }).press("Tab");
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  await expect(cost).toHaveValue("150");
  await expect(
    page.getByLabel("Transition time Color L to Red (minutes)", {
      exact: true,
    }),
  ).toHaveValue("45");
  await page.getByRole("button", { name: "Restore defaults" }).click();
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
    .toBeGreaterThan(0);
  const initial = await page.evaluate(() => (window as any).headerContexts);
  const sizes = await page.evaluate(() => ({
    body: parseFloat(getComputedStyle(document.body).fontSize),
    header: parseFloat(
      getComputedStyle(document.querySelector(".hero h1")!).fontSize,
    ),
    weight: getComputedStyle(document.querySelector(".hero h1")!).fontWeight,
  }));
  expect(sizes.body).toBeCloseTo(0.9712 * 16 + 0.1282 * 3.9, 1);
  expect(sizes.header).toBeCloseTo(1.9699 * 16 + 2.3041 * 3.9, 1);
  expect(sizes.weight).toBe("500");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry example" }).click();
  await page.getByRole("combobox", { name: "Speed preset" }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("evaluations", { exact: true }).fill("1000000000");
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
  await page.getByRole("button", { name: "Add color", exact: true }).click();
  const name = page.getByLabel("Color name 4", { exact: true });
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
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const inks = page.getByLabel("Inks row 1", { exact: true });
  await inks.fill("Red, Blue");
  await inks.press("Tab");
  await expect(inks).toHaveValue("Red, Blue");
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect(
    page.getByRole("heading", { name: "Schedule", exact: true }),
  ).toBeVisible();
});
