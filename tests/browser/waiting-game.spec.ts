import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Chess } from "chess.js";
import { loadCatalogue } from "../../src/server/catalogue.js";
import { createBroadcastServer } from "../../src/server/http.js";
import type { CatalogueGame } from "../../src/shared/catalogue.js";
import type { RealProgramme } from "../../src/shared/types.js";

test.use({ trace: { mode: "retain-on-failure", screenshots: false } });
const out = "test-results/provider-screenshots";
const sdSize = { width: 1280, height: 720 };

async function listen(server: Server, port = 0) {
  await new Promise<void>(ready => server.listen(port, "127.0.0.1", ready));
  const address = server.address();
  if (typeof address !== "object" || !address) throw Error("Missing listening address");
  return `http://127.0.0.1:${address.port}`;
}

function pgn(game: CatalogueGame, moves: string, result: string) {
  const binding = game.binding!;
  const headers = {
    Event: binding.events[0], Round: binding.pgnRound, White: game.white.name, Black: game.black.name,
    WhiteFideId: game.white.id, BlackFideId: game.black.id,
    GameURL: `https://lichess.org/broadcast/test/round/${binding.roundId}/${binding.chapterId}`, Result: result,
  };
  return Object.entries(headers).map(([key, value]) => `[${key} "${value}"]`).join("\n") + `\n\n${moves} ${result}`;
}

for (const delay of [0, 60_000]) test(`waiting, archived replay and single opening takeover at D=${delay / 1000}s`,
  { tag: "@review-captures" }, async ({ browser, playwright, channel }) => {
  test.setTimeout(65_000);
  const temp = await mkdtemp(join(tmpdir(), "game-day-waiting-"));
  const catalogue = loadCatalogue();
  const [first, unknown, archive, live] = catalogue.games;
  const originalStart = live.scheduledStart!;
  const start = Date.parse(originalStart);
  const startOfTest = start - 10_000;
  first.scheduledStart = new Date(start + 3 * 3_600_000).toISOString();
  first.binding = unknown.binding = null;
  unknown.scheduledStart = null;
  const cataloguePath = join(temp, "catalogue.json");
  const save = () => writeFile(cataloguePath, JSON.stringify(catalogue));
  await save();

  const pending: ServerResponse[] = [];
  let archiveReads = 0;
  const upstream = createServer((req, res) => {
    if (req.url!.includes(live.binding!.roundId)) {
      pending.push(res);
      res.on("close", () => { const i = pending.indexOf(res); if (i >= 0) pending.splice(i, 1); });
    } else if (req.url!.includes(archive.binding!.roundId)) {
      archiveReads++;
      // Original composed mainline with the Game 3 binding and colours.
      res.end(pgn(archive, "1. Nf3 Nf6 2. Ng1 Ng8", "1/2-1/2"));
    } else res.writeHead(503).end();
  });
  const upstreamUrl = await listen(upstream);
  const dbPath = join(temp, "waiting.sqlite");
  let now = startOfTest;
  const launch = () => createBroadcastServer({
    dbPath, cataloguePath, publicDir: resolve("dist/public"), delayMs: delay, wallNow: () => now,
    request(input, init) { const url = new URL(String(input)); return fetch(upstreamUrl + url.pathname + url.search, init); },
    openSocket() { throw Error("No Leela connection in fixture"); },
  });
  let app = launch();
  const base = await listen(app.server);
  const journal = new DatabaseSync(dbPath, { readOnly: true });
  const [hdBrowser, sdBrowser] = await Promise.all([
    playwright.chromium.launch({ channel }), playwright.chromium.launch({ channel }),
  ]);
  const [hd, sd, operator] = await Promise.all([
    hdBrowser.newPage({ viewport: { width: 1920, height: 1080 } }),
    sdBrowser.newPage({ viewport: sdSize, reducedMotion: delay ? "reduce" : "no-preference" }),
    browser.newPage({ timezoneId: "Europe/London" }),
  ]);
  try {
    await Promise.all([hd.goto(base + "/programme"), sd.goto(base + "/programme"), operator.goto(base + "/operator")]);
    const outputs = [hd.getByTestId("programme"), sd.getByTestId("programme"),
      operator.frameLocator("iframe").getByTestId("programme")];
    const tick = (instant: number) => { now = instant; app.tick(); };
    const snapshot = async (): Promise<RealProgramme> => (await fetch(base + "/api/programme")).json();
    const onAll = async (assert: (surface: typeof outputs[number]) => Promise<void>) => Promise.all(outputs.map(assert));
    const previousPly = (n: number) => onAll(async view => {
      await expect(view).toHaveAttribute("data-game-id", live.id);
      await expect(view).toHaveAttribute("data-replay-game", archive.id);
      await expect(view).toHaveAttribute("data-replay-ply", String(n));
      await expect(view.getByText("REPLAY", { exact: true })).toBeVisible();
      await expect(view.getByRole("button")).toHaveCount(0);
    });
    const noBoard = () => onAll(async view => {
      await expect(view.getByTestId("replay-board")).toHaveCount(0);
      await expect(view.getByTestId("actual-board")).toHaveCount(0);
    });
    const take = async (game: CatalogueGame) => {
      await operator.getByRole("combobox").selectOption(game.id);
      await operator.getByRole("button", { name: `Take ${game.label} to programme` }).click();
      await onAll(view => expect(view).toHaveAttribute("data-game-id", game.id));
    };
    const shot = async (page: Page, label: string) => {
      await expect(page.getByTestId("programme")).toBeInViewport({ ratio: .999 });
      const fits = await page.locator(".waiting-clock, .waiting-status h2, .waiting-replay .chessboard").evaluateAll(nodes =>
        nodes.every(node => { const r = node.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; }));
      expect(fits).toBe(true);
      await page.screenshot({ path: `${out}/g4/${label}-${page.viewportSize()!.height}.jpg`, quality: 88, animations: "disabled" });
    };
    const stills = (label: string) => Promise.all([shot(hd, label), shot(sd, label)]);
    const rows = (source: string) => Number(journal.prepare("SELECT count(*) AS n FROM feed_events WHERE source = ?").get(source)!.n);
    const respond = async (moves: string) => {
      await expect.poll(() => pending.length).toBe(1);
      const receivedAt = Date.now();
      pending.shift()!.end(pgn(live, moves, "*"));
      return receivedAt;
    };

    await take(live);
    await respond("");
    await expect.poll(() => rows("archive")).toBe(1);
    if (delay) {
      tick(startOfTest + delay - 1);
      await noBoard();
      expect((await snapshot()).waiting?.previous).toBeUndefined();
      await onAll(view => expect(view).not.toContainText("½–½"));
    }
    tick(startOfTest + delay);
    await previousPly(0);
    await onAll(async view => {
      await expect(view.getByRole("timer")).toHaveText("00:00:10");
      await expect(view.getByRole("heading", { name: "Waiting for the first move" })).toBeVisible();
      await expect(view.locator(".waiting-details .white")).toContainText(live.white.name);
      await expect(view.locator(".waiting-details .black")).toContainText(live.black.name);
      await expect(view.locator(".waiting-replay .white")).toContainText(archive.white.name);
      await expect(view.locator(".waiting-replay .black")).toContainText(archive.black.name);
      await expect(view.getByText("Game 3 · ½–½")).toBeVisible();
    });
    const board = new Chess();
    for (const [index, san] of ["Nf3", "Nf6"].entries()) {
      tick(startOfTest + delay + 2000 * (index + 1));
      await previousPly(index + 1);
      const move = board.move(san);
      await onAll(async view => {
        await expect(view.getByTestId("replay-board")).toHaveAttribute("data-fen", move.after);
        await expect(view.locator(`[data-last-move-square="${move.to}"]`)).toBeVisible();
        await expect(view.locator(".replay-move")).toContainText(san);
      });
      if (!delay) await stills(`waiting-ply-${index + 1}`);
    }
    if (!delay) {
      await expect(operator.locator("#director-scene")).toHaveText("Game 4 · Waiting for the first move");
      await operator.screenshot({ path: `${out}/g4/operator-1080.jpg`, quality: 88, fullPage: true });
    }
    const replayNode = await hd.getByTestId("replay-board").elementHandle();
    tick(now + 1000);
    await onAll(view => expect(view.getByRole("timer")).toHaveText("00:00:05"));
    expect(await replayNode!.evaluate(node => node.isConnected)).toBe(true);
    await hd.reload();
    await previousPly(2);
    await app.close(); app = launch(); await listen(app.server, Number(new URL(base).port));
    tick(now + 1000);
    await previousPly(3);
    expect(archiveReads).toBe(1);

    tick(start + delay - 1);
    await onAll(view => expect(view.getByRole("timer")).toHaveText("00:00:01"));
    if (!delay) {
      await mkdir(`${out}/videos`, { recursive: true });
      await sd.screencast.start({ path: `${out}/videos/g4-countdown-zero-720p.webm`, size: sdSize });
      await sd.waitForTimeout(550);
    }
    tick(start + delay);
    await onAll(async view => {
      await expect(view.getByRole("heading", { name: "Awaiting first move" })).toBeVisible();
      await expect(view.getByRole("timer")).toHaveCount(0);
      await expect(view.getByTestId("replay-board")).toBeVisible();
    });
    if (!delay) {
      await sd.waitForTimeout(700);
      await sd.screencast.stop();
      await stills("awaiting-first-move");
    }

    const revisedAt = now + 1000;
    live.scheduledStart = new Date(revisedAt + 120_000).toISOString();
    await save();
    tick(revisedAt);
    if (delay) {
      tick(revisedAt + delay - 1);
      await onAll(view => expect(view.getByRole("timer")).toHaveCount(0));
      // Restart with a revised schedule still pending. It must keep its original release time.
      await app.close(); app = launch(); await listen(app.server, Number(new URL(base).port));
      expect((await snapshot()).game?.scheduledStart).toBe(originalStart);
      tick(revisedAt + delay);
    }
    await onAll(view => expect(view.getByRole("timer")).toHaveText("00:02:00"));
    expect((await snapshot()).game?.scheduledStart).toBe(live.scheduledStart);
    if (!delay) await stills("rescheduled");

    const firstAt = startOfTest + Math.ceil((now + 6000 - startOfTest) / 2000) * 2000;
    tick(firstAt - 1);
    await expect.poll(() => pending.length).toBe(1);
    if (!delay) {
      await sd.screencast.start({ path: `${out}/videos/g4-opening-takeover-720p.webm`, size: sdSize });
      await sd.waitForTimeout(550);
    }
    await onAll(view => view.evaluate(element => {
      const transitions = { openings: 0, afterReleaseReplays: 0, paint: 0 };
      const report = () => { document.documentElement.dataset.g4Transition = JSON.stringify(transitions); };
      document.addEventListener("animationstart", e => {
        if ((e.target as Element).matches(".opening-take .directed-panel")) {
          transitions.openings++;
          report();
        }
      });
      const parent = element.parentElement!;
      new MutationObserver(() => {
        if (parent.querySelector('[data-state="underway"] [data-testid="actual-board"]')) {
          if (!transitions.paint) requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!transitions.paint) transitions.paint = Date.now();
            report();
          }));
        } else if (transitions.paint && parent.querySelector('[data-testid="replay-board"]')) transitions.afterReleaseReplays++;
        report();
      }).observe(parent, { childList: true, subtree: true });
    }));
    if (delay) now = firstAt;
    const receivedAt = await respond("1. d4");
    await expect.poll(() => rows("authority")).toBe(2);
    let releasedAt = receivedAt;
    if (delay) {
      tick(firstAt + delay - 1);
      await previousPly(2); // The next frame would be ply 3 at this same release boundary.
      await onAll(async view => {
        await expect(view.getByTestId("replay-board")).toBeVisible();
        await expect(view.getByTestId("actual-board")).toHaveCount(0);
        await expect(view.getByText("1.d4", { exact: true })).toHaveCount(0);
      });
      releasedAt = Date.now();
      tick(firstAt + delay);
    }
    const actual = new Chess();
    actual.move("d4");
    await onAll(async view => {
      await expect(view).toHaveAttribute("data-state", "underway");
      await expect(view.getByTestId("actual-board")).toHaveAttribute("data-fen", actual.fen());
      await expect(view.getByTestId("replay-board")).toHaveCount(0);
      await expect(view.getByRole("timer")).toHaveCount(0);
    });
    tick(now + 4000);
    const transition = (page: Page) => page.locator("html").evaluate(node =>
      JSON.parse(node.dataset.g4Transition ?? "{}") as { openings: number; afterReleaseReplays: number; paint: number });
    const preview = operator.frameLocator("iframe").locator("html");
    const previewTransition = () => preview.evaluate(node => JSON.parse(node.dataset.g4Transition ?? "{}") as Awaited<ReturnType<typeof transition>>);
    const measurements = await Promise.all([() => transition(hd), () => transition(sd), previewTransition].map(async (read, index) => {
      const openings = index === 1 && delay ? 0 : 1;
      await expect.poll(async () => {
        const observed = await read();
        return [observed.openings, observed.paint > 0, observed.afterReleaseReplays];
      }).toEqual([openings, true, 0]);
      return (await read()).paint - releasedAt;
    }));
    expect(Math.max(...measurements)).toBeLessThan(500);
    await mkdir(`${out}/g4`, { recursive: true });
    await writeFile(`${out}/g4/paint-D${delay / 1000}.json`, JSON.stringify({ delayMs: delay, hd: measurements[0], sd: measurements[1], preview: measurements[2] }) + "\n");
    if (!delay) {
      await sd.waitForTimeout(800);
      await sd.screencast.stop();
      await stills("first-move");
    }

    await take(unknown);
    await noBoard();
    await onAll(view => expect(view.getByText("Start time to be confirmed", { exact: true })).toBeVisible());
    if (!delay) await stills("unknown-start");
    await take(first);
    await noBoard();
    await onAll(view => expect(view.getByRole("timer")).toBeVisible());
    if (!delay) await stills("game-1-no-predecessor");

    await take(live);
    await respond("");
    await expect.poll(() => rows("authority")).toBe(3);
    tick(now + delay);
    await onAll(async view => {
      await expect(view).toHaveAttribute("data-replay-game", archive.id);
      await expect(view.getByTestId("actual-board")).toHaveCount(0);
    });
    await take(first);
    tick(now + 2_000);
    await onAll(view => expect(view).toHaveAttribute("data-game-id", first.id));
    await noBoard();
    expect(archiveReads).toBe(1);
  } finally {
    journal.close();
    await Promise.all([hdBrowser.close(), sdBrowser.close(), operator.close()]);
    await app.close();
    upstream.closeAllConnections();
    await new Promise<void>(done => upstream.close(() => done()));
    await rm(temp, { recursive: true, force: true });
  }
});
