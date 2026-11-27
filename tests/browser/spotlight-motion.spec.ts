import { expect, test, type Page } from "@playwright/test";
import { Director } from "../../src/server/director.js";
import { demo } from "../../src/server/fixtures.js";
import { programmeStream } from "./programme-stream.js";

async function pose(page: Page, fraction?: number) {
  return page.getByTestId("programme").evaluate((programme, fraction) => {
    const animations = fraction === undefined ? [] : programme.getAnimations({ subtree: true });
    for (const animation of animations) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (fraction === undefined || typeof end !== "number" || end <= 0 || !Number.isFinite(end)) continue;
      animation.pause();
      animation.currentTime = end * fraction;
    }
    const actual = programme.querySelector('[data-testid="actual-board"]')!.getBoundingClientRect();
    const line = programme.querySelector(".analysis-region")?.getBoundingClientRect();
    return {
      actual: { x: actual.x, y: actual.y, width: actual.width },
      analysisX: line?.x,
      screenRight: programme.getBoundingClientRect().right,
    };
  }, fraction);
}

async function finishMotion(page: Page) {
  await page.getByTestId("programme").evaluate(programme => {
    for (const animation of programme.getAnimations({ subtree: true })) animation.finish();
  });
}

test("spotlight boards travel through the frame and return to the same actual position", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const director = new Director();
  const initial = director.advanceTo(demo.spotlightAtMs - 1);
  const send = await programmeStream(page, initial);
  await page.route("**/api/programme", route => route.fulfill({ json: initial }));
  await page.goto("/programme");
  const actual = page.getByTestId("actual-board");
  await expect(actual).toHaveAttribute("data-fen", initial.actual.fen);
  const originalBoard = await actual.elementHandle();
  const clockStrip = page.locator(".programme-header .players");
  const clocks = await clockStrip.boundingBox();
  const played = page.locator(".played-moves");
  const initialMoves = await played.textContent();
  const normal = await pose(page);

  await send(director.advanceTo(demo.spotlightAtMs));
  const entry = await pose(page, 0);
  expect(entry.actual.width).toBeCloseTo(normal.actual.width, 1);
  expect(entry.analysisX).toBeGreaterThanOrEqual(entry.screenRight);
  const midEntry = await pose(page, 0.45);
  expect(midEntry.actual.width).toBeLessThan(entry.actual.width);
  expect(midEntry.analysisX).toBeLessThan(entry.analysisX!);

  await send(director.advanceTo(demo.spotlightAtMs + 2000));
  await expect(page.locator(".analysis-board")).toHaveAttribute("data-frame", "1");
  await finishMotion(page);
  const spotlight = await pose(page);
  expect(spotlight.actual.width).toBeLessThan(midEntry.actual.width);
  expect(spotlight.actual.y).toBeGreaterThan(normal.actual.y);
  expect(spotlight.analysisX).toBeLessThan(spotlight.screenRight);
  await expect(page.getByTestId("analysis-board")).toBeInViewport({ ratio: .999 });

  await send(director.command("return-live"));
  const exit = await pose(page, 0);
  expect(exit.actual.width).toBeCloseTo(spotlight.actual.width, 1);
  expect(exit.analysisX).toBeCloseTo(spotlight.analysisX!, 1);
  await expect(page.getByTestId("analysis-board")).toHaveCount(0);
  const midExit = await pose(page, 0.45);
  expect(midExit.actual.width).toBeGreaterThan(exit.actual.width);
  expect(midExit.analysisX).toBeGreaterThan(exit.analysisX!);
  const endExit = await pose(page, 0.999);
  expect(endExit.analysisX).toBeGreaterThanOrEqual(endExit.screenRight);
  await finishMotion(page);
  await expect(page.locator(".analysis-region")).toHaveCount(0);
  expect((await pose(page)).actual).toEqual(normal.actual);
  expect(await originalBoard!.evaluate(board => board.isConnected)).toBe(true);
  expect(await clockStrip.boundingBox()).toEqual(clocks);
  await expect(played).toHaveText(initialMoves!);
  await expect(actual).toHaveAttribute("data-fen", initial.actual.fen);
});

test("a played move clears a departing analysis board immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const director = new Director();
  const initial = director.advanceTo(demo.spotlightAtMs + 2000);
  const send = await programmeStream(page, initial);
  await page.route("**/api/programme", route => route.fulfill({ json: initial }));
  await page.goto("/programme");
  await expect(page.getByTestId("analysis-board")).toBeInViewport({ ratio: .999 });
  await send(director.command("return-live"));
  expect((await pose(page, 0.3)).analysisX).toBeDefined();

  const played = director.command("release-move");
  await send(played);
  await expect(page.getByTestId("programme")).toHaveAttribute("data-scene", "actual-move");
  await expect(page.locator(".analysis-region")).toHaveCount(0);
  await expect(page.getByTestId("actual-board")).toHaveAttribute("data-fen", played.actual.fen);
  expect((await pose(page)).actual.width).toBeCloseTo(768, 1);
});
