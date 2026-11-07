import { test, expect } from "@playwright/test";
test("invalid settings preserve the last valid saved project", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Project actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Industry Example", exact: true })
    .click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByLabel("Random Seed", { exact: true }).fill("");
  await expect(
    page.getByText("Autosave unavailable", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Job ID row 1", { exact: true })).toHaveValue(
    "1",
  );
});
test("failed restore leaves the stored copy intact", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(
          { version: 99, marker: "preserve" },
          "flexo-project-v1",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator("#workspace [role=alert]")).toContainText(
    "preserved",
  );
  expect(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open("keyval-store");
          request.onsuccess = () => {
            const db = request.result;
            const get = db
              .transaction("keyval")
              .objectStore("keyval")
              .get("flexo-project-v1");
            get.onsuccess = () => {
              resolve(get.result.marker);
              db.close();
            };
          };
        }),
    ),
  ).toBe("preserve");
});
test("deleting above a selected job clears the selection", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Project actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Industry Example", exact: true })
    .click();
  await page.getByLabel("Select row 2", { exact: true }).check();
  await page.getByRole("button", { name: "Delete row 1", exact: true }).click();
  await expect(
    page.getByLabel("Select row 2", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Delete 1 selected", exact: true }),
  ).toHaveCount(0);
});
