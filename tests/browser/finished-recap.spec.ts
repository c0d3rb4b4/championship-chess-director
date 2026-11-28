import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Chess } from "chess.js";
import { loadCatalogue } from "../../src/server/catalogue.js";
import { createBroadcastServer } from "../../src/server/http.js";
import type { RealProgramme, RecapPage } from "../../src/shared/types.js";
import { finalResult, sans, score, startFen } from "../finished-game.js";

// Keep the video recorder first so the transition clips use the full 720p viewport.
test.use({ trace: { mode: "retain-on-failure", screenshots: false } });
const directory = "test-results/provider-screenshots";
test("match-day rehearsal from countdown through replay, including cold selection and recovery", { tag: "@review-captures" },
    async ({ browser, playwright, channel }) => {
  test.setTimeout(60_000);
  const temp = await mkdtemp(join(tmpdir(), "finished-recap-"));
  const dbPath = join(temp, "broadcast.sqlite"), cataloguePath = join(temp, "catalogue.json");
  const catalogue = loadCatalogue(), [archive, live] = catalogue.games.slice(2, 4);
  catalogue.eventName = "Club Championship · Test fixture";
  archive.white.name = live.black.name = "Riya Shah";
  archive.black.name = live.white.name = "Morgan Ellis";
  archive.startFen = live.startFen = startFen;
  live.binding!.sessePlayers = { white: live.white.name, black: live.black.name };
  live.binding!.elapsedTime = "pgn-emt";
  delete archive.binding!.sessePlayers;
  live.scheduledStart = "2026-11-29T12:01:00Z";
  await writeFile(cataloguePath, JSON.stringify(catalogue));

  let now = Date.parse("2026-11-29T12:00:00Z");
  let livePly = 0, liveResult = "*", delayMs = 0;
  const start = () => createBroadcastServer({
    dbPath, publicDir: resolve("dist/public"), cataloguePath, delayMs, wallNow: () => now,
    async request(input) {
      const url = new URL(String(input));
      if (url.hostname === "analysis.sesse.net") {
        const history = sans.slice(0, livePly), position = new Chess(startFen);
        history.forEach(san => position.move(san));
        return Response.json({ position: { history, fen: position.fen(), player_w: live.white.name, player_b: live.black.name },
          pv: [position.moves()[0]], score: ["cp", 42], depth: 18 }, { headers: { "x-rglm": "v1" } });
      }
      return new Response(url.pathname.includes(live.binding!.roundId)
        ? score(live, livePly, liveResult) : score(archive, sans.length, finalResult, { opening: false }));
    },
    openSocket() { throw Error("Leela offline in fixture"); },
  });
  let app = start();
  const listen = async (port = 0) => {
    await new Promise<void>(ready => app.server.listen(port, "127.0.0.1", ready));
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("No server address");
    return address.port;
  };
  const port = await listen(), base = `http://127.0.0.1:${port}`;
  const [hdBrowser, sdBrowser] = await Promise.all([
    playwright.chromium.launch({ channel }), playwright.chromium.launch({ channel }),
  ]);
  const [hd, sd, operator] = await Promise.all([
    hdBrowser.newPage({ viewport: { width: 1920, height: 1080 } }),
    sdBrowser.newPage({ viewport: { width: 1280, height: 720 } }),
    browser.newPage({ viewport: { width: 1920, height: 1080 } }),
  ]);
  const journal = new DatabaseSync(dbPath, { readOnly: true });
  try {
    await Promise.all([hd.goto(base + "/programme"), sd.goto(base + "/programme"), operator.goto(base + "/operator")]);
    const view = [hd.getByTestId("programme"), sd.getByTestId("programme"),
      operator.frameLocator("iframe").getByTestId("programme")];
    const snapshot = async (): Promise<RealProgramme> => (await fetch(base + "/api/programme")).json();
    const tick = (at: number) => { now = at; app.tick(); };
    const take = async (game: typeof live) => {
      await operator.getByRole("combobox").selectOption(game.id);
      await operator.getByRole("button", { name: `Take ${game.label} to programme` }).click();
    };
    const showing = async (gameId: string, page: RecapPage, ply?: number) => {
      await Promise.all(view.map(async output => {
        await expect(output).toHaveAttribute("data-game-id", gameId);
        await expect(output).toHaveAttribute("data-recap-page", page);
        if (ply !== undefined) {
          await expect(output).toHaveAttribute("data-replay-game", gameId);
          await expect(output).toHaveAttribute("data-replay-ply", String(ply));
          await expect(output.getByText("REPLAY", { exact: true })).toBeVisible();
        }
      }));
    };
    const capture = async (page: Page, name: string) => {
      await expect(page.getByTestId("programme")).toBeInViewport({ ratio: .999 });
      const layout = await page.locator(".live-sheet").evaluate(sheet => ({
        sheetBottom: sheet.getBoundingClientRect().bottom,
        viewport: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      }));
      expect(layout.sheetBottom).toBeLessThanOrEqual(layout.viewport);
      expect(layout.scrollWidth).toBe(layout.viewportWidth);
      await page.screenshot({ path: `${directory}/g3/${name}-${layout.viewport}.jpg`, quality: 88, animations: "disabled" });
    };
    const rundown = async () => {
      const { summary, recap } = await snapshot();
      return { result: summary?.result, page: recap?.page, white: recap?.white, black: recap?.black,
        replay: recap?.replay };
    };
    const firstPass = new Map<number, Awaited<ReturnType<typeof rundown>>>();
    const stills = async (name: string) => {
      firstPass.set(now - finishedAt, await rundown());
      await Promise.all([capture(hd, name), capture(sd, name)]);
    };

    // Take the archive cold before the next round begins on this same server.
    const cold = now;
    await take(archive);
    await showing(archive.id, "result");
    await expect(view[0].locator(".live-player.black")).toContainText(archive.black.name);
    await expect(view[0].locator(".live-player.white")).toContainText(archive.white.name);
    tick(cold + 30_000);
    await showing(archive.id, "numbers");
    await expect(view[0].getByText("Opening · PGN")).toHaveCount(0);
    tick(cold + 42_000);
    await showing(archive.id, "replay", 0); // No verified times or historical engines.
    tick(cold + 46_000);
    await showing(archive.id, "replay", 2);
    await hd.reload();
    await showing(archive.id, "replay", 2);
    await app.close(); app = start(); await listen(port);
    await showing(archive.id, "replay", 2);

    await take(live);
    await Promise.all(view.map(async output => {
      await expect(output).toHaveAttribute("data-state", "waiting");
      await expect(output).toHaveAttribute("data-game-id", live.id);
      await expect(output).toHaveAttribute("data-replay-game", archive.id);
      await expect(output.getByRole("timer")).toBeVisible();
    }));
    livePly = 1;
    tick(now + 15_000);
    const pendingAt = now;
    await Promise.all(view.map(output => expect(output).toHaveAttribute("data-state", "underway")));
    await expect(view[0].getByText("White eval · pawns")).toBeVisible();
    const sourceRoot = await snapshot();
    expect(sourceRoot.position?.moves).toEqual(["O-O-O"]);
    tick(pendingAt + 50);
    livePly = sans.length; liveResult = finalResult;
    tick(pendingAt + 15_000);
    const finishedAt = now;
    await showing(live.id, "result");
    await stills("result");

    await mkdir(`${directory}/videos`, { recursive: true });
    await sd.screencast.start({ path: `${directory}/videos/g3-result-to-recap-720p.webm`, size: sd.viewportSize()! });
    await sd.waitForTimeout(600);
    tick(finishedAt + 29_999);
    await showing(live.id, "result");
    tick(finishedAt + 30_000);
    await showing(live.id, "numbers");
    await expect(view[1].getByRole("row", { name: "Captures 2 2" })).toBeVisible();
    await expect(view[1].getByRole("row", { name: "Moves played 3 3" })).toBeVisible();
    await sd.waitForTimeout(700);
    await sd.screencast.stop();
    await stills("numbers");

    tick(finishedAt + 42_000);
    await showing(live.id, "time");
    await expect(view[0].getByText("White · 2/3 moves timed")).toBeVisible();
    await expect(view[0].getByText("Longest observed think · 1.O-O-O · 12 s")).toBeVisible();
    await expect(view[0].getByText("43 s", { exact: true })).toBeVisible();
    await expect(view[0].getByRole("img", { name: "Recorded cumulative minutes" }).getByText("0", { exact: true }).last()).toBeVisible();
    await stills("time");

    await sd.emulateMedia({ reducedMotion: "reduce" });
    tick(finishedAt + 57_000);
    await showing(live.id, "evaluation");
    await expect(view[1].getByText("Observed during play")).toBeVisible();
    await expect(view[1].getByRole("img", { name: "White evaluation · pawns" }).locator("circle")).toHaveCount(1);
    await expect(view[1].getByRole("img", { name: "Leela · Probability (%)" })).toHaveCount(0);
    expect(await view[1].locator(".live-sheet").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
    await stills("evaluation");
    await sd.emulateMedia({ reducedMotion: "no-preference" });

    tick(finishedAt + 72_000);
    await showing(live.id, "replay", 0);
    const board = new Chess(startFen);
    for (const [index, san] of sans.entries()) {
      const move = board.move(san), ply = index + 1;
      tick(finishedAt + 72_000 + 2_000 * ply);
      await showing(live.id, "replay", ply);
      await Promise.all(view.map(output => expect(output.getByTestId("replay-board")).toHaveAttribute("data-fen", move.after)));
      expect((await snapshot()).recap!.replay!.frame.san).toBe(san);
      if (ply === 3) {
        await expect(view[1].locator(".live-player.white")).toContainText(live.white.name);
        await expect(view[1].locator(".live-player.black")).toContainText(live.black.name);
        await stills("replay");
      }
    }
    await expect(view[0].getByRole("heading", { name: "3...Rxa8" })).toBeVisible();
    await sd.screencast.start({ path: `${directory}/videos/g3-replay-to-result-720p.webm`, size: sd.viewportSize()! });
    tick(finishedAt + 87_999);
    await showing(live.id, "replay", 6);
    await sd.waitForTimeout(550);
    tick(finishedAt + 88_000);
    await showing(live.id, "result");
    await sd.waitForTimeout(700);
    await sd.screencast.stop();

    // Reconstruct the same game from its SQLite journal and compare the second rundown.
    await app.close(); app = start(); await listen(port);
    for (const [offset, expected] of firstPass) {
      tick(finishedAt + 88_000 + offset);
      await showing(live.id, expected.page!, expected.replay?.ply);
      expect(await rundown()).toEqual(expected);
    }

    // Withdraw the scored result during replay, then check a delayed completed take after restart.
    tick(finishedAt + 168_000);
    await showing(live.id, "replay", 4);
    liveResult = "*";
    tick(now + 15_000);
    await Promise.all(view.map(output => expect(output).toHaveAttribute("data-state", "underway")));
    await expect(view[0].getByTestId("replay-board")).toHaveCount(0);

    delayMs = 60_000;
    await app.close(); app = start(); await listen(port);
    const delayedTake = now;
    livePly = 0; liveResult = "1-0";
    await take(archive);
    await showing(archive.id, "result"); // Cached, revalidated archive already covers the delay.
    await take(live);
    await expect.poll(() => Number(journal.prepare("SELECT MAX(epoch) AS epoch FROM feed_events WHERE source='authority'").get()!.epoch)).toBe(4);
    tick(delayedTake + 59_999);
    await Promise.all(view.map(output => expect(output).toHaveAttribute("data-state", "buffering")));
    await expect(view[0].getByText("1–0", { exact: true })).toHaveCount(0);
    tick(delayedTake + 60_000);
    await showing(live.id, "result");
    await expect(view[0].getByText("1–0", { exact: true })).toBeVisible();
    tick(delayedTake + 150_000);
    await showing(live.id, "result"); // An explicit zero-ply result never fabricates a replay.
  } finally {
    journal.close();
    await Promise.all([hdBrowser.close(), sdBrowser.close(), operator.close()]);
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
