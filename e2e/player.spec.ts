import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const basicFrequencies = [
  63, 125, 250, 500, 700, 1000, 2000, 4000, 8000, 16000,
];

async function menuAction(page: Page, menu: string, action: string | RegExp) {
  await page
    .getByRole("navigation", { name: "Player menu" })
    .getByRole("button", { name: menu, exact: true })
    .click();
  await page
    .locator(".dropdown")
    .getByRole("button", { name: action, exact: true })
    .click();
}

async function selectedTrack(page: Page) {
  return page.locator(".track.selected .track-main").getAttribute("aria-label");
}

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
  await expect(page.locator('output[aria-label="echo value"]')).toHaveText(
    "40%",
  );
  for (let index = 0; index < 6; index++)
    await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".digital")).toHaveText("00:00");
  expect(errors).toEqual([]);
});

test("BASIC matches the reference bands and enhanced EQ preserves saved controls", async ({
  page,
}) => {
  await page.goto("/");
  const bands = page.getByRole("slider", { name: /^\d+ Hz$/ });
  await expect(bands).toHaveCount(10);
  expect(
    await bands.evaluateAll((inputs) =>
      inputs.map((input) => input.getAttribute("aria-label")),
    ),
  ).toEqual(basicFrequencies.map((frequency) => `${frequency} Hz`));
  for (const frequency of basicFrequencies) {
    const band = page.getByRole("slider", {
      name: `${frequency} Hz`,
      exact: true,
    });
    await expect(band).toHaveAttribute("min", "-15");
    await expect(band).toHaveAttribute("max", "15");
  }
  const preamp = page.getByRole("slider", { name: "Preamp", exact: true });
  await expect(preamp).toHaveAttribute("min", "-15");
  await expect(preamp).toHaveAttribute("max", "15");
  await preamp.fill("-4");
  await page.getByRole("slider", { name: "63 Hz", exact: true }).fill("15");
  await page.getByRole("slider", { name: "700 Hz", exact: true }).fill("6");
  await page.getByRole("slider", { name: "16000 Hz", exact: true }).fill("-15");
  await page.getByRole("slider", { name: "Stereo balance" }).fill("-0.4");
  await page.getByRole("slider", { name: "Volume", exact: true }).fill("0.42");
  await page.getByRole("button", { name: "Toggle enhanced equalizer" }).click();
  await expect(bands).toHaveCount(18);
  await expect(
    page.getByRole("button", { name: "Toggle enhanced equalizer" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(bands).toHaveCount(18);
  await expect(preamp).toHaveValue("-4");
  await expect(
    page.getByRole("slider", { name: "63 Hz", exact: true }),
  ).toHaveValue("15");
  await expect(
    page.getByRole("slider", { name: "700 Hz", exact: true }),
  ).toHaveValue("6");
  await expect(
    page.getByRole("slider", { name: "16000 Hz", exact: true }),
  ).toHaveValue("-15");
  await expect(
    page.getByRole("slider", { name: "Stereo balance" }),
  ).toHaveValue("-0.4");
  await expect(
    page.getByRole("slider", { name: "Volume", exact: true }),
  ).toHaveValue("0.42");
  await page.getByRole("button", { name: "Toggle enhanced equalizer" }).click();
  await expect(bands).toHaveCount(10);
  await expect(
    page.getByRole("slider", { name: "700 Hz", exact: true }),
  ).toHaveValue("6");
});

test("effects persist, speed and tempo are exclusive, and reset restores neutral DSP", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "EFFECT", exact: true }).click();
  const effects = [
    ["Echo", "0.4", "40%"],
    ["Reverb", "0.3", "30%"],
    ["Chorus", "0.2", "20%"],
    ["Flanger", "0.1", "10%"],
  ] as const;
  for (const [effect, value, output] of effects) {
    await page
      .getByRole("slider", { name: `${effect} amount`, exact: true })
      .fill(value);
    await expect(
      page.locator(`output[aria-label="${effect.toLowerCase()} value"]`),
    ).toHaveText(output);
  }
  const speed = page.getByRole("slider", {
    name: "Speed with pitch",
    exact: true,
  });
  const tempo = page.getByRole("slider", {
    name: "Tempo preserving pitch",
    exact: true,
  });
  await speed.fill("1.5");
  await expect(tempo).toHaveValue("1");
  await tempo.fill("1.25");
  await expect(speed).toHaveValue("1");
  await speed.fill("0.75");
  await expect(tempo).toHaveValue("1");
  await page.reload();
  await page.getByRole("button", { name: "EFFECT", exact: true }).click();
  for (const [effect, value] of effects) {
    await expect(
      page.getByRole("slider", { name: `${effect} amount`, exact: true }),
    ).toHaveValue(value);
  }
  await expect(speed).toHaveValue("0.75");
  await expect(tempo).toHaveValue("1");
  await page
    .getByRole("button", { name: "RESET EFFECTS", exact: true })
    .click();
  for (const [effect] of effects) {
    await expect(
      page.getByRole("slider", { name: `${effect} amount`, exact: true }),
    ).toHaveValue("0");
    await expect(
      page.locator(`output[aria-label="${effect.toLowerCase()} value"]`),
    ).toHaveText("0%");
  }
  await expect(speed).toHaveValue("1");
  await expect(tempo).toHaveValue("1");
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
  await page.getByRole("button", { name: "Toggle enhanced equalizer" }).click();
  await expect(page.getByRole("slider", { name: /^\d+ Hz$/ })).toHaveCount(18);
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

test("View menu restores configuration and playlist from compact mode", async ({
  page,
}) => {
  await page.goto("/");
  await menuAction(page, "View", "Compact player");
  await expect(
    page.getByRole("region", { name: "Audio configuration" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Playlist", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand player" }),
  ).toBeVisible();
  await menuAction(page, "View", "DSP Manager / Sound Effect");
  await expect(
    page.getByRole("region", { name: "Audio configuration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Reverb amount" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse player" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hide playlist" }).click();
  await menuAction(page, "View", "Compact player");
  await menuAction(page, "View", /^Playlist$/);
  await expect(
    page.getByRole("region", { name: "Playlist", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hide equalizer" }).click();
  await menuAction(page, "View", "EQ Equalizer");
  await expect(
    page.getByRole("slider", { name: "700 Hz", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".dropdown")).toHaveCount(0);
});

test("repeat playlist is shared by menu and settings, survives reload, and wraps at the end", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  const repeat = page.getByRole("checkbox", {
    name: "Repeat playlist",
    exact: true,
  });
  await repeat.uncheck();
  await menuAction(page, "Play", /^Repeat playlist$/);
  await expect(repeat).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await expect(repeat).toBeChecked();
  const firstTrack = await page
    .locator(".track-main")
    .first()
    .getAttribute("aria-label");
  await page.locator(".track-main").last().click();
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  const duration = Number(await seek.getAttribute("max"));
  expect(duration).toBeGreaterThan(1);
  await seek.fill((Math.floor(duration * 10) / 10 - 0.2).toFixed(1));
  await expect
    .poll(() => selectedTrack(page), { timeout: 8000 })
    .toBe(firstTrack);
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  await menuAction(page, "Play", /^✓ Repeat playlist$/);
  await expect(repeat).not.toBeChecked();
});

test("shuffle visits each track once and Previous retraces the listening history", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Shuffle", exact: true }).click();
  const visited = [await selectedTrack(page)];
  for (let index = 0; index < 2; index++) {
    await page.getByRole("button", { name: "Next track", exact: true }).click();
    const selected = await selectedTrack(page);
    expect(selected).not.toBeNull();
    expect(visited).not.toContain(selected);
    visited.push(selected);
  }
  expect(new Set(visited).size).toBe(3);
  await page
    .getByRole("button", { name: "Previous track", exact: true })
    .click();
  await expect.poll(() => selectedTrack(page)).toBe(visited[1]);
  await page
    .getByRole("button", { name: "Previous track", exact: true })
    .click();
  await expect.poll(() => selectedTrack(page)).toBe(visited[0]);
});

test("A–B repeat loops the selected interval and clears when changing tracks", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".transport")
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  await seek.fill("1");
  await page.getByRole("button", { name: "SET A", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "SET B", exact: true }),
  ).toBeVisible();
  await seek.fill("3");
  await page.getByRole("button", { name: "SET B", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "CLEAR A–B", exact: true }),
  ).toBeVisible();
  await page
    .locator(".transport")
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await expect
    .poll(async () => Number(await seek.inputValue()))
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "CLEAR A–B", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "SET A", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "SET A", exact: true }).click();
  await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "SET A", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".settings-grid")).toContainText("A–B: off");
});

test("preset labels follow the complete saved curve through reload, reset, save and delete", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "EQ PRES", exact: true }).click();
  const currentPreset = page.getByTestId("current-preset");
  await expect(currentPreset).toHaveText("Flat");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Warm (web)", exact: true })
    .click();
  await expect(currentPreset).toHaveText("Warm (web)");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "EQ PRES", exact: true }).click();
  await expect(currentPreset).toHaveText("Warm (web)");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Toggle enhanced equalizer" }).click();
  await page.getByRole("slider", { name: "31 Hz", exact: true }).fill("7");
  await page.getByRole("slider", { name: "63 Hz", exact: true }).fill("4");
  await page.getByRole("slider", { name: "Preamp", exact: true }).fill("-5");
  await page.getByRole("button", { name: "Toggle enhanced equalizer" }).click();
  await page.getByRole("button", { name: "PRESETS", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "eqmenu", exact: true }),
  ).toBeVisible();
  await expect(currentPreset).toHaveText("Custom");
  await page
    .getByRole("textbox", { name: "Preset name", exact: true })
    .fill("Night listening");
  await page
    .getByRole("button", { name: "Save current preset", exact: true })
    .click();
  await expect(currentPreset).toHaveText("Night listening");
  await page.getByRole("button", { name: "Reset EQ", exact: true }).click();
  await expect(currentPreset).toHaveText("Flat");
  await page
    .getByRole("button", { name: "Choose preset", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "presets", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Night listening", exact: true })
    .click();
  await expect(currentPreset).toHaveText("Night listening");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("slider", { name: "Preamp", exact: true }),
  ).toHaveValue("-5");
  await expect(
    page.getByRole("slider", { name: "63 Hz", exact: true }),
  ).toHaveValue("4");
  await page.getByRole("button", { name: "Toggle enhanced equalizer" }).click();
  await expect(
    page.getByRole("slider", { name: "31 Hz", exact: true }),
  ).toHaveValue("7");

  await page.reload();
  await page.getByRole("button", { name: "EQ PRES", exact: true }).click();
  await expect(currentPreset).toHaveText("Night listening");
  await page
    .getByRole("button", { name: "Delete preset Night listening", exact: true })
    .click();
  await expect(currentPreset).toHaveText("Custom");
  await expect(
    page.getByRole("button", { name: "Night listening", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "PRESETS", exact: true }).click();
  await expect(currentPreset).toHaveText("Custom");
  await expect(
    page.getByRole("button", { name: "Night listening", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reset EQ", exact: true }).click();
  await expect(currentPreset).toHaveText("Flat");
  await page.keyboard.press("Escape");
  for (const band of await page
    .getByRole("slider", { name: /^\d+ Hz$/ })
    .all()) {
    await expect(band).toHaveValue("0");
  }
  await expect(
    page.getByRole("slider", { name: "Preamp", exact: true }),
  ).toHaveValue("0");
});

test("sleep timer can be cancelled, pauses playback when due, and is session-only", async ({
  page,
}) => {
  const startTime = new Date("2026-10-06T12:00:00Z");
  // Change Date without freezing real media playback or requestAnimationFrame.
  await page.clock.setFixedTime(startTime);
  await page.goto("/");
  await page
    .locator(".transport")
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await expect(page.locator(".under-player")).toContainText("Playing locally");
  await menuAction(page, "Options", "Shutdown settings (sleep timer)");
  const timer = page.getByRole("combobox", {
    name: "Sleep timer",
    exact: true,
  });
  await expect(timer).toHaveValue("off");
  await timer.selectOption("15");
  await expect(timer).toHaveValue("active");
  await timer.selectOption("off");
  await expect(timer).toHaveValue("off");
  await timer.selectOption("5");
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-grid")).toContainText("Sleep: 5:00");
  await page.clock.setFixedTime(new Date(startTime.getTime() + 301000));
  await expect(page.locator(".under-player")).toContainText(
    "Sleep timer paused playback.",
  );
  await expect(page.locator(".status-light")).not.toHaveClass(/playing/);
  await expect(page.locator(".settings-grid")).toContainText("Sleep: off");
  await page.getByRole("button", { name: "SLEEP TIMER", exact: true }).click();
  await expect(timer).toHaveValue("off");
  await timer.selectOption("30");
  await expect(timer).toHaveValue("active");
  await page.reload();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await expect(page.locator(".settings-grid")).toContainText("Sleep: off");
});
