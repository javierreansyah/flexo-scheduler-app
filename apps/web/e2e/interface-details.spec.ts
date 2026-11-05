import { expect, test } from "@playwright/test";

test("arrival hour can be cleared and replaced", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Quick", exact: true }).click();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  const arrival = page.getByLabel("Next batch arrival hour");
  await expect(arrival).toBeVisible();
  await arrival.fill("");
  await expect(arrival).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Start Next Batch" }),
  ).toBeDisabled();
  await arrival.pressSequentially("4");
  await expect(arrival).toHaveValue("4");
  await expect(
    page.getByRole("button", { name: "Start Next Batch" }),
  ).toBeEnabled();
  const machine = await page.locator(".axis > strong").boundingBox();
  const time = await page.locator(".axis span").first().boundingBox();
  expect(Math.abs(machine!.y - time!.y)).toBeLessThanOrEqual(1);
});

test("changeover headers use left alignment and ink swatches", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Colors" }).click();
  await page.getByLabel("Swatch Red").fill("#127abc");
  await page.getByRole("tab", { name: "Changeovers" }).click();
  const table = page.getByRole("table", { name: "Ink transition time matrix" });
  const heading = table.getByRole("columnheader", { name: "From / To" });
  await expect(heading).toHaveCSS("text-align", "left");
  const row = table.getByRole("rowheader", { name: "Red", exact: true });
  await expect(row.locator("input[type=color]")).toHaveValue("#127abc");
  await expect(
    table
      .getByRole("rowheader", { name: "Empty" })
      .locator("input[type=color]"),
  ).toHaveCount(0);
});
