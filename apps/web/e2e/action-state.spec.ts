import { test, expect } from "@playwright/test";

test("empty and invalid workspaces prevent optimization", async ({ page }) => {
  await page.goto("/");
  const optimize = page.getByRole("button", { name: "Optimize", exact: true });
  await expect(page.getByText("Loading workspace…")).toHaveCount(0);
  await expect(optimize).toBeDisabled();
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await expect(optimize).toBeEnabled();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("Random Seed", { exact: true }).fill("-1");
  await expect(optimize).toBeDisabled();
  await page.getByLabel("Random Seed", { exact: true }).fill("42");
  await expect(optimize).toBeEnabled();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
