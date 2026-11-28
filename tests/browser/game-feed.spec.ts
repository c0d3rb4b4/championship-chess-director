import { expect, test, type Locator, type Page } from "@playwright/test";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Chess } from "chess.js";
import { loadCatalogue } from "../../src/server/catalogue.js";
import { createBroadcastServer } from "../../src/server/http.js";
import type { RealProgramme } from "../../src/shared/types.js";

test.use({ trace: { mode: "retain-on-failure", screenshots: false } });
const out = "test-results/provider-screenshots";
async function listen(server: Server, port = 0) {
  await new Promise<void>(ready => server.listen(port, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No upstream address");
  return `http://127.0.0.1:${address.port}`;
}

for (const seconds of [0, 60]) test(`selected feed through both viewers and preview, delay ${seconds}s`,
  { tag: "@review-captures" }, async ({ browser, playwright, channel }) => {
  test.setTimeout(60_000);
  const temp = await mkdtemp(join(tmpdir(), "game-feed-"));
  const catalogue = loadCatalogue(), game = catalogue.games[3];
  game.binding!.sessePlayers = { white: "White", black: "Black" }; // verified only at this local upstream
  const cataloguePath = join(temp, "rounds.json");
  await writeFile(cataloguePath, JSON.stringify(catalogue));
  const pending: ServerResponse[] = [], analysis: ServerResponse[] = [];
  const server = createServer((req, res) => {
    if (req.url!.startsWith("/api/broadcast/round/") && !req.url!.includes("wIwJtPqz")) {
      res.writeHead(404).end();
      return;
    }
    const queue = req.url!.startsWith("/analysis.pl") ? analysis : pending;
    queue.push(res);
    res.on("close", () => { const i = queue.indexOf(res); if (i >= 0) queue.splice(i, 1); });
  });
  const upstream = await listen(server);
  let now = Date.parse(game.scheduledStart!);
  const launch = () => createBroadcastServer({
    dbPath: join(temp, "live.sqlite"), publicDir: resolve("dist/public"), cataloguePath,
    delayMs: seconds * 1000, pollMs: 15_000, wallNow: () => now,
    request(input, init) {
      const url = new URL(String(input));
      return fetch(upstream + url.pathname + url.search, init);
    },
    openSocket() { throw Error("Leela offline"); },
  });
  let app = launch();
  // Each paint measurement needs a foreground viewer. Full Chrome throttles animation
  // frames in background tabs of one window even while their SSE and DOM updates continue.
  const [hdBrowser, sdBrowser] = await Promise.all([
    playwright.chromium.launch({ channel }), playwright.chromium.launch({ channel }),
  ]);
  const operator = await browser.newPage();
  try {
    const base = await listen(app.server);
    const snapshot = async (): Promise<RealProgramme> => (await fetch(base + "/api/programme")).json();
    const [hd, sd] = await Promise.all([hdBrowser.newPage(), sdBrowser.newPage()]);
    await hd.setViewportSize({ width: 1920, height: 1080 });
    await sd.setViewportSize({ width: 1280, height: 720 });
    await Promise.all([operator.goto(base + "/operator"), hd.goto(base + "/programme"), sd.goto(base + "/programme")]);
    const preview = operator.frameLocator("iframe").getByTestId("programme");
    const outputs = [hd.getByTestId("programme"), sd.getByTestId("programme"), preview];
    for (const output of outputs) expect(await output.evaluate(() => document.visibilityState)).toBe("visible");
    const after = async (state: string, moves: string[], extra?: (surface: Locator) => Promise<void>) => {
      const actual = new Chess();
      moves.forEach(move => actual.move(move));
      await Promise.all(outputs.map(async surface => {
        await expect(surface).toHaveAttribute("data-state", state);
        if (state === "finished" || state === "underway")
          await expect(surface.getByTestId("actual-board")).toHaveAttribute("data-fen", actual.fen());
        if (extra) await extra(surface);
      }));
      const s = await snapshot();
      expect(s.position?.moves ?? []).toEqual(moves);
      expect(s.state).toBe(state);
    };
    let receivedAt = 0, releasedAt = 0;
    const respond = async (moves: string, result = "*", status = 200) => {
      await expect.poll(() => pending.length).toBe(1);
      receivedAt = Date.now();
      pending.shift()!.writeHead(status).end(`[Event "${game.binding!.events[0]}"]
[Round "4.1"]
[White "White"]
[Black "Black"]
[WhiteFideId "${game.white.id}"]
[BlackFideId "${game.black.id}"]
[GameURL "https://lichess.org/broadcast/test/round/wIwJtPqz/IriXvwPw"]
[Result "${result}"]

${moves} ${result}`);
      // Wait for the poll to journal and schedule its successor at this exact injected instant.
      await expect.poll(async () => {
        const row = journal.prepare("SELECT COUNT(*) AS n FROM feed_events WHERE source='authority'").get();
        return Number(row!.n);
      }).toBe(++authorityRows);
    };
    const { DatabaseSync } = await import("node:sqlite");
    const journal = new DatabaseSync(join(temp, "live.sqlite"), { readOnly: true });
    let authorityRows = 0;
    const advance = (ms: number) => { now += ms; app.tick(); };
    const release = async (prior: () => Promise<void>) => {
      if (seconds) {
        advance(seconds * 1000 - 1);
        await prior();
        releasedAt = Date.now();
        advance(1);
      } else { releasedAt = receivedAt; app.tick(); }
    };
    const poll = () => advance(120_001);
    const shot = async (page: Page, label: string) => {
      const size = page.viewportSize()!;
      await expect(page.getByTestId("programme")).toBeInViewport({ ratio: .999 });
      await page.screenshot({ path: `${out}/g2/${label}-${size.height}.jpg`, quality: 85 });
    };
    await mkdir(`${out}/videos`, { recursive: true });
    await operator.getByRole("combobox").selectOption(game.id);
    await operator.getByRole("button", { name: "Take Game 4 to programme" }).click();
    await respond("");
    await release(() => after("buffering", []));
    await after("waiting", []);
    if (!seconds) {
      await sd.screencast.start({ path: `${out}/videos/g2-first-move-720p.webm`, size: sd.viewportSize()! });
      await sd.waitForTimeout(700);
    }
    poll();
    const first = ["e4"];
    // Measure the first painted board on each surface independently of Playwright assertion polling.
    await Promise.all(outputs.map(surface => surface.evaluate(element => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-state="underway"] [data-testid="actual-board"]')) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          document.documentElement.dataset.firstBoardPaint = String(Date.now());
        }));
      });
      observer.observe(element.parentElement!, { childList: true, subtree: true });
    })));
    await respond("1. e4");
    await release(() => after("waiting", []));
    await after("underway", first);
    const times = await Promise.all(outputs.map(async surface => {
      await expect.poll(() => surface.evaluate(() => Number(document.documentElement.dataset.firstBoardPaint))).toBeGreaterThan(0);
      return await surface.evaluate(() => Number(document.documentElement.dataset.firstBoardPaint)) - releasedAt;
    }));
    expect(Math.max(...times), `first paint (1080p, 720p, preview) in ms: ${times.join(", ")}`).toBeLessThan(500);
    await mkdir(`${out}/g2`, { recursive: true });
    await writeFile(`${out}/g2/paint-D${seconds}.json`, JSON.stringify({ delaySeconds: seconds, hd: times[0], sd: times[1], preview: times[2] }) + "\n");
    if (!seconds) { await sd.waitForTimeout(800); await sd.screencast.stop(); }

    // A legal engine candidate must stay off the actual board and respect its own receipt time.
    await expect.poll(() => analysis.length).toBe(1);
    const board = new Chess(); board.move("e4");
    analysis.shift()!.writeHead(200, { "x-rglm": "v1" }).end(JSON.stringify({
      position: { player_w: "White", player_b: "Black", history: first, fen: board.fen() },
      pv: ["c5", "Nf3"], score: ["cp", 25], depth: "20",
    }));
    await expect.poll(() => journal.prepare("SELECT count(*) AS n FROM feed_events WHERE source='sesse'").get()!.n).toBe(1);
    await release(() => after("underway", first, async s => { await expect(s).not.toContainText("Stockfish"); }));
    await after("underway", first, async s => { await expect(s).toContainText("c5 Nf3"); });
    await Promise.all([hd.reload(), sd.reload()]);
    await after("underway", first);
    if (!seconds) await Promise.all([shot(hd, "live"), shot(sd, "live")]);

    poll();
    const played = ["e4", "e5", "Nf3"];
    await respond("1. e4 e5 2. Nf3");
    await release(() => after("underway", first));
    await after("underway", played, async s => { await expect(s).not.toContainText("Stockfish"); });
    poll();
    await respond("", "*", 503);
    await release(() => after("underway", played, async s => { await expect(s).not.toContainText("feed interrupted"); }));
    await after("underway", played, async s => { await expect(s).toContainText("Game feed interrupted"); });

    poll();
    const fixed = ["e4", "c5", "Nf3"];
    await respond("1. e4 c5 2. Nf3");
    await release(() => after("underway", played));
    await after("underway", fixed, async s => { await expect(s).toHaveAttribute("data-revision", "2"); });
    poll();
    const final = [...fixed, "Nc6"];
    if (!seconds) {
      await sd.screencast.start({ path: `${out}/videos/g2-confirmed-result-720p.webm`, size: sd.viewportSize()! });
      await sd.waitForTimeout(700);
    }
    await respond("1. e4 c5 2. Nf3 Nc6", "1/2-1/2");
    if (seconds) {
      // Restart with the result still in the buffer. All connected windows resnapshot on the same port.
      await app.close(); app = launch(); await listen(app.server, Number(new URL(base).port));
    }
    await release(() => after("underway", fixed, async s => { await expect(s).not.toContainText("½–½"); }));
    await after("finished", final, async s => { await expect(s).toContainText("½–½"); });
    if (!seconds) {
      await sd.waitForTimeout(800);
      await sd.screencast.stop();
      await Promise.all([shot(hd, "result"), shot(sd, "result")]);
    }
    poll();
    await respond("1. e4 c5 2. Nf3 Nc6");
    await release(() => after("finished", final));
    await after("underway", final, async s => { await expect(s).toHaveAttribute("data-revision", "3"); });
    journal.close();
  } finally {
    await Promise.all([operator.close(), hdBrowser.close(), sdBrowser.close()]);
    await app.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});
