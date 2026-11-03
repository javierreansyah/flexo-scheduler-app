import { test, expect } from "@playwright/test";
test("blank rows create validated records and filters preserve the matrix", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Add job", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("tab", { name: "Jobs", exact: true }),
  ).toBeVisible();
  await page.getByLabel("New Job ID", { exact: true }).fill("alpha");
  await page.getByLabel("New Quantity", { exact: true }).fill("100");
  await page.getByLabel("New Quantity", { exact: true }).press("Enter");
  await expect(page.getByLabel("Job ID row 1", { exact: true })).toHaveValue(
    "alpha",
  );
  await expect(page.getByLabel("New Job ID", { exact: true })).toHaveValue("");
  await expect(page.getByText("1 rows", { exact: true })).toBeVisible();
  await page.getByLabel("New Job ID", { exact: true }).fill("alpha");
  await page.getByLabel("New Quantity", { exact: true }).fill("200");
  await page.getByLabel("New Quantity", { exact: true }).press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Job IDs must be unique." }),
  ).toBeVisible();
  await page.getByLabel("New Job ID", { exact: true }).press("Escape");
  await expect(page.getByLabel("Job ID row 2", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await page.getByLabel("New Machine", { exact: true }).fill("Extra press");
  await page.getByLabel("New Pieces / min", { exact: true }).fill("120");
  await page.getByLabel("New Pieces / min", { exact: true }).press("Enter");
  await expect(page.getByText("4 rows", { exact: true })).toBeVisible();
  await expect(page.getByLabel("New Machine", { exact: true })).toHaveValue("");
  await page.getByRole("tab", { name: "Colors", exact: true }).click();
  await page.getByLabel("New color name", { exact: true }).fill("Blue");
  await page.getByLabel("New color darkness", { exact: true }).fill("6");
  await page.getByLabel("New color darkness", { exact: true }).press("Tab");
  await expect(page.getByLabel("Color name 4", { exact: true })).toHaveValue(
    "Blue",
  );
  await expect(page.getByLabel("New color name", { exact: true })).toHaveValue(
    "",
  );
  await page.getByLabel("Search colors").fill("Blue");
  await expect(page.getByText("1 rows", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Color name 1", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Changeovers", exact: true }).click();
  await page.getByLabel("Search transitions").fill("Blue");
  await expect(
    page.getByRole("rowheader", { name: "Blue", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("rowheader", { name: "Red", exact: true }),
  ).toHaveCount(0);
  const time = page.getByLabel("Transition time Blue to Red (minutes)", {
    exact: true,
  });
  await time.fill("20");
  await time.press("Enter");
  await page.getByLabel("Search transitions").fill("");
  await expect(time).toHaveValue("20");
  await page
    .getByRole("button", { name: "Restore defaults", exact: true })
    .click();
  await expect(time).toHaveValue("45");
});
