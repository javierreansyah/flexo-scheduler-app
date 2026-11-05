import { test, expect } from "@playwright/test";
test("CRT hover, processing color and cancellation return to idle", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const clocks: number[] = [];
    Object.assign(window, { crtClocks: clocks });
    const seen = new WeakSet<HTMLCanvasElement>();
    const tracked = new WeakSet<WebGLUniformLocation>();
    const prototype = WebGL2RenderingContext.prototype;
    const getUniformLocation = prototype.getUniformLocation;
    const uniform1f = prototype.uniform1f;
    prototype.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      const canvas = this.canvas;
      if (
        location &&
        name === "uTime" &&
        canvas instanceof HTMLCanvasElement &&
        canvas.closest('[data-slot="optimize-control"]') &&
        !seen.has(canvas)
      ) {
        seen.add(canvas);
        tracked.add(location);
      }
      return location;
    };
    prototype.uniform1f = function (location, value) {
      if (location && tracked.has(location)) clocks.push(value);
      uniform1f.call(this, location, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  const button = page.locator('[data-slot="optimize-control"] button'),
    control = page.locator('[data-slot="optimize-control"]');
  await expect(button).toBeEnabled();
  await expect(control).toHaveAttribute("data-phase", "idle");
  await button.hover();
  await expect(control).toHaveAttribute("data-phase", "active");
  await expect(control.locator("canvas")).toHaveCount(1);
  await expect
    .poll(() =>
      control
        .locator("canvas")
        .evaluate(
          (canvas) =>
            canvas instanceof HTMLCanvasElement &&
            canvas.height ===
              Math.max(
                1,
                Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)),
              ),
        ),
    )
    .toBe(true);
  async function capture(name: string) {
    const box = await control.boundingBox();
    if (!box) throw Error("Missing Optimize button bounds");
    await page.screenshot({
      path: info.outputPath(name),
      clip: {
        x: Math.max(0, box.x - 16),
        y: Math.max(0, box.y - 28),
        width: box.width + 32,
        height: box.height + 56,
      },
    });
  }
  async function expectContinuousClock() {
    await page.evaluate(() => {
      (window as unknown as { crtClocks: number[] }).crtClocks.length = 0;
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { crtClocks: number[] }).crtClocks.length,
        ),
      )
      .toBeGreaterThanOrEqual(30);
    const clocks = await page.evaluate(
      () => (window as unknown as { crtClocks: number[] }).crtClocks,
    );
    for (let index = 1; index < clocks.length; index++)
      expect(clocks[index]).toBeGreaterThan(clocks[index - 1]);
  }
  await expectContinuousClock();
  await capture("crt-hover.png");
  await page.getByRole("button", { name: "Add Job", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Job" });
  await dialog.getByLabel("Job ID", { exact: true }).fill("Order A");
  await dialog.getByLabel("Quantity", { exact: true }).fill("1200");
  await dialog.getByLabel("Inks", { exact: true }).fill("red");
  await page.getByRole("option", { name: "Red", exact: true }).click();
  await dialog.getByRole("button", { name: "Add Job", exact: true }).click();
  await page.getByRole("combobox", { name: "Speed Preset" }).click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.getByRole("tab", { name: "Project", exact: true }).click();
  await page.getByLabel("Evaluations", { exact: true }).fill("1000000000");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await button.click();
  await expect(control).toHaveAttribute("data-phase", "busy");
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveText(/Cancel · \d+%/);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(1);
  await expectContinuousClock();
  await capture("crt-processing.png");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(control).toHaveAttribute("data-phase", "idle");
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
test("touch hold previews without starting and reduced motion skips GPU effects", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Industry Example" }).click();
  const button = page.locator('[data-slot="optimize-control"] button'),
    control = page.locator('[data-slot="optimize-control"]');
  await expect(button).toBeEnabled();
  await button.dispatchEvent("pointerdown", {
    pointerType: "touch",
    isPrimary: true,
    button: 0,
  });
  await expect(control).toHaveAttribute("data-phase", "active");
  await expect(button).toHaveAttribute("aria-busy", "false");
  await expect(control.locator(".crt-button-surface")).toBeHidden();
  await button.dispatchEvent("pointercancel", { pointerType: "touch" });
  await expect(control).toHaveAttribute("data-phase", "idle");
  await page.keyboard.press("Tab");
  await button.focus();
  await expect(control).toHaveAttribute("data-phase", "active");
  await button.blur();
  await expect(control).toHaveAttribute("data-phase", "idle");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await button.dispatchEvent("pointerdown", {
    pointerType: "touch",
    isPrimary: true,
    button: 0,
  });
  await expect(control).toHaveAttribute("data-phase", "active");
  await expect
    .poll(() =>
      control
        .locator("canvas")
        .evaluate(
          (canvas) =>
            canvas instanceof HTMLCanvasElement &&
            canvas.height ===
              Math.max(
                1,
                Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)),
              ),
        ),
    )
    .toBe(true);
  await button.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(control).toHaveAttribute("data-phase", "idle");
  await expect(button).toHaveAttribute("aria-busy", "false");
});
