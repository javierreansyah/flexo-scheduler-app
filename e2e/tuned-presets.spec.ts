import { expect, test } from "@playwright/test";

test("20-start settings run and reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("Independent Starts").fill("20");
  await page.getByLabel("Evaluations", { exact: true }).fill("1000");
  await expect(
    page.getByRole("button", { name: "Optimize", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Optimize", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await expect(page.locator("#workspace [role=alert]")).toHaveCount(0);
  await expect(page.locator("[data-slot=metrics]")).not.toContainText("0.00s");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByLabel("Independent Starts")).toHaveValue("20");
});
