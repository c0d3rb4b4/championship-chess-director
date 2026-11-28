import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { loadCatalogue } from "../src/server/catalogue.js";
import { boardFrame } from "../src/server/fixtures.js";
import { decodeBoundGame, gameSummary } from "../src/server/game-summary.js";
import { Recap } from "../src/server/recap.js";
import { Store } from "../src/server/store.js";
import type { LiveAnalysis, ReleasedPosition } from "../src/shared/types.js";
import { finalResult, sans, score, startFen } from "./finished-game.js";

const mapped = loadCatalogue().games[2];
const game = { ...mapped, startFen, binding: { ...mapped.binding!, elapsedTime: "pgn-emt" as const } };
const finishedAt = 1_000;

function position(moves: string[], done = false, revision = 1): ReleasedPosition {
  const board = new Chess(startFen);
  moves.forEach(san => board.move(san));
  const actual = boardFrame(board);
  return { startFen, actual, moves, revision, summary: { result: done ? finalResult : null,
    plies: moves.length, lastSan: moves.at(-1) ?? null, fen: actual.fen, observedAt: new Date(finishedAt).toISOString() } };
}

test("finished rundown is reproducible, preserves gaps and replays every accepted FEN, mover and SAN", () => {
  const pgn = score(game, sans.length, finalResult);
  const decoded = decodeBoundGame(game, pgn);
  const ordinary = decodeBoundGame({ ...game, binding: mapped.binding }, pgn);
  assert.equal(ordinary.elapsed, undefined);
  assert.equal(gameSummary(decoded).lastSan, "Rxa8");
  assert.deepEqual(decoded.elapsed?.map(({ ply, elapsedMs }) => [ply, elapsedMs]),
    [[1, 12000], [2, 5000], [4, 21000], [5, 0], [6, 17000]]);

  const final = { ...position(decoded.moves, true), opening: decoded.opening, elapsed: decoded.elapsed };
  const store = new Store(":memory:");
  try {
    const authority = (ply: number, at: number, done = false) =>
      store.feedEvent(1, game.id, "authority", null, at, at, null,
        { interrupted: false, position: done ? final : position(sans.slice(0, ply)) });
    const engine = (root: number, at: number, source: "sesse" | "leela", analysis: LiveAnalysis) =>
      store.feedEvent(1, game.id, source, root, at, at, null, analysis);
    const first = authority(1, 10);
    engine(first, 11, "sesse", { line: ["O-O"], pawns: 0 });
    engine(first, 20, "sesse", { line: ["O-O"], pawns: 20 }); // next authority wins this tie
    const third = authority(3, 20);
    engine(third, 21, "leela", { line: ["gxh1=Q"], wdl: [25, 50, 25] });
    const id = authority(6, finishedAt, true);
    const journal = store.recapJournal(1, game.id, id, finishedAt);
    const make = () => new Recap(game.id, final, finishedAt, journal);
    const a = make(), b = make();
    const at = (ms: number) => {
      assert.deepEqual(a.at(finishedAt + ms), b.at(finishedAt + ms));
      return a.at(finishedAt + ms);
    };
    assert.equal(at(29_999).page, "result");
    assert.equal(at(30_000).page, "numbers");
    assert.equal(at(41_999).page, "numbers");
    const times = at(42_000);
    assert.equal(times.page, "time");
    assert.deepEqual(times.white, { moves: 3, captures: 2, timedMoves: 2, totalMs: 12_000,
      longest: { label: "1.O-O-O", elapsedMs: 12_000 } });
    assert.deepEqual(times.black, { moves: 3, captures: 2, timedMoves: 3, totalMs: 43_000,
      longest: { label: "2...gxh1=Q", elapsedMs: 21_000 } });
    assert.equal(times.opening, "Local composition");
    assert.equal(times.samples[3].elapsedMs, undefined);
    const evals = at(57_000);
    assert.equal(evals.page, "evaluation");
    assert.equal(evals.samples[0].label, "0");
    assert.equal(evals.samples[0].pawns, undefined);
    assert.equal(evals.samples[1].pawns, 0);
    assert.equal(evals.samples[2].pawns, undefined);
    assert.deepEqual(evals.samples[3].wdl, [25, 50, 25]);
    const pgnMoves = new Chess();
    pgnMoves.loadPgn(pgn, { strict: true });
    const records = pgnMoves.history({ verbose: true });
    for (let ply = 0; ply <= records.length; ply++) {
      const frame = at(72_000 + 2_000 * ply).replay!;
      const move = records[ply - 1];
      assert.equal(frame.gameId, game.id);
      assert.equal(frame.ply, ply);
      assert.equal(frame.mover, move?.color);
      assert.equal(frame.frame.fen, move?.after ?? startFen);
      assert.equal(frame.frame.san, move?.san ?? "");
      assert.equal(frame.frame.from, move?.from);
      assert.equal(frame.frame.to, move?.to);
    }
    assert.equal(at(87_999).replay?.ply, 6);
    assert.equal(at(88_000).page, "result");
  } finally { store.close(); }
});

test("zero-ply results, final-root-only samples and corrected suffixes stay factual", () => {
  const empty = new Recap(game.id, position([], true), 0, { roots: [], samples: [] });
  assert.equal(empty.at(120_000).page, "result");
  const moves = sans.slice(0, 3);
  const final = position(moves, true, 2);
  const roots = [
    { id: 4, position: final, interrupted: false },
    { id: 3, position: position(moves, false, 2), interrupted: false },
    { id: 2, position: position(moves.slice(0, 1), false, 2), interrupted: false },
    { id: 1, position: position(moves.slice(0, 2)), interrupted: false },
  ];
  const recap = new Recap(game.id, final, 0, { roots, samples: [
    { root: 3, source: "sesse", analysis: { line: ["gxh1=Q"], pawns: .75 } },
    { root: 1, source: "sesse", analysis: { line: ["bxa8=Q"], pawns: 10 } },
  ] });
  assert.equal(recap.at(42_000).page, "replay");
  const samples = recap.at(42_000).samples;
  assert.equal(samples[2].pawns, undefined);
  assert.equal(samples[3].pawns, .75);
});

test("a Black-to-move setup counts en passant and keeps its PGN full-move number", () => {
  const startFen = "4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 19";
  const game = new Chess(startFen);
  game.move("exd3");
  const actual = boardFrame(game);
  const recap = new Recap("black-first", { startFen, actual, moves: ["exd3"], revision: 1,
    summary: { result: "0-1", plies: 1, lastSan: "exd3", fen: actual.fen, observedAt: new Date(0).toISOString() } },
  0, { roots: [], samples: [] });
  assert.equal(recap.at(30_000).black.captures, 1);
  assert.equal(recap.at(30_000).white.moves, 0);
  assert.equal(recap.at(44_000).replay?.frame.moveLabel, "19...exd3");
});
