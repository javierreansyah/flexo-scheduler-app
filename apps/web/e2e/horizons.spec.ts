import { test, expect } from "@playwright/test";
test("Project graph preserves branches and unfinished edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Schedule", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  const graph = page.getByRole("region", { name: "Horizon graph" });
  await expect(
    graph.getByRole("button", { name: "Horizon 1 · 0h · C2", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "Horizon 1 · 0h · C1", exact: true })
    .click();
  await page.getByLabel("Random seed", { exact: true }).fill("99");
  await expect(
    graph.getByRole("button", { name: "Horizon 1 · 0h · Draft", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "Horizon 1 · 0h · C2", exact: true })
    .click();
  await expect(page.getByLabel("Random seed", { exact: true })).toHaveValue(
    "42",
  );
  await graph
    .getByRole("button", { name: "Horizon 1 · 0h · Draft", exact: true })
    .click();
  await expect(page.getByLabel("Random seed", { exact: true })).toHaveValue(
    "99",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByLabel("Random seed", { exact: true })).toHaveValue(
    "99",
  );
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    graph.getByRole("button", { name: "Horizon 1 · 0h · C3", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "Horizon 1 · 0h · C1", exact: true })
    .click();
  await page.getByLabel("Next batch arrival hour").fill("1");
  await page.getByRole("button", { name: "Start next batch" }).click();
  await expect(
    graph.getByRole("button", { name: "Horizon 2 · 1h · Draft", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("project-horizons.png"),
    fullPage: true,
  });
  await page.getByRole("combobox", { name: "Horizon", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Horizon 1 · 0h · C1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("option", { name: "Horizon 1 · 0h · C1", exact: true })
    .click();
  await expect(
    graph.getByRole("button", { name: "Horizon 1 · 0h · C1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
