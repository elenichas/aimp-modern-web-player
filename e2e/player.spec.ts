import { test, expect } from "@playwright/test";

test("plays, seeks, applies EQ and effects, and survives repeated track changes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(3);
  await expect(page.locator(".digital")).toHaveText("00:00");
  await page
    .locator(".transport")
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  await expect(page.locator(".digital")).not.toHaveText("00:00");
  await page.screenshot({
    path: testInfo.outputPath("desktop-player.png"),
    fullPage: true,
  });
  await page.getByRole("slider", { name: "Seek", exact: true }).fill("10");
  await expect(page.locator(".digital")).toContainText("0:1");
  await page.getByRole("slider", { name: "1000 Hz", exact: true }).fill("6");
  await page.getByRole("button", { name: "Enable equalizer" }).click();
  await expect(
    page.getByRole("button", { name: "Enable equalizer" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Enable equalizer" }).click();
  await page.getByRole("button", { name: "EFFECT", exact: true }).click();
  await page.getByRole("slider", { name: "Echo amount" }).fill("0.4");
  await expect(page.locator("output")).toHaveText("40%");
  for (let index = 0; index < 6; index++)
    await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".digital")).toHaveText("00:00");
  expect(errors).toEqual([]);
});

test("library search, dialog dismissal, panel restoration and mobile fit", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Music library", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search library" }).fill("soft");
  await expect(page.locator(".library-list button")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Hide equalizer" }).click();
  await expect(
    page.getByRole("region", { name: "Audio configuration" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle configuration" }).click();
  await expect(
    page.getByRole("region", { name: "Audio configuration" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-player.png"),
    fullPage: true,
  });
});
