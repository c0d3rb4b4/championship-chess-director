import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { Director } from "../../src/server/director.js";

// Capture both broadcast sizes from the same released scene.
async function captureScene(page: Page, scene: string): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: `docs/evidence/programme-${scene}-1080.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId("actual-board")).toBeInViewport({ ratio: 0.999 });
  await expect(page.locator(".played-moves")).toBeInViewport({ ratio: 0.999 });
  await page.screenshot({ path: `docs/evidence/programme-${scene}-720.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
}

test("two programme viewers receive the played position immediately and highlight it after the fast return", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/operator");
  await expect(
    page.getByText("Director connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restart demo", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Demo restarted");
  const programme = await context.newPage();
  programme.on("pageerror", (error) => errors.push(error.message));
  await programme.goto("/programme");
  const output = programme.getByTestId("programme");
  await expect(output).toHaveAttribute("data-scene", "thinking");
  await expect(programme.getByText("DEMO", { exact: true })).toBeVisible();
  expect(await programme.getByRole("button").count()).toBe(0);
  const actual = programme.getByTestId("actual-board");
  const root = await actual.getAttribute("data-fen");
  const actualTint = actual.locator("[data-last-move-square]");
  await expect(actual.locator('[data-last-move-square="h7"]')).toHaveAttribute("data-material", "silver");
  await expect(actual.locator('[data-last-move-square="h6"]')).toHaveAttribute("data-material", "graphite");
  expect((await actual.boundingBox())!.width).toBe(768);
  // The two engine sheets are independent: each line keeps its supplied depth.
  const sesse = programme.getByRole("table", { name: /Stockfish.*candidates/i });
  const leela = programme.getByRole("table", { name: /Leela.*candidates/i });
  for (const [table, depth] of [[sesse, "25"], [leela, "16"]] as const) {
    const candidate = table.getByRole("row").filter({
      has: programme.getByRole("rowheader", { name: "h3", exact: true }),
    });
    await expect(candidate.getByRole("cell", { name: depth, exact: true })).toBeVisible();
  }
  await expect(output).toContainText("+0.35");
  const outcomes = programme.locator(".wdl");
  await expect(outcomes.locator(".wdl-values > div")).toHaveText([
    /White win\s*30%/, /Draw\s*50%/, /Black win\s*20%/,
  ]);
  const played = programme.locator(".played-moves");
  await expect(played).toContainText("h6");
  await expect(played).not.toContainText("d4");
  // Public output reserves the lower strip for the scoresheet.
  await expect(programme.locator(".ticker")).toHaveCount(0);
  await captureScene(programme, "thinking");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: "docs/evidence/operator.png", fullPage: true });
  await page
    .getByRole("button", { name: "Cue variation", exact: true })
    .click();
  await expect(output).toHaveAttribute("data-scene", "spotlight");
  await expect(
    programme.getByRole("heading", { name: "ANALYSIS LINE NOT PLAYED" }),
  ).toBeVisible();
  const hypothetical = programme.getByTestId("analysis-board");
  await expect(hypothetical.locator('[data-last-move-square="h7"]')).toHaveCount(1);
  await expect(programme.locator(".analysis-board")).toHaveAttribute(
    "data-frame",
    "1",
    { timeout: 4000 },
  );
  await expect(actual).toHaveAttribute("data-fen", root!);
  expect((await actual.boundingBox())!.width).toBe(416);
  await expect(actualTint).toHaveCount(2);
  await expect(actual.locator('[data-last-move-square="h7"]')).toHaveCount(1);
  await expect(actual.locator('[data-last-move-square="h6"]')).toHaveCount(1);
  await expect(hypothetical.locator("[data-last-move-square]")).toHaveCount(2);
  await expect(hypothetical.locator('[data-last-move-square="d3"]')).toHaveCount(1);
  await expect(hypothetical.locator('[data-last-move-square="d4"]')).toHaveCount(1);
  await expect(actual.locator(".plate-fasteners")).toHaveCSS("display", "none");
  await expect(hypothetical.locator(".plate-fasteners")).toHaveCSS("display", "inline");
  expect(await programme.locator(".chessboard defs [id]").evaluateAll((defs) =>
    new Set(defs.map((def) => def.id)).size === defs.length,
  )).toBe(true);
  expect(
    (await programme.getByTestId("analysis-board").boundingBox())!.width,
  ).toBe(768);
  expect(await programme.locator(".analysis-region [data-clock]").count()).toBe(
    0,
  );
  await expect(programme.locator(".variation-rail")).toContainText("d4");
  await expect(played).not.toContainText("d4");
  await captureScene(programme, "variation");
  const second = await context.newPage();
  await second.goto("/programme");
  await expect(second.getByTestId("programme")).toHaveAttribute(
    "data-scene",
    "spotlight",
  );
  await expect(second.getByTestId("actual-board")).toHaveAttribute(
    "data-fen",
    root!,
  );
  const started = performance.now();
  // Actual operator click exercises the HTTP command, shared director, SSE, and browser render path.
  await page
    .getByRole("button", { name: "Play actual move", exact: true })
    .click();
  await expect(output).toHaveAttribute("data-scene", "actual-move", {
    timeout: 500,
  });
  await expect(second.getByTestId("programme")).toHaveAttribute(
    "data-scene",
    "actual-move",
    { timeout: 500 },
  );
  const playedFen = new Director().command("release-move").actual.fen;
  await Promise.all(
    [programme, second].map(viewer =>
      expect(viewer.getByTestId("actual-board")).toHaveAttribute("data-fen", playedFen, { timeout: 500 }),
    ),
  );
  await Promise.all(
    [programme, second].map((viewer) =>
      viewer.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      ),
    ),
  );
  const clickToPaintMs = performance.now() - started;
  expect(clickToPaintMs).toBeLessThan(500);
  await expect(programme.getByTestId("analysis-board")).toHaveCount(0);
  await expect(programme.locator(".analysis-region")).toHaveCount(0);
  await expect(actualTint).toHaveCount(2);
  await expect(actual.locator('[data-last-move-square="d3"]')).toHaveCSS("opacity", "1");
  await expect(actual.locator('[data-last-move-square="d4"]')).toHaveCSS("opacity", "1");
  await expect.poll(async () => (await actual.boundingBox())?.width).toBe(768);
  await expect(
    programme.getByText("Updating for this position", { exact: true }),
  ).toBeVisible();
  await expect(played.getByText("d4", { exact: true })).toHaveCount(1);
  await expect(programme.locator(".event")).toContainText("Black to move");
  await expect(programme.locator(".last-move strong")).toHaveText("10.d4");
  await expect(outcomes).toHaveCount(0);
  await expect(output).not.toContainText("+0.35");
  await expect(output).not.toContainText("Nf1");
  await programme.screenshot({
    path: "docs/evidence/programme-interrupted-1080.png",
  });
  const after = await actual.getAttribute("data-fen");
  await programme.reload();
  await expect(programme.getByTestId("actual-board")).toHaveAttribute(
    "data-fen",
    after!,
  );
  await expect(programme.getByTestId("analysis-board")).toHaveCount(0);
  await programme.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await actual.boundingBox())?.width).toBeCloseTo(512, 2);
  expect(
    await programme.evaluate(() => ({
      x: document.documentElement.scrollWidth <= innerWidth,
      y: document.documentElement.scrollHeight <= innerHeight,
    })),
  ).toEqual({ x: true, y: true });
  await programme.screenshot({
    path: "docs/evidence/programme-interrupted-720.png",
  });
  const snapshot = await (await request.get("/api/programme")).json();
  expect(snapshot.game.ply).toBe(19);
  expect(errors).toEqual([]);
  const measurement = JSON.stringify(
    {
      clickToPaintMs,
      viewers: 2,
      targetMs: 500,
      note: "Operator click to the played position in both browser viewers plus two animation frames. The visual highlight comes after the return.",
    },
    null,
    2,
  );
  await writeFile("docs/evidence/interruption.json", measurement + "\n");
  await testInfo.attach("interruption-measurement", {
    body: measurement,
    contentType: "application/json",
  });
  // Follow the same HTTP/SSE rehearsal through independent source returns.
  const newFen = await actual.getAttribute("data-fen");
  await expect(output).toContainText("+0.18", { timeout: 10000 });
  await expect(programme.locator(".leela")).toContainText("Updating for this position");
  await expect(outcomes).toHaveCount(0);
  await expect(leela).toHaveCount(0);
  await expect(sesse.getByRole("rowheader", { name: "exd4" })).toBeVisible();
  await captureScene(programme, "stockfish-return");
  await expect(outcomes.locator(".wdl-values > div")).toHaveText([
    /White win\s*26%/, /Draw\s*54%/, /Black win\s*20%/,
  ], { timeout: 9000 });
  await expect(leela.getByRole("rowheader", { name: "exd4" })).toBeVisible();
  await expect(actual).toHaveAttribute("data-fen", newFen!);
  await captureScene(programme, "both-return");
  await expect(played).toContainText("exd4", { timeout: 16000 });
  await expect(actual).not.toHaveAttribute("data-fen", newFen!);
  await expect(output).toContainText("White to move");
  await expect(sesse).toHaveCount(0);
  await expect(outcomes).toHaveCount(0);

});

test("an interrupted connection retains the last board, freezes clocks and shows a persistent warning", async ({
  page,
}) => {
  await page.goto("/programme");
  await expect(page.getByTestId("actual-board")).toBeVisible();
  const fen = await page.getByTestId("actual-board").getAttribute("data-fen");
  await page.context().setOffline(true);
  await expect(
    page.locator(".connection-banner"),
  ).toBeVisible();
  await expect(page.locator(".connection-banner")).toContainText(/connection interrupted/i);
  await expect(page.locator(".connection-banner")).toContainText(/clocks paused/i);
  const frozen = await page.locator('[data-clock="b"]').textContent();
  await page.waitForTimeout(1200);
  expect(await page.locator('[data-clock="b"]').textContent()).toBe(frozen);
  await expect(page.getByTestId("actual-board")).toHaveAttribute(
    "data-fen",
    fen!,
  );
  await page.context().setOffline(false);
  await expect(page.locator(".connection-banner")).toBeHidden({
    timeout: 10000,
  });
});

test("reduced-motion spotlight cuts keep the real clock strip anchored", async ({ page, context }) => {
  await page.goto("/operator");
  await page.getByRole("button", { name: "Restart demo" }).click();
  await expect(page.getByRole("status")).toContainText("Demo restarted");
  const viewer = await context.newPage();
  await viewer.emulateMedia({ reducedMotion: "reduce" });
  await viewer.goto("/programme");
  const strip = viewer.locator(".programme-header .players");
  await expect(strip).toBeVisible();
  const bounds = await strip.boundingBox();
  const played = viewer.locator(".played-moves");
  const initialMoves = await played.textContent();
  const clock = strip.locator('[data-clock="w"]');
  const initialClock = await clock.innerText();
  await expect(clock).not.toHaveText(initialClock);
  await expect(viewer.locator(".scene-enter")).toHaveCount(0);
  expect(await strip.boundingBox()).toEqual(bounds);
  await page.getByRole("button", { name: "Cue variation" }).click();
  await expect(viewer.getByTestId("analysis-board")).toBeInViewport({ ratio: .999 });
  expect(await viewer.getByTestId("programme").evaluate(programme =>
    programme.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await strip.boundingBox()).toEqual(bounds);
  await page.getByRole("button", { name: "Return to actual" }).click();
  await expect(viewer.getByTestId("analysis-board")).toHaveCount(0);
  await expect(played).toHaveText(initialMoves!);
  await page.getByRole("button", { name: "Restart demo" }).click();
  await expect(page.getByRole("status")).toContainText("Demo restarted");
  await page.getByRole("button", { name: "Cue variation" }).click();
  await expect(viewer.locator(".variation-rail")).toBeVisible();
  await page.getByRole("button", { name: "Play actual move" }).click();
  await expect(viewer.getByTestId("programme")).toHaveAttribute("data-scene", "actual-move");
  await expect(viewer.getByTestId("analysis-board")).toHaveCount(0);
  await expect(viewer.locator(".analysis-region")).toHaveCount(0);
  await expect(viewer.getByTestId("actual-board").locator('[data-last-move-square="d4"]')).toHaveCSS("opacity", "1");
  expect(await viewer.getByTestId("programme").evaluate(programme =>
    programme.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await strip.boundingBox()).toEqual(bounds);
});

test("a WDL revision at unchanged depth updates only the eligible position", async ({ page }) => {
  const initial = new Director().advanceTo(6000);
  const revised = structuredClone(initial);
  revised.sequence++;
  const leela = revised.engines.find((engine) => engine.id === "leela")!;
  leela.wdl = [0, 61, 39];
  leela.score = "0 / 61 / 39";

  // Two consecutive SSE observations share the same scene, root, readiness and depth.
  // A cache keyed on scene and depth alone would keep the first WDL figure on air.
  let current = initial;
  let sendRevision!: () => void;
  const ready = new Promise<void>((resolve) => { sendRevision = resolve; });
  await page.route("**/api/programme", (route) => route.fulfill({ json: current }));
  await page.route("**/api/programme/events", async (route) => {
    await ready;
    await route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify(revised)}\n\n`,
    });
  });
  await page.goto("/programme", { waitUntil: "domcontentloaded" });
  const outcomes = page.locator(".wdl");
  await expect(outcomes).toContainText("30%");
  current = revised; // Any concurrent resnapshot must read the same released state.
  sendRevision();
  await expect(outcomes.locator(".wdl-values > div")).toHaveText([
    /White win\s*0%/, /Draw\s*61%/, /Black win\s*39%/,
  ]);
  await expect(outcomes).not.toContainText("30%");
  await expect(page.getByTestId("actual-board")).toHaveAttribute("data-fen", initial.actual.fen);
});
