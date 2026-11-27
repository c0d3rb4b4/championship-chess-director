import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { Director } from "../../src/server/director.js";
import type { ProgrammeSnapshot } from "../../src/shared/types.js";
import { programmeStream } from "./programme-stream.js";

test("ordinary panels fit both broadcast sizes with typical, missing and extended values", { tag: "@review-captures" }, async ({page}) => {
  test.setTimeout(90000);
  const dir = "test-results/provider-screenshots/statistics";
  await mkdir(dir, { recursive: true });
  let snapshot: ProgrammeSnapshot;
  await page.route("**/api/programme", route => route.fulfill({json:snapshot}));
  for (const [panel, atMs] of [["outcomes",20000],["time",38000],["search",58000],["history",156000]] as const) {
    for (const variant of ["typical","missing","long"]) {
      snapshot = new Director().advanceTo(atMs);
      expect(snapshot.panel).toBe(panel);
      snapshot.sequence = Number.MAX_SAFE_INTEGER;
      if (variant === "missing") {
        if (panel === "outcomes") snapshot = {...new Director().advanceTo(90000), sequence: snapshot.sequence};
        if (panel === "time") snapshot.moveTimes[14].elapsedMs = null;
        if (panel === "search") snapshot.engines[0] = new Director().advanceTo(83000).engines[0];
        if (panel === "history") delete snapshot.history[0].leela;
      } else if (variant === "long") {
        if (panel === "outcomes") snapshot.engines[1].wdl = [0.1,99.9,0];
        if (panel === "time") snapshot.moveTimes[14].elapsedMs = 5800000;
        if (panel === "search") snapshot.engines[0].work = 1234567890123;
        if (panel === "history") snapshot.history[0].sesse!.pawns = -12.85;
      }
      await page.goto("/programme");
      await expect(page.locator(".connection-banner")).toBeHidden();
      for (const height of [1080,720]) {
        await page.setViewportSize({width: height*16/9,height});
        await expect(page.getByTestId("actual-board")).toBeInViewport({ratio:.999});
        await expect(page.locator(".players")).toBeInViewport({ratio:.999});
        await expect(page.locator(".played-moves")).toBeInViewport({ratio:.999});
        if (snapshot.panel === "comparison") await expect(page.locator(".wdl")).toHaveCount(0);
        else {
          const card = page.locator(`[data-panel="${panel}"]`);
          await expect(card).toBeVisible();
          expect(await card.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
          const axes = panel === "time" ? ["Minutes on completed moves"] :
            panel === "history" ? ["Pawns", "Leela · Probability (%)"] : [];
          for (const name of axes) {
            const plot = card.getByRole("img", { name, exact: true });
            await expect(plot).toBeVisible();
            await expect(plot.locator("circle").first()).toBeVisible();
          }
        }
        await page.screenshot({path:`${dir}/${panel}-${variant}-${height}.jpg`, quality:80});
      }
    }
  }
});

test("panel transitions preserve the board and clocks and yield immediately to the played move", async ({page}) => {
  // Inject ordered observations into the same listener used by the live SSE connection.
  const send = await programmeStream(page);
  for (const motion of ["reduce","no-preference"] as const) {
    await page.emulateMedia({reducedMotion:motion});
    for (const time of [20000,38000,58000,74000]) {
      const director = new Director();
      const initial = director.advanceTo(time-1);
      await page.route("**/api/programme",route => route.fulfill({json:initial}));
      await page.goto("/programme");
      const board = page.getByTestId("actual-board");
      await expect(board).toBeVisible();
      const originalBoard = await board.elementHandle();
      const strip = page.locator(".players");
      const bounds = await strip.boundingBox();
      const entering = director.advanceTo(time);
      await send(entering);
      await expect(page.locator("[data-panel]")).toHaveAttribute("data-panel",entering.panel);
      expect(await originalBoard!.evaluate(el => el.isConnected)).toBe(true);
      const card = page.locator(".comparison-panel");
      const entrance = await card.evaluateHandle(el => el.getAnimations()[0] ?? null);
      if (motion === "reduce") expect(await entrance.jsonValue()).toBeNull();
      await send(director.advanceTo(time+1));
      expect(await card.evaluate((el, original) =>
        el.getAnimations().every(a => a === original), entrance)).toBe(true);
      await send(director.command("release-move"));
      await expect(page.getByTestId("programme")).toHaveAttribute("data-scene","actual-move");
      await expect(page.locator("[data-panel]")).toHaveCount(0);
      expect(await strip.boundingBox()).toEqual(bounds);
      await page.unroute("**/api/programme");
    }
  }
});
