import { test, expect } from "@playwright/test";
test("Project graph preserves branches and unfinished edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Job", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Add Job" })
    .getByRole("button", { name: "Add Job", exact: true })
    .click();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export Schedule CSV", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  const graph = page.getByRole("region", { name: "Horizon graph" });
  await expect(
    graph.getByRole("button", { name: "Horizon 0h · C2", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "Horizon 0h · C1", exact: true })
    .click();
  await page.getByLabel("Random Seed", { exact: true }).fill("99");
  await expect(
    graph.getByRole("button", { name: "Horizon 0h · Draft", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "Horizon 0h · C2", exact: true })
    .click();
  await expect(page.getByLabel("Random Seed", { exact: true })).toHaveValue(
    "42",
  );
  await graph
    .getByRole("button", { name: "Horizon 0h · Draft", exact: true })
    .click();
  await expect(page.getByLabel("Random Seed", { exact: true })).toHaveValue(
    "99",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(page.getByLabel("Random Seed", { exact: true })).toHaveValue(
    "99",
  );
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await expect(
    graph.getByRole("button", { name: "Horizon 0h · C3", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "Horizon 0h · C1", exact: true })
    .click();
  await page.getByLabel("Next batch arrival hour").fill("1");
  await page.getByRole("button", { name: "Start Next Batch" }).click();
  await expect(
    graph.getByRole("button", { name: "Horizon 1h · Draft", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("project-horizons.png"),
    fullPage: true,
  });
  await page.getByRole("combobox", { name: "Horizon", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Horizon 0h · C1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("option", { name: "Horizon 0h · C1", exact: true })
    .click();
  await expect(
    graph.getByRole("button", { name: "Horizon 0h · C1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("button", { name: "Delete branch", exact: true }),
  ).toBeDisabled();
  await graph
    .getByRole("button", { name: "Horizon 0h · C2", exact: true })
    .click();
  await page.getByLabel("Random Seed", { exact: true }).fill("77");
  await graph
    .getByRole("button", { name: "Horizon 0h · C2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete branch", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 checkpoints and 1 drafts");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    graph.getByRole("button", { name: "Horizon 0h · C2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete branch", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm delete branch", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete branch", exact: true }),
  ).toBeDisabled();
  await expect(graph.getByRole("button")).toHaveCount(3);
  await page.reload();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(graph.getByRole("button")).toHaveCount(3);
  const paths = await graph
    .locator("svg path")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")!));
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths)
    expect(path).toMatch(/^M [\d.]+ [\d.]+(?: [HV] [\d.]+)+$/);
  await graph.screenshot({
    path: test.info().outputPath("square-branches.png"),
  });
  expect(paths.some((path) => /^M [\d.]+ [\d.]+ V [\d.]+$/.test(path))).toBe(
    true,
  );
  await expect(graph).toHaveCSS("border-top-width", "0px");
  await page
    .getByRole("combobox", { name: "Speed Preset", exact: true })
    .click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Optimizer Parameters", exact: true }),
  ).toBeVisible();
  for (const label of [
    "Evaluations",
    "Starting Temperature",
    "Final Temperature",
    "Shift Move Probability",
    "Between-Machine Move Probability",
    "Block Move Probability",
  ])
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
});
