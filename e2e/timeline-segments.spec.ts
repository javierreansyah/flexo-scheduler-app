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
  expect(
    await setup.locator("xpath=..").locator(".job-bar .setup-bar").count(),
  ).toBe(0);
  await page.getByRole("button", { name: "Shift", exact: true }).click();
  await expect(page.getByText("Shift 1", { exact: true })).toBeVisible();
});
