import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { boardFrame, replay, rootKey } from "../../src/server/fixtures.js";
import type { Game } from "../../src/server/providers/game.js";
import type { LeelaReplay } from "../../src/server/providers/leela.js";
import type { SesseReplay } from "../../src/server/providers/sesse.js";
import type { EngineView, ProgrammeSnapshot } from "../../src/shared/types.js";

type Row = { receivedMs: number } & (
  | { source: "authority"; observation: Game }
  | { source: "sesse"; observation: ReturnType<SesseReplay["receive"]> }
  | { source: "leela"; observation: NonNullable<ReturnType<ReturnType<LeelaReplay["subscribe"]>>> }
);

function pending(id: EngineView["id"], name: string): EngineView {
  return { id, name, source: id === "sesse" ? "Sesse" : "Leela", candidates: [],
    status: "Updating for this position", score: "", scoreLabel: "" };
}

function authoritySnapshot(game: Game): ProgrammeSnapshot {
  const board = replay(game.moves, game.binding.startFen);
  expect(board.fen()).toBe(game.fen);
  const clocks = { whiteMs: 600000, blackMs: 600000 };
  for (const clock of game.clocks) {
    const mover = clock.fen.split(" ")[1] === "b" ? "whiteMs" : "blackMs";
    clocks[mover] = clock.seconds * 1000;
  }
  return { sequence: 0, presentationMs: 0, mode: "DEMO", connected: true,
    game: { id: game.binding.gameId, epoch: 1, revision: 1,
      rootKey: rootKey(game.binding.gameId, 1, 1, game.moves), event: game.binding.event,
      round: "Round " + game.binding.round, white: game.white, black: game.black, opening: "",
      ply: game.moves.length, turn: board.turn(), moves: game.moves },
    actual: boardFrame(board), clocks, engines: [pending("sesse", "Stockfish"), pending("leela", "Leela")],
    scene: { kind: "thinking", instance: "ply-" + game.moves.length, title: "Engine comparison" },
    panel: "comparison", moveTimes: [], history: [], ticker: "" };
}

function simulate() {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/replay-providers.mjs",
    "fixtures/provider-simulation.json"], { encoding: "utf8" });
  const rows: Row[] = output.trim().split("\n").map(line => JSON.parse(line));
  // Neither traffic during the authority gap nor frames from old subscriptions may emit.
  expect(rows.map(row => row.receivedMs)).toEqual([0, 1, 2, 4, 5, 6, 7, 9, 11, 14, 15, 18]);
  const states = new Map<number, ProgrammeSnapshot>();
  let state: ProgrammeSnapshot | undefined;
  for (const row of rows) {
    if (row.source === "authority") state = authoritySnapshot(row.observation);
    else {
      if (!state) throw Error("Analysis before authority");
      expect(row.observation.fen).toBe(state.actual.fen);
      if (row.source === "sesse") {
        const { principal, alternatives, nodes } = row.observation;
        state.engines[0] = { ...state.engines[0], status: "Provisional",
          score: String(principal.score?.value ?? ""), work: nodes, workUnit: "nodes",
          candidates: [principal, ...alternatives].map(c => ({ depth: c.depth, moves: c.pv })) };
      } else {
        state.engines[1] = { ...state.engines[1], status: "Provisional",
          candidates: row.observation.candidates.map(c => ({ moves: c.pv })) };
      }
    }
    state.presentationMs = row.receivedMs;
    states.set(row.receivedMs, structuredClone(state));
  }
  expect(states.get(5)?.engines[0].work).toBe(910);
  expect(states.get(6)?.engines[1].candidates[0].moves).toEqual(["c5", "Nf3"]);
  expect(states.get(18)?.engines).toEqual(states.get(11)?.engines);
  return states;
}

test("capture in-play provider replay at both broadcast sizes", async ({ page }) => {
  const stages = [
    [4, "01-bound", "e5", "c5"], [6, "02-search-update", "e5", "c5"],
    [7, "03-move-pending", "", ""], [9, "04-sesse-return", "Nf3", ""],
    [11, "05-both-return", "Nf3", "Bc4"], [14, "06-reconnected-pending", "", ""],
    [18, "07-recovered", "Nf3", "Bc4"]
  ] as const;
  const states = simulate();
  const dir = "test-results/provider-screenshots";
  await mkdir(dir, { recursive: true });
  let current = states.get(4)!;
  await page.route("**/api/programme", route => route.fulfill({ json: current }));
  await page.addInitScript(() => {
    class SimulationStream extends EventTarget {
      constructor() {
        super();
        window.addEventListener("simulation", e =>
          this.dispatchEvent(new MessageEvent("snapshot", { data: (e as CustomEvent).detail })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: SimulationStream });
  });
  await page.goto("/programme");
  const board = page.getByTestId("actual-board");
  await expect(board).toBeVisible();
  let sequence = 0;
  for (const [time, name, stockfish, leela] of stages) {
    current = states.get(time)!;
    current.sequence = ++sequence;
    await page.evaluate(data => window.dispatchEvent(new CustomEvent("simulation", { detail: data })),
      JSON.stringify(current));
    await expect(board).toHaveAttribute("data-fen", current.actual.fen);
    await expect(page.locator(".connection-banner")).toBeHidden();
    await expect(page.locator(".played-moves b")).toHaveText(time < 7 ? ["e4"] : ["e4", "e5"]);
    await expect(page.locator('[data-clock="w"]')).toHaveText("00:09:58");
    await expect(page.locator('[data-clock="b"]')).toHaveText(time < 7 ? "00:10:00" : "00:09:54");
    for (const [source, san] of [["sesse", stockfish], ["leela", leela]]) {
      const candidates = page.locator("." + source + " tbody th");
      if (san) await expect(candidates).toHaveText([san]);
      else await expect(candidates).toHaveCount(0);
    }
    if (time === 6) await expect(page.locator(".sesse tbody td").last()).toHaveText("32");
    await expect(page.locator(".wdl")).toHaveCount(0);
    for (const height of [1080, 720]) {
      await page.setViewportSize({ width: height * 16 / 9, height });
      await expect(board).toBeInViewport({ ratio: .999 });
      await expect(page.locator(".played-moves")).toBeInViewport({ ratio: .999 });
      await page.screenshot({ path: dir + "/" + name + "-" + height + ".png" });
    }
  }
  await writeFile(dir + "/stages.json", JSON.stringify(stages.map(([time, name]) =>
    ({ name, snapshot: states.get(time) })), null, 2));
});
