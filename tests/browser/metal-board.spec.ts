import { programmeStream } from "./programme-stream.js";
import { test, expect } from "@playwright/test";
import { Chess } from "chess.js";
import { board } from "../../src/client/board.js";
import { Director } from "../../src/server/director.js";
import { boardFrame } from "../../src/server/fixtures.js";
import type { BoardFrame, ProgrammeSnapshot } from "../../src/shared/types.js";

const pieceTypes = ["p", "n", "b", "r", "q", "k"];

test("all twelve vectors on both materials at full and compact scale", async ({ page }) => {
  const frame: BoardFrame = { fen: "", moveLabel: "piece comparison", san: "", pieces: [] };
  for (const [row, color] of (["w", "w", "b", "b"] as const).entries()) {
    for (const [index, type] of pieceTypes.entries()) {
      frame.pieces.push({ color, type, square: String.fromCharCode(98 + index) + (7 - row) });
    }
  }
  const sample = (id: "actual" | "analysis") =>
    board(frame, id).replace('viewBox="0 0 800 800"', 'viewBox="100 100 600 400"');
  await page.route("**/piece-review", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
      <style>
        body { background: #101010; }
        article { padding: 28px; width: max-content; }
        h1 { font-size: 26px; } p { margin-top: 7px; color: #ced5da; }
        .samples { display: flex; align-items: flex-start; gap: 32px; margin-top: 24px; }
        h2 { font-size: 16px; margin-bottom: 9px; }
        .full { width: 576px; }
        .mini-board { width: 208px; height: auto; margin: 0; }
      </style>
      <article><h1>Metal board · Piece comparison</h1>
        <p>Pawn, knight, bishop, rook, queen, king · White above Black</p>
        <div class="samples">
          <section class="full"><h2>Main board · 1080p</h2>${sample("actual")}</section>
          <section class="mini-board"><h2>Compact board · 720p</h2>${sample("analysis")}</section>
        </div>
      </article>`,
  }));
  await page.goto("/piece-review");
  for (const id of ["actual", "analysis"] as const) {
    const set = page.getByTestId(`${id}-board`);
    await expect(set.locator("use")).toHaveCount(24);
    for (const side of ["w", "b"]) {
      for (const type of pieceTypes) {
        const glyphs = set.locator(`use[href="#${id}-${side}${type}"]`);
        await expect(glyphs).toHaveCount(2);
        for (const glyph of await glyphs.all()) await expect(glyph).toBeInViewport();
      }
    }
  }
  await page.locator("article").screenshot({ path: "docs/evidence/metal-piece-comparison.png" });
});

test("review a starting position and sparse endgame at both output sizes", async ({ page }) => {
  const director = new Director();
  const starting = new Chess();
  const endgame = new Chess("4k3/5p2/1r6/8/3P4/2N2B2/8/4K2R w - - 0 1");
  endgame.move("Nd5");
  const sparse = boardFrame(endgame);
  endgame.move("Rb1+");
  const reply = boardFrame(endgame);
  let snapshot: ProgrammeSnapshot;
  const sendSnapshot = await programmeStream(page);
  await page.route("**/api/programme", (route) => route.fulfill({ json: snapshot }));
  for (const [name, actual, ply, moves] of [
    ["starting", boardFrame(starting), 0, []],
    ["endgame", sparse, 1, ["Nd5"]],
    ["endgame-spotlight", sparse, 1, ["Nd5"]],
  ] as const) {
    const compact = name === "endgame-spotlight";
    snapshot = director.advanceTo(compact ? 77000 : 6000);
    snapshot.actual = actual;
    snapshot.game = {
      ...snapshot.game,
      ply,
      moves: [...moves],
      opening: name === "starting" ? "Starting position" : "Endgame",
      turn: name === "starting" ? "w" : "b",
    };
    // This is a visual fixture with one legal reply. Use no engine claims from the demo root.
    snapshot.engines = snapshot.engines.map(({ id, name, source, scoreLabel }) =>
      ({ id, name, source, scoreLabel, score: "", status: "Updating for this position", candidates: [] }));
    if (compact) snapshot.scene = { ...snapshot.scene, frames: [sparse, reply], frameIndex: 1 };
    await page.goto("/programme");
    await sendSnapshot(snapshot);
    const actualBoard = page.getByTestId("actual-board");
    const analysis = page.getByTestId("analysis-board");
    await expect(actualBoard).toHaveAttribute("data-fen", actual.fen);
    await expect(page.locator(".connection-banner")).toBeHidden();
    await expect(actualBoard.locator("use")).toHaveCount(name === "starting" ? 32 : 8);
    await expect(actualBoard.locator(".coord")).toHaveCount(16);
    if (compact) {
      await expect(analysis).toHaveAttribute("data-fen", reply.fen);
      await expect(analysis.locator('[data-last-move-square="b1"]')).toHaveCount(1);
      await expect(actualBoard.locator('[data-last-move-square="d5"]')).toHaveCount(1);
    }
    for (const height of [1080, 720]) {
      await page.setViewportSize({ width: height * 16 / 9, height });
      await expect(actualBoard).toBeInViewport({ ratio: 0.999 });
      await expect.poll(async () => (await actualBoard.boundingBox())?.width)
        .toBeCloseTo((compact ? 416 : 768) * height / 1080, 1);
      if (compact) {
        await expect(analysis).toBeInViewport({ ratio: 0.999 });
        expect((await analysis.boundingBox())!.width).toBeCloseTo(768 * height / 1080, 1);
      }
      await page.screenshot({ path: `docs/evidence/programme-${name}-${height}.png` });
    }
  }
});
