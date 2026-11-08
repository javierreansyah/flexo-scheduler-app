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
  await page.getByRole("tab", { name: "Machines" }).click();
  const machineInputClasses = await page
    .getByLabel("Available (h) row 1", { exact: true })
    .getAttribute("class");
  await page.getByRole("tab", { name: "Changeovers" }).click();
  const table = page.getByRole("table", { name: "Ink transition time matrix" });
  const input = page.getByLabel("Transition time Red to Green (minutes)", {
    exact: true,
  });
  await expect(input).toHaveAttribute("class", machineInputClasses!);
  await expect(input).toHaveAttribute("inputmode", "decimal");
  await expect(input).toHaveCSS("text-align", "start");
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

for (const { width, hasTouch } of [
  { width: 390, hasTouch: true },
  { width: 768, hasTouch: true },
  { width: 390, hasTouch: false },
]) {
  test.describe(`changeover scrolling at ${width}px with touch=${hasTouch}`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch });
    test("sticky labels cover scrolled cells and touch scrollbars stay hidden", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(
        page.locator('[data-slot="ink-chips"]').first(),
      ).toBeVisible();
      for (const surface of await page
        .locator(
          '.timeline-scroll, .horizon-scroll, [data-slot="ink-chips"], [data-slot="table-scroll"], [data-slot="tabs-list"]',
        )
        .all())
        await expect(surface).toHaveCSS("scrollbar-width", "none");
      await page.getByRole("tab", { name: "Changeovers" }).click();
      const scroll = page.getByRole("region", { name: "Scrollable table" });
      await expect(scroll).toHaveCSS("scrollbar-width", "none");
      await expect(
        page.getByRole("tablist", { name: "Production inputs" }),
      ).toHaveCSS("scrollbar-width", "none");
      await expect(
        page.getByLabel("Transition time Red to Green (minutes)", {
          exact: true,
        }),
      ).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      if (width === 390) {
        expect(
          (await page
            .getByRole("columnheader", { name: "From / To" })
            .boundingBox())!.width,
        ).toBeLessThan(120);
        expect(
          (await page
            .getByLabel("Transition time Red to Green (minutes)", {
              exact: true,
            })
            .boundingBox())!.width,
        ).toBeLessThan(80);
        const gutter = await page
          .locator("#workspace")
          .evaluate((element) =>
            parseFloat(getComputedStyle(element).paddingLeft),
          );
        const label = page.getByRole("columnheader", { name: "From / To" });
        await scroll.evaluate((element) => {
          element.scrollLeft = 0;
        });
        await expect
          .poll(
            async () =>
              (await label.boundingBox())!.x - (await scroll.boundingBox())!.x,
          )
          .toBeCloseTo(gutter, 0);
        await scroll.evaluate((element) => {
          element.scrollLeft = 8;
        });
        await expect
          .poll(
            async () =>
              (await label.boundingBox())!.x - (await scroll.boundingBox())!.x,
          )
          .toBeCloseTo(gutter - 8, 0);
      }
      await scroll.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      if (width === 390)
        await expect
          .poll(() =>
            scroll.evaluate((element) => {
              element.scrollLeft = element.scrollWidth;
              return element.scrollLeft;
            }),
          )
          .toBeGreaterThan(0);
      const heading = page.getByRole("columnheader", { name: "From / To" });
      const row = page.getByRole("rowheader", { name: "Red", exact: true });
      for (const label of [heading, row]) {
        const box = await label.boundingBox();
        const container = await scroll.boundingBox();
        expect(Math.abs(box!.x - container!.x)).toBeLessThanOrEqual(1);
        expect(
          await label.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(box.left + 2, box.top + box.height / 2),
            );
          }),
        ).toBe(true);
      }
    });
  });
}

test("mobile tabs clip only the underline at the page gutters", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Production inputs" });
  const jobs = tabs.getByRole("tab", { name: "Jobs", exact: true });
  await expect(jobs).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const gutter = await page
    .locator("#workspace")
    .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
  expect((await tabs.boundingBox())!.x).toBeCloseTo(0, 0);
  expect((await tabs.boundingBox())!.width).toBeCloseTo(390, 0);
  await expect(tabs).toHaveCSS(
    "mask-size",
    /100% calc\(100% - 2px\), calc\(100% - [\d.]+px\) 2px/,
  );
  const maskSize = await tabs.evaluate(
    (element) => getComputedStyle(element).maskSize,
  );
  expect(
    Number(maskSize.match(/calc\(100% - ([\d.]+)px\) 2px$/)![1]),
  ).toBeCloseTo(2 * gutter, 2);
  await tabs.evaluate((element) => {
    element.scrollLeft = 24;
  });
  expect((await jobs.boundingBox())!.x).toBeLessThan(gutter);
  await tabs.screenshot({
    path: testInfo.outputPath("mobile-tab-underline.png"),
  });
});
