import { expect, test } from "@playwright/test";

test("setup is a separate bar from production", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Quick", exact: true }).click();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export Schedule CSV" }),
  ).toHaveCount(0);
  const setup = page.locator(".setup-bar").first();
  await expect(setup).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".job-bar").first()).toBeVisible();
  await page.locator(".job-bar").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("pieces");
  await expect(page.getByRole("tooltip")).toContainText("complete");
  expect(
    await setup.locator("xpath=..").locator(".job-bar .setup-bar").count(),
  ).toBe(0);
  await page.getByRole("button", { name: "Timeline view" }).click();
  await page.getByRole("menuitem", { name: "Shift", exact: true }).click();
  await expect(page.getByLabel("Current shift")).toHaveText("1");
});

test("mobile machine labels start inset and stick flush left after scrolling", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Quick", exact: true }).click();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(page.locator(".setup-bar").first()).toBeVisible({
    timeout: 30000,
  });
  const scroll = page.getByRole("region", { name: "Scrollable timeline" });
  const label = page.locator(".lane:not(.axis) > strong").first();
  await scroll.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const gutter = await page
    .locator("#workspace")
    .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
  expect(
    (await label.boundingBox())!.x - (await scroll.boundingBox())!.x,
  ).toBeCloseTo(gutter, 0);
  expect(
    await scroll.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Timeline view" }).click();
  await page.getByRole("menuitem", { name: "Scroll", exact: true }).click();
  await scroll.evaluate((element) => {
    element.scrollLeft = 8;
  });
  await expect
    .poll(
      async () =>
        (await label.boundingBox())!.x - (await scroll.boundingBox())!.x,
    )
    .toBeCloseTo(gutter - 8, 0);
  await scroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect
    .poll(
      async () =>
        (await label.boundingBox())!.x - (await scroll.boundingBox())!.x,
    )
    .toBeCloseTo(0, 0);
  expect(
    await label.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.left + 2, box.top + box.height / 2),
      );
    }),
  ).toBe(true);
  await scroll.screenshot({
    path: testInfo.outputPath("mobile-timeline-scrolled.png"),
  });
});
