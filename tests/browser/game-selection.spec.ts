import { expect, test, type Locator, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBroadcastServer } from "../../src/server/http.js";

// The transition recorder needs to be the first screencast client so the browser
// produces full-size 720p frames. Keep the DOM and network trace on failure.
test.use({ trace: { mode: "retain-on-failure", screenshots: false } });

// Original short test records. The identity headers exercise the configured deployment
// bindings, but the four-ply draw is deliberately not the actual Game 3 scoresheet.
const rounds = {
  4: { id: "wIwJtPqz", chapter: "IriXvwPw", event: "Salesforce FIDE World Championship 2026",
    white: "Gukesh D", black: "Sindarov, Javokhir", whiteId: "46616543", blackId: "14205483", result: "*", moves: "" },
  3: { id: "fnmEB1kH", chapter: "RD8sbYw1", event: "FIDE World Chess Championship Match",
    white: "Sindarov, Javokhir", black: "Gukesh D", whiteId: "14205483", blackId: "46616543", result: "1/2-1/2", moves: "1. Nf3 Nf6 2. Ng1 Ng8 " },
};

function roundPgn(number: 3 | 4) {
  const round = rounds[number];
  const headers = {
    Event: round.event, Round: `${number}.1`, White: round.white, Black: round.black,
    WhiteFideId: round.whiteId, BlackFideId: round.blackId, Result: round.result,
    GameURL: `https://lichess.org/broadcast/fide-world-chess-championship-2026/game-${number}/${round.id}/${round.chapter}`,
  };
  return Object.entries(headers).map(([key, value]) => `[${key} "${value}"]`).join("\n") + `\n\n${round.moves}${round.result}\n`;
}

async function listen(server: Server, port = 0) {
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing TCP address");
  return `http://127.0.0.1:${address.port}`;
}

const evidence = "test-results/provider-screenshots";
const small = { width: 1280, height: 720 };
const large = { width: 1920, height: 1080 };

async function capture(page: Page, name: string) {
  await expect(page.getByTestId("programme")).toBeInViewport({ ratio: 0.999 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
    document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.screenshot({ path: `${evidence}/g1/${name}-${page.viewportSize()!.height}.jpg`, quality: 86 });
}

async function sharedState(outputs: Locator[], id: string, state: string) {
  await Promise.all(outputs.map(async output => {
    await expect(output).toHaveAttribute("data-game-id", id);
    await expect(output).toHaveAttribute("data-state", state);
    await expect(output.getByRole("button")).toHaveCount(0);
    if (id) {
      await expect(output.getByRole("heading", { name: `Game ${id.split("-").at(-1)}`, exact: true })).toBeVisible();
      const white = id === "game-4" ? /White\s*Gukesh D/ : /White\s*Javokhir Sindarov/;
      const black = id === "game-4" ? /Black\s*Javokhir Sindarov/ : /Black\s*Gukesh D/;
      await expect(output).toContainText(white);
      await expect(output).toContainText(black);
    }
  }));
}

test("take Game 4, browse and take Game 3, then reopen the persisted selection", { tag: "@review-captures" }, async ({ browser }) => {
  const work = await mkdtemp(join(tmpdir(), "chess-selection-"));
  const requests: string[] = [];
  let corrected = false;
  const upstream = createServer((req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    requests.push(path);
    const game = ([3, 4] as const).find(n => path === `/api/broadcast/round/${rounds[n].id}.pgn`);
    if (game === undefined) { res.writeHead(404).end(); return; }
    const pgn = roundPgn(game);
    res.writeHead(200, { "Content-Type": "application/x-chess-pgn" }).end(
      corrected ? pgn.replace(rounds[3].moves, "1. e4 e5 2. Nf3 Nc6 ") : pgn);
  });
  const upstreamUrl = await listen(upstream);
  const launch = () => createBroadcastServer({
    dbPath: join(work, "broadcast.sqlite"), publicDir: resolve("dist/public"),
    wallNow: () => Date.parse("2026-11-28T12:00:00Z"),
    request: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.origin).toBe("https://lichess.org");
      return fetch(upstreamUrl + url.pathname + url.search, init);
    },
  });
  let app = launch();
  const context = await browser.newContext({ viewport: large, timezoneId: "Europe/London" });
  const errors: string[] = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  try {
    await mkdir(`${evidence}/g1`, { recursive: true });
    await mkdir(`${evidence}/videos`, { recursive: true });
    const base = await listen(app.server);
    const [operator, hd, compact] = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
    await compact.setViewportSize(small);
    await Promise.all([operator.goto(`${base}/operator`), hd.goto(`${base}/programme`), compact.goto(`${base}/programme`)]);
    const preview = operator.frameLocator('iframe[title="Programme preview"]').getByTestId("programme");
    const outputs = [preview, hd.getByTestId("programme"), compact.getByTestId("programme")];
    const selector = operator.getByRole("combobox", { name: "Championship game" });
    const take = (n: number) => operator.getByRole("button", { name: `Take Game ${n} to programme`, exact: true }).click();

    await sharedState(outputs, "", "unselected");
    await capture(hd, "unselected");
    await capture(compact, "unselected");
    await selector.selectOption("game-4");
    await sharedState(outputs, "", "unselected");
    await take(4);
    await sharedState(outputs, "game-4", "waiting");
    await expect(compact.getByTestId("programme")).toContainText(/waiting for the first move/i);
    await capture(hd, "game-4");
    await capture(compact, "game-4");
    await selector.selectOption("game-3");
    await sharedState(outputs, "game-4", "waiting");
    expect(requests).toEqual(["/api/broadcast/round/wIwJtPqz.pgn"]);
    await operator.screenshot({ path: `${evidence}/g1/operator.jpg`, quality: 86, fullPage: true });

    await compact.screencast.start({ path: `${evidence}/videos/g1-game-switch-720p.webm`, size: small });
    await compact.waitForTimeout(1200); // Let the reviewer read both ends of the switch.
    await take(3);
    await sharedState(outputs, "game-3", "finished");
    for (const output of outputs) {
      await expect(output).toContainText(/½\s*[–-]\s*½|1\/2-1\/2/);
      await expect(output).toContainText(/Half-moves recorded\s*4/);
      await expect(output).toContainText("2…Ng8");
    }
    await compact.waitForTimeout(1200);
    await compact.screencast.stop();
    await capture(hd, "game-3");
    await capture(compact, "game-3");
    await Promise.all([operator.reload(), hd.reload(), compact.reload()]);
    await sharedState(outputs, "game-3", "finished");
    expect(requests).toEqual(["/api/broadcast/round/wIwJtPqz.pgn", "/api/broadcast/round/fnmEB1kH.pgn"]);

    await app.close();
    corrected = true;
    app = launch();
    await listen(app.server, Number(new URL(base).port));
    // Fresh authority data distinguishes actual reconnection from a frozen pre-restart slate.
    for (const output of outputs) await expect(output).toContainText("2…Nc6", { timeout: 10_000 });
    await sharedState(outputs, "game-3", "finished");
    await expect(selector).toHaveValue("game-3");
    await operator.getByRole("button", { name: "Enter demo rehearsal", exact: true }).click();
    for (const output of outputs) await expect(output.getByText("DEMO", { exact: true })).toBeVisible();
    await operator.getByRole("button", { name: "Leave demo rehearsal", exact: true }).click();
    await sharedState(outputs, "", "unselected");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await app.close();
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(work, { recursive: true, force: true });
  }
});
