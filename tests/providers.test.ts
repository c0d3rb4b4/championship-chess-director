import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POSITION } from "chess.js";
import { decodeGame, type Binding } from "../src/server/providers/game.js";
import { SesseReplay } from "../src/server/providers/sesse.js";
import { LeelaReplay } from "../src/server/providers/leela.js";

// Original wire-shaped examples. IDs, values and player names are synthetic.
const binding: Binding = { authority: "event-pgn", gameId: "r1", event: "Example", round: "1",
  whiteId: "101", blackId: "102", startFen: DEFAULT_POSITION, clockConvention: "post-move" };
const pgn = '[Event "Example"]\n[Round "1"]\n[White "Alpha"]\n[Black "Beta"]\n[WhiteFideId "101"]\n[BlackFideId "102"]\n\n1. e4 {[%clk 0:09:58]} *';
const game = decodeGame(binding, "event-pgn", "r1", pgn);
const full = { position: { player_w: "Alpha", player_b: "Beta", fen: game.fen, history: ["e4"] }, pv: ["e5"], depth: 30, nodes: 320,
  score: ["cp", 25], refutation_lines: { c5: { pv: ["c5"], depth: 19, score: ["m", -3, "<="] } } };

test("authority binding includes event, round, identities, start and source", () => {
  for (const change of [{ event: "Other" }, { round: "2" }, { whiteId: "102" },
      { startFen: game.fen }, { gameId: "other" }, { authority: "fallback" }])
    assert.throws(() => decodeGame({ ...binding, ...change }, "event-pgn", "r1", pgn));
  assert.deepEqual(game.moves, ["e4"]);
  assert.equal(game.result, undefined);
  assert.equal(game.clocks[0].seconds, 598);
  assert.deepEqual(decodeGame({ ...binding, clockConvention: "unknown" }, "event-pgn", "r1", pgn).clocks, []);
});

test("Sesse full, incremental update, heartbeat, loss of base and full recovery", () => {
  const source = new SesseReplay(game);
  const initial = source.receive("1", undefined, full, 100);
  assert.equal(initial.principal.score?.value, 0.25);
  assert.deepEqual(initial.alternatives[0], { pv: ["c5"], depth: 19,
    score: { unit: "mate", value: -3, bound: "<=" } });
  assert.equal(game.result, undefined);
  const delta = [[["nodes"], 555], [["pv", 1], "Nf3"]];
  const revised = source.receive("2", "1", delta, 105);
  assert.deepEqual(revised.principal.pv, ["e5", "Nf3"]);
  assert.deepEqual(source.receive("2", "1", delta, 110), revised);
  source.receive("3", "2", [[["heartbeat"], 120]], 120);
  assert.equal(source.lastWorkMs, 105);
  assert.throws(() => source.receive("5", "4", [], 130), /Full snapshot/);
  assert.throws(() => source.receive("6", "5", [], 140), /Full snapshot/);
  source.receive("7", undefined, full, 150);
  assert.throws(() => source.receive("8", "7", [[["pv"], ["e4"]]], 160));
  assert.throws(() => source.receive("9", "8", [], 170));
  source.receive("10", undefined, full, 180);
  source.disconnect();
  assert.throws(() => source.receive("11", "10", [], 190));
  assert.deepEqual(source.receive("12", undefined, full, 200), initial);
  assert.throws(() => source.receive("13", undefined, { ...full, position: { ...full.position, history: [] } }, 210));
});

test("Leela partial frames preserve candidates and reject stale subscriptions or mismatched roots", () => {
  const source = new LeelaReplay();
  const receive = source.subscribe(7, game);
  const positions = [{ gameId: 7, ply: 1, fen: game.fen }];
  const update = (evalId: number, pvUci: string) => [{ gameId: 7, ply: 1, evalId,
    variations: [{ pvUci, nodes: 100, scoreW: 7000, scoreD: 6000, scoreB: 5000 }] }];
  assert.equal(receive({ evaluations: update(1, "e7e5") }), undefined);
  receive({ positions, evaluations: [{ gameId: 7, ply: 1, evalId: 0, variations: [{ nodes: 20 }] }, ...update(1, "e7e5")] });
  const both = receive({ evaluations: update(2, "c7c5") });
  assert.deepEqual(both?.candidates, [{ pv: ["e5"], evalId: 1, nodes: 100 }, { pv: ["c5"], evalId: 2, nodes: 100 }]);
  assert.deepEqual(receive({ games: [{ gameId: 8 }] }), both);
  assert.throws(() => receive({ evaluations: update(3, "e2e4") }));
  assert.deepEqual(receive({ status: {} }), both);
  assert.equal(receive({ positions: [{ ...positions[0], fen: DEFAULT_POSITION }] }), undefined);
  source.disconnect();
  assert.equal(receive({ positions }), undefined);
  const switched = source.subscribe(8, game);
  assert.equal(receive({ positions }), undefined);
  assert.equal(switched({ positions, evaluations: update(1, "e7e5") }), undefined);
});
