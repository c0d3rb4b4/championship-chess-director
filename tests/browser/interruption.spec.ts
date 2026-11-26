import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("operator drives two shared programme viewers; a real move cancels playback and restores 768px actual board", async ({
  page,
  context,
  request,
}, testInfo) => {
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
  expect((await actual.boundingBox())!.width).toBe(768);
  await programme.screenshot({
    path: "docs/evidence/programme-thinking-1080.png",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: "docs/evidence/operator.png", fullPage: true });
  await page
    .getByRole("button", { name: "Cue variation", exact: true })
    .click();
  await expect(output).toHaveAttribute("data-scene", "spotlight");
  await expect(
    programme.getByRole("heading", { name: "ANALYSIS LINE NOT PLAYED" }),
  ).toBeVisible();
  await expect(programme.locator(".analysis-board")).toHaveAttribute(
    "data-frame",
    "1",
    { timeout: 4000 },
  );
  await expect(actual).toHaveAttribute("data-fen", root!);
  expect((await actual.boundingBox())!.width).toBe(416);
  expect(
    (await programme.getByTestId("analysis-board").boundingBox())!.width,
  ).toBe(768);
  expect(await programme.locator(".analysis-region [data-clock]").count()).toBe(
    0,
  );
  await programme.screenshot({
    path: "docs/evidence/programme-variation-1080.png",
  });
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
  await expect(actual).not.toHaveAttribute("data-fen", root!);
  expect((await actual.boundingBox())!.width).toBe(768);
  await expect(
    programme.getByText("Sesse and Leela · Updating for this position"),
  ).toBeVisible();
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
  expect(
    (await programme.getByTestId("actual-board").boundingBox())!.width,
  ).toBeCloseTo(512, 2);
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
      note: "Operator click to both DOM updates plus two animation frames; not an OBS capture benchmark.",
    },
    null,
    2,
  );
  await writeFile("docs/evidence/interruption.json", measurement + "\n");
  await testInfo.attach("interruption-measurement", {
    body: measurement,
    contentType: "application/json",
  });
});

test("an interrupted connection retains the last board, freezes clocks and shows a persistent warning", async ({
  page,
}) => {
  await page.goto("/programme");
  await expect(page.getByTestId("actual-board")).toBeVisible();
  const fen = await page.getByTestId("actual-board").getAttribute("data-fen");
  await page.context().setOffline(true);
  await expect(
    page.getByText(/CONNECTION INTERRUPTED · last confirmed board/),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Cue variation" }).click();
  await expect(viewer.locator(".variation-rail")).toHaveCSS("animation-name", "none");
  expect(await strip.boundingBox()).toEqual(bounds);
  await page.getByRole("button", { name: "Play actual move" }).click();
  await expect(viewer.getByTestId("programme")).toHaveAttribute("data-scene", "actual-move");
  await expect(viewer.getByTestId("analysis-board")).toHaveCount(0);
  expect(await strip.boundingBox()).toEqual(bounds);
});
