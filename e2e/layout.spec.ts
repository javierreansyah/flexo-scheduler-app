import { addJob } from "./helpers";
import { test, expect } from "@playwright/test";
for (const width of [390, 768, 1440]) {
  test(
    "consistent controls and table layout at " + width + "px",
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.getByRole("button", { name: "Project actions" }).click();
      await page.getByRole("menuitem", { name: "Industry Example" }).click();
      const search = page.getByRole("textbox", { name: "Search Table" }),
        add = page.getByRole("button", { name: "Add Job", exact: true });
      await expect(add).toBeEnabled();
      for (const control of [
        search,
        add,
        page.getByRole("button", { name: "New", exact: true }),
        page.getByRole("button", { name: "Project actions" }),
        page.getByRole("combobox", { name: "Speed Preset" }),
      ]) {
        const box = await control.boundingBox();
        expect(box?.height).toBeCloseTo(36, 0);
      }
      const row = page
        .locator('[data-slot="table-body"] [data-slot="table-row"]')
        .filter({ has: page.getByRole("textbox") })
        .first();
      expect((await row.boundingBox())?.height).toBeCloseTo(44, 0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("page-" + width + ".png"),
        fullPage: true,
      });
      await page
        .locator("#workspace")
        .screenshot({ path: testInfo.outputPath("jobs-" + width + ".png") });
      await page.getByRole("tab", { name: "Machines", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Add Machine", exact: true }),
      ).toBeVisible();
      await page.locator("#workspace").screenshot({
        path: testInfo.outputPath("machines-" + width + ".png"),
      });
      await page.getByRole("tab", { name: "Colors", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Colors", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("table", { name: "Colors", exact: true }),
      ).toBeVisible();
      await page
        .locator("#workspace")
        .screenshot({ path: testInfo.outputPath("colors-" + width + ".png") });
      await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
      await expect(
        page.getByRole("table", { name: "Colors", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          name: "Ink transition time matrix",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("table", {
          name: "Ink transition time matrix",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator("#workspace").screenshot({
        path: testInfo.outputPath("changeovers-" + width + ".png"),
      });
    },
  );
}
test("filtered and sorted edits update the correct job", async ({ page }) => {
  await page.goto("/");
  await addJob(page);
  await page.getByLabel("Job ID row 1", { exact: true }).fill("Zulu");
  await page.getByLabel("Job ID row 1", { exact: true }).press("Tab");
  await addJob(page, "Second Job");
  await page.getByLabel("Job ID row 2", { exact: true }).fill("Alpha");
  await page.getByLabel("Job ID row 2", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Job ID", exact: true }).click();
  await page.getByLabel("Search Table").fill("Alpha");
  await page.getByLabel("Quantity row 2", { exact: true }).fill("1234");
  await page.getByLabel("Quantity row 2", { exact: true }).press("Tab");
  await page.getByLabel("Search Table").fill("");
  await expect(page.getByLabel("Quantity row 2", { exact: true })).toHaveValue(
    "1234",
  );
  await expect(page.getByLabel("Quantity row 1", { exact: true })).toHaveValue(
    "10000",
  );
});

test("machine edits preserve state when renaming and deleting other rows", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  const available = page.getByLabel("Available (h) row 2", { exact: true });
  await available.fill("4");
  await available.press("Tab");
  const name = page.getByLabel("Machine row 2", { exact: true });
  await name.fill("Renamed");
  await name.press("Tab");
  await expect(available).toHaveValue("4");
  await page.getByRole("button", { name: "Delete row 1", exact: true }).click();
  await expect(page.getByLabel("Machine row 1", { exact: true })).toHaveValue(
    "Renamed",
  );
  await expect(
    page.getByLabel("Available (h) row 1", { exact: true }),
  ).toHaveValue("4");
});
