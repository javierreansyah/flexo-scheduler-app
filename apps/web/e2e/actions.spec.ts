import { test, expect } from "@playwright/test";
test("generation opens a dialog from the menu and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "jobs actions" });
  await expect(page.getByLabel("Jobs to generate")).toHaveCount(0);
  await menu.click();
  await page.getByRole("menuitem", { name: "Generate jobs…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Jobs to generate").fill("2");
  await dialog
    .getByRole("button", { name: "Generate jobs", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Jobs", exact: true }),
  ).toBeVisible();
  await expect(menu).toBeFocused();
  const del = page.getByRole("button", { name: "Delete row 1", exact: true });
  await expect(del).toHaveText("");
  await expect(del).toHaveAttribute("data-slot", "button");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: "machines actions" }).click();
  await page.getByRole("menuitem", { name: "Generate machines…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
