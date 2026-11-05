import { expect, type Page } from "@playwright/test";

export async function addJob(page: Page, id = "Test Job") {
  await page.getByRole("button", { name: "Add Job", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Job" });
  await dialog.getByLabel("Job ID", { exact: true }).fill(id);
  await dialog.getByLabel("Quantity", { exact: true }).fill("10000");
  await dialog.getByRole("button", { name: "Add Job", exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function addColor(page: Page) {
  await page.getByRole("button", { name: "Add Color", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Color" });
  await dialog.getByLabel("Color Name", { exact: true }).fill("Test Color");
  await dialog.getByRole("button", { name: "Add Color", exact: true }).click();
  await expect(dialog).toBeHidden();
}
