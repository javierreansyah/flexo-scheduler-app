import { expect, test } from "@playwright/test";

test("production HTML reserves the editor and schedule before hydration", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(
    page.getByRole("heading", { name: "Scheduling workspace", level: 2 }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("columnheader", { name: "Job ID" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Schedule timeline" }),
  ).toBeVisible();
  await context.close();
});
