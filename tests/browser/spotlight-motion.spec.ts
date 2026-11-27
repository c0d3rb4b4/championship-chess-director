import { expect, test, type Page } from "@playwright/test";
import { Director } from "../../src/server/director.js";
import { demo } from "../../src/server/fixtures.js";
import type { ProgrammeSnapshot } from "../../src/shared/types.js";
import { programmeStream } from "./programme-stream.js";

const fullPath = Array.from({ length: 100 }, (_, i) => i / 100).concat(0.999);

async function openProgramme(page: Page, initial: ProgrammeSnapshot) {
  const send = await programmeStream(page, initial);
  await page.route("**/api/programme", route => route.fulfill({ json: initial }));
  await page.goto("/programme");
  await expect(page.getByTestId("actual-board")).toHaveAttribute("data-fen", initial.actual.fen);
  await expect(page.locator(".connection-banner")).toBeHidden();
  return send;
}

async function sampleMotion(page: Page, fractions?: number[], holdAt?: number) {
  return page.getByTestId("programme").evaluate(async (programme, { fractions, holdAt }) => {
    const animations = fractions === undefined ? [] : programme.getAnimations({ subtree: true });
    const movements = animations.filter(animation => {
      const effect = animation.effect;
      return effect instanceof KeyframeEffect &&
        effect.target?.matches(".actual-game, .actual-board-wrap, .spotlight-layer");
    });
    await Promise.all(movements.map(animation => animation.ready));
    const timings = movements.map(animation => {
      const { delay, duration, easing } = animation.effect!.getTiming();
      return { delay, duration, easing, startTime: animation.startTime };
    });

    const duration = timings[0]?.duration;
    function seek(fraction: number) {
      if (typeof duration !== "number") return;
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = duration * fraction;
      }
    }

    function isPainted(element: Element) {
      for (let node: Element | null = element; node && node !== programme; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
      }
      return true;
    }

    function readPose() {
      const board = programme.querySelector('[data-testid="actual-board"]')!;
      const actual = board.getBoundingClientRect();
      const analysis = programme.querySelector(".analysis-region .analysis-board")?.getBoundingClientRect();
      const tint = [...board.querySelectorAll("[data-last-move-square]")]
        .filter(isPainted)
        .map(mark => mark.getAttribute("data-last-move-square"))
        .sort();
      const movePanel = programme.querySelector(".last-move");
      return {
        actual: { x: actual.x, y: actual.y, width: actual.width },
        analysisX: analysis?.left,
        gap: analysis && analysis.left - actual.right,
        screenRight: programme.getBoundingClientRect().right,
        tint,
        showMove: movePanel !== null && isPainted(movePanel),
      };
    }

    const poses = fractions?.map(fraction => {
      seek(fraction);
      return readPose();
    }) ?? [readPose()];
    if (holdAt !== undefined) seek(holdAt);
    return { poses, timings };
  }, { fractions, holdAt });
}

function expectSynchronized(timings: Awaited<ReturnType<typeof sampleMotion>>["timings"]) {
  expect(timings).toHaveLength(3);
  const [timing] = timings;
  expect(typeof timing.startTime).toBe("number");
  expect(timing.delay).toBe(0);
  for (const other of timings) expect(other).toEqual(timing);
  expect(typeof timing.duration).toBe("number");
  return timing;
}

function expectSeparated(poses: Awaited<ReturnType<typeof sampleMotion>>["poses"]) {
  expect(Math.min(...poses.map(({ gap }) => gap ?? -Infinity))).toBeGreaterThan(1);
}

function expectSmoothStop(path: number[]) {
  const direction = Math.sign(path.at(-1)! - path[0]);
  expect(direction).not.toBe(0);
  const travel = path.slice(1).map((value, i) => (value - path[i]) * direction);
  expect(Math.min(...travel)).toBeGreaterThanOrEqual(-0.02);
  const middleTravel = Math.abs(path[55] - path[45]);
  const lastTravel = Math.abs(path.at(-1)! - path[90]);
  expect(lastTravel).toBeLessThan(middleTravel);
}

async function finishMotion(page: Page) {
  await page.getByTestId("programme").evaluate(programme => {
    for (const animation of programme.getAnimations({ subtree: true })) animation.finish();
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`spotlight boards move together with a gap at ${viewport.height}p`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const director = new Director();
    const initial = director.advanceTo(demo.spotlightAtMs - 1);
    const send = await openProgramme(page, initial);
    const actual = page.getByTestId("actual-board");
    const originalBoard = await actual.elementHandle();
    const clockStrip = page.locator(".programme-header .players");
    const clocks = await clockStrip.boundingBox();
    const played = page.locator(".played-moves");
    const initialMoves = await played.textContent();
    const { poses: [normal] } = await sampleMotion(page);

    await send(director.advanceTo(demo.spotlightAtMs));
    const entry = await sampleMotion(page, fullPath, 0.45);
    const entryTiming = expectSynchronized(entry.timings);
    expect(entry.poses[0].actual.width).toBeCloseTo(normal.actual.width, 1);
    expect(entry.poses[0].analysisX).toBeCloseTo(normal.screenRight, 1);
    expectSeparated(entry.poses);
    expectSmoothStop(entry.poses.map(pose => pose.actual.width));
    expectSmoothStop(entry.poses.map(pose => pose.analysisX!));

    await send(director.advanceTo(demo.spotlightAtMs + 2000));
    await expect(page.locator(".analysis-board")).toHaveAttribute("data-frame", "1");
    await finishMotion(page);
    const { poses: [spotlight] } = await sampleMotion(page);
    expect(spotlight.actual.width).toBeLessThan(normal.actual.width);
    expect(spotlight.actual.y).toBeGreaterThan(normal.actual.y);
    await expect(page.getByTestId("analysis-board")).toBeInViewport({ ratio: .999 });

    await send(director.command("return-live"));
    const exit = await sampleMotion(page, fullPath);
    const exitTiming = expectSynchronized(exit.timings);
    expect(exitTiming.duration).toEqual(entryTiming.duration);
    expect(exitTiming.easing).toEqual(entryTiming.easing);
    expect(exit.poses[0].actual.width).toBeCloseTo(spotlight.actual.width, 1);
    expect(exit.poses[0].analysisX).toBeCloseTo(spotlight.analysisX!, 1);
    expect(exit.poses.at(-1)!.analysisX).toBeCloseTo(normal.screenRight, 1);
    expectSeparated(exit.poses);
    expectSmoothStop(exit.poses.map(pose => pose.actual.width));
    expectSmoothStop(exit.poses.map(pose => pose.analysisX!));
    await expect(page.getByTestId("analysis-board")).toHaveCount(0);

    await finishMotion(page);
    await expect(page.locator(".analysis-region")).toHaveCount(0);
    expect((await sampleMotion(page)).poses[0].actual).toEqual(normal.actual);
    expect(await originalBoard!.evaluate(board => board.isConnected)).toBe(true);
    expect(await clockStrip.boundingBox()).toEqual(clocks);
    await expect(played).toHaveText(initialMoves!);
    await expect(actual).toHaveAttribute("data-fen", initial.actual.fen);
  });
}

for (const phase of ["settled", "entering", "returning"] as const) {
  test(`a played move uses a faster return while the spotlight is ${phase}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const director = new Director();
    const initial = director.advanceTo(demo.spotlightAtMs + (phase === "entering" ? -1 : 2000));
    const send = await openProgramme(page, initial);
    let ordinaryDuration = 1050;
    if (phase === "entering" || phase === "returning") {
      await send(phase === "entering"
        ? director.advanceTo(demo.spotlightAtMs)
        : director.command("return-live"));
      const active = await sampleMotion(page, [0.35]);
      ordinaryDuration = Number(expectSynchronized(active.timings).duration);
    }
    const { poses: [before] } = await sampleMotion(page);

    const played = director.command("release-move");
    await send(played);
    await expect(page.getByTestId("programme")).toHaveAttribute("data-scene", "actual-move");
    await expect(page.getByTestId("actual-board")).toHaveAttribute("data-fen", played.actual.fen);
    await expect(page.getByTestId("analysis-board")).toHaveCount(0);
    const interrupted = await sampleMotion(page, fullPath);
    const timing = expectSynchronized(interrupted.timings);
    expect(Number(timing.duration)).toBeLessThan(ordinaryDuration);
    expect(Number(timing.duration)).toBeGreaterThan(ordinaryDuration / 2);
    expect(interrupted.poses[0].actual.width).toBeCloseTo(before.actual.width, 1);
    expect(interrupted.poses[0].analysisX).toBeCloseTo(before.analysisX!, 1);
    expectSeparated(interrupted.poses);
    expect(interrupted.poses.flatMap(pose => pose.tint)).toEqual([]);
    expect(interrupted.poses.some(pose => pose.showMove)).toBe(false);

    await finishMotion(page);
    await expect(page.locator(".analysis-region")).toHaveCount(0);
    await expect.poll(async () => (await sampleMotion(page)).poses[0].tint).toEqual(["d3", "d4"]);
    await expect(page.locator(".last-move strong")).toHaveText("10.d4");
    expect((await sampleMotion(page)).poses[0].actual.width).toBeCloseTo(768, 1);
  });
}
