import { expect, test } from "@playwright/test";

test("add dialogs validate and create jobs, machines, and colors", async ({
  page,
}) => {
  await page.goto("/");
  const open = async (title: string) => {
    await page.getByRole("button", { name: title, exact: true }).click();
    return page.getByRole("dialog", { name: title });
  };
  let dialog = await open("Add Job");
  await expect(dialog.getByLabel("Job ID", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Add Job", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("job ID");
  await dialog.getByLabel("Job ID", { exact: true }).fill("Order A");
  await dialog.getByLabel("Quantity", { exact: true }).fill("1200");
  await dialog.getByLabel("Inks", { exact: true }).fill("red");
  await page.getByRole("option", { name: "Red", exact: true }).click();
  await dialog.getByRole("button", { name: "Add Job", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Job ID row 1")).toHaveValue("Order A");
  await expect(page.getByRole("button", { name: "Remove Red" })).toBeVisible();
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  dialog = await open("Add Machine");
  await expect(dialog.getByLabel("Machine", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Pieces / min", { exact: true })).toHaveValue(
    "",
  );
  await dialog.getByLabel("Machine", { exact: true }).fill("Press Z");
  await dialog.getByLabel("Pieces / min", { exact: true }).fill("200");
  await dialog
    .getByRole("button", { name: "Add Machine", exact: true })
    .click();
  await expect(page.getByLabel("Machine row 4")).toHaveValue("Press Z");
  await page.getByRole("tab", { name: "Colors", exact: true }).click();
  dialog = await open("Add Color");
  await expect(dialog.getByLabel("Color Name")).toHaveValue("");
  await dialog.getByLabel("Color Name").fill("Red");
  await dialog.getByRole("button", { name: "Add Color", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("unique");
  await dialog.getByLabel("Color Name").fill("Violet");
  await dialog.getByLabel("Color Swatch").fill("#aa44bb");
  await dialog.getByRole("button", { name: "Add Color", exact: true }).click();
  await expect(page.getByLabel("Color Name 4")).toHaveValue("Violet");
});
