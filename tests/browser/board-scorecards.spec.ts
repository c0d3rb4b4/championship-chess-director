import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { Director } from "../../src/server/director.js";
import { demo } from "../../src/server/fixtures.js";
import { programmeStream } from "./programme-stream.js";

test("capture board-side player rows and both evaluation bars", { tag: "@review-captures" }, async ({ page }) => {
  const dir = "test-results/provider-screenshots/scorecards";
  await mkdir(dir, { recursive: true });
  const director = new Director();
  const comparison = director.advanceTo(6000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/programme", route => route.fulfill({ json: comparison }));
  const send = await programmeStream(page);
  await page.goto("/programme");
  const actual = page.getByTestId("actual-board");
  const black = page.getByRole("group", { name: "Black", exact: true });
  const white = page.getByRole("group", { name: "White", exact: true });
  const stockfish = page.locator(".pawn-bar i");
  const leela = page.locator(".leela .wdl");
  await expect(black).toContainText(demo.black);
  await expect(white).toContainText(demo.white);
  for (const [row, country] of [[black, demo.blackCountry], [white, demo.whiteCountry]] as const) {
    await expect.poll(() => row.getByRole("img", { name: country }).evaluate(
      img => (img as HTMLImageElement).naturalWidth,
    )).toBeGreaterThan(0);
  }
  await expect(stockfish).toHaveAttribute("style", `width:${50 + comparison.engines[0].pawns! * 10}%`);
  await expect(leela.locator(".wdl-values > div")).toHaveText([/White win\s*30%/, /Draw\s*50%/, /Black win\s*20%/]);
  await expect(leela.locator(".wdl-bar i").nth(1)).toHaveAttribute("style", "width:50%");

  for (const [scene, width] of [["comparison", 768], ["spotlight", 416]] as const) {
    if (scene === "spotlight") {
      await send(director.advanceTo(77000));
      await expect(page.getByTestId("analysis-board")).toBeVisible();
    }
    for (const height of [1080, 720]) {
      await page.setViewportSize({ width: height * 16 / 9, height });
      const board = (await actual.boundingBox())!;
      expect(board.width).toBeCloseTo(width * height / 1080, 1);
      for (const row of [black, white]) {
        await expect(row).toBeInViewport({ ratio: .999 });
        const bounds = (await row.boundingBox())!;
        expect(bounds.x).toBeCloseTo(board.x, 1);
        expect(bounds.width).toBeCloseTo(board.width, 1);
      }
      const top = (await black.boundingBox())!;
      expect(top.y + top.height).toBeLessThan(board.y);
      expect((await white.boundingBox())!.y).toBeGreaterThan(board.y + board.height);
      await page.screenshot({ path: `${dir}/${scene}-${height}.png` });
    }
  }
  const played = director.command("release-move");
  await send(played);
  await expect(black).toHaveClass(/running/);
  await expect(stockfish).toHaveCount(0);
  await expect(leela).toHaveCount(0);

  const next = director.advanceTo(91000);
  next.engines[0].pawns = -2.3;
  next.engines[0].score = "-2.30";
  await send(next);
  await expect(stockfish).toHaveAttribute("style", "width:27%");
  await expect(leela).toHaveCount(0);
});
