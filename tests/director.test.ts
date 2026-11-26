import { test } from "node:test";
import assert from "node:assert/strict";
import { Director } from "../src/server/director.js";
import { demo, providers, rootKey, variationFrames } from "../src/server/fixtures.js";

test("deterministic think → frozen variation → actual move, including an equal-time PV deadline", () => {
  const replay = () => {
    const director = new Director();
    return [
      0, 3000, 6000, 74999, 75000, 77000, 79000, 81000, 82999, 83000, 89000,
      109999,
    ].map((t) => director.advanceTo(t));
  };
  const a = replay();
  assert.deepEqual(
    a,
    replay(),
    "identical observations and presentation times produce identical snapshots",
  );
  assert.equal(a[0].scene.kind, "thinking");
  assert.equal(a[1].engines[0].status, "Provisional");
  assert.equal(a[2].engines[0].status, "Ready");
  assert.deepEqual(a[2].engines[1].wdl, [30, 50, 20]);
  const root = a[0].actual.fen;
  const spotlight = a[4];
  assert.equal(spotlight.scene.kind, "spotlight");
  assert.equal(spotlight.scene.frameIndex, 0);
  assert.equal(spotlight.scene.frames!.length, 9);
  for (const s of a.slice(4, 9)) {
    assert.equal(
      s.actual.fen,
      root,
      "hypothetical playback must never advance the actual game",
    );
    assert.equal(s.game.ply, 18);
    assert.equal(s.game.turn, "w");
    assert.equal(s.scene.instance, spotlight.scene.instance);
    assert.deepEqual(
      s.scene.frames,
      spotlight.scene.frames,
      "the selected line is frozen",
    );
  }
  assert.notEqual(a[7].scene.frames![a[7].scene.frameIndex!].fen, root);
  const move = a[9];
  assert.equal(move.scene.kind, "actual-move");
  assert.equal(move.game.ply, 19);
  assert.equal(move.actual.san, "d4");
  assert.equal(move.game.turn, "b");
  assert.notEqual(move.actual.fen, root);
  assert.notEqual(move.scene.instance, spotlight.scene.instance);
  assert.equal(
    move.scene.frames,
    undefined,
    "the old playback is removed atomically",
  );
  assert(
    move.engines.every(
      (x) =>
        x.status === "Updating for this position" &&
        x.candidates.length === 0 &&
        x.score === "—" &&
        !x.wdl,
    ),
  );
  for (const s of a.slice(10)) {
    assert.equal(s.scene.kind, "thinking");
    assert.equal(
      s.actual.fen,
      move.actual.fen,
      "an expired scene cannot resurrect a hypothetical board",
    );
    assert.equal(s.scene.frames, undefined);
  }
});

for (const phase of [75000, 77000, 79000, 81000, 82999]) {
  test(`operator release interrupts spotlight at ${phase} ms without an old callback returning`, () => {
    const director = new Director();
    const old = director.advanceTo(phase);
    assert.equal(old.scene.kind, "spotlight");
    const actual = director.command("release-move");
    assert.equal(actual.scene.kind, "actual-move");
    assert.notEqual(actual.scene.instance, old.scene.instance);
    assert.equal(actual.game.ply, 19);
    assert.equal(director.advanceTo(109999).actual.fen, actual.actual.fen);
  });
}

test("reload/restart recovery retains the current scene, frames, epoch and eligible actual board", () => {
  const director = new Director();
  const old = director.advanceTo(79000);
  const restored = new Director(director.checkpoint());
  const resumed = restored.advanceTo(79000);
  assert.equal(resumed.scene.instance, old.scene.instance);
  assert.deepEqual(resumed.scene.frames, old.scene.frames);
  assert.equal(resumed.scene.frameIndex, 2);
  const moved = restored.advanceTo(83000);
  const again = new Director(restored.checkpoint()).snapshot();
  assert.equal(again.actual.fen, moved.actual.fen);
  assert.equal(again.scene.kind, "actual-move");
});

test("return to actual board does not advance the game; a new epoch invalidates every previous scene", () => {
  const director = new Director();
  const old = director.advanceTo(79000);
  const returned = director.command("return-live");
  assert.equal(returned.actual.fen, old.actual.fen);
  assert.equal(returned.scene.kind, "thinking");
  assert.equal(director.advanceTo(80000).scene.kind, "thinking");
  const restarted = director.command("restart");
  assert.equal(restarted.presentationMs, 0);
  assert.equal(restarted.game.epoch, 2);
  assert.notEqual(restarted.game.rootKey, old.game.rootKey);
  assert.notEqual(restarted.scene.instance, old.scene.instance);
  assert.equal(director.command("cue-spotlight").scene.kind, "spotlight");
});

test("a legal position alone cannot bind different games or histories; invalid PVs fail closed", () => {
  const root = rootKey(demo.id, 1, 1, demo.moves);
  assert.notEqual(rootKey("another-game", 1, 1, demo.moves), root);
  assert.notEqual(rootKey(demo.id, 1, 2, demo.moves), root);
  // Knights return to their starting squares: same pieces, different legal history and counters.
  assert.notEqual(
    rootKey(demo.id, 1, 1, ["Nf3", "Nf6", "Ng1", "Ng8"]),
    rootKey(demo.id, 1, 1, []),
  );
  assert.throws(() => variationFrames(demo.moves, ["d4", "Qh1"]));
  assert.throws(() => new Director().advanceTo(-1));
});

test("fixture scorecards retain a negative pawn score and a genuine zero outcome", () => {
  const originalScore = providers.sesse.positions[0].score.value;
  const originalWdl = providers.leela.positions[0].wdl.values;
  try {
    providers.sesse.positions[0].score.value = -0.35;
    providers.leela.positions[0].wdl.values = [0, 615, 385];
    const [stockfish, leela] = new Director().advanceTo(6000).engines;
    assert.equal(stockfish.score, "-0.35");
    assert.deepEqual(leela.wdl, [0, 61.5, 38.5]);
    providers.sesse.positions[0].score.value = 0;
    assert.equal(new Director().advanceTo(6000).engines[0].score, "0.00");
  } finally {
    providers.sesse.positions[0].score.value = originalScore;
    providers.leela.positions[0].wdl.values = originalWdl;
  }
});

test("each release boundary atomically selects the game, clocks and matching analysis", () => {
  const boundaries = [3000, 6000, 75000, 77000, 79000, 81000, 83000, 89000,
    90000, 92000, 93000, 96000, 99000, 102000, 110000, 116000];
  const times = boundaries.flatMap(t => [t - 1, t, t + 1]);
  function run() {
    const director = new Director();
    return times.map(t => director.advanceTo(t));
  }
  const snapshots = run();
  assert.deepEqual(snapshots, run());
  for (const s of snapshots) {
    const t = s.presentationMs;
    const actualMoves = [...demo.moves];
    if (t >= 83000) actualMoves.push("d4");
    if (t >= 110000) actualMoves.push("exd4");
    const ply = actualMoves.length;
    assert.deepEqual(s.game.moves, actualMoves);
    assert.equal(s.game.rootKey, rootKey(demo.id, 1, 1, actualMoves));
    assert.equal(s.game.turn, ply % 2 === 0 ? "w" : "b");
    assert.equal(s.game.ply, ply);
    assert.equal(s.actual.san, actualMoves.at(-1));
    assert.deepEqual(s.actual, variationFrames(actualMoves, [])[0]);
    assert.equal(s.clocks.whiteMs, ply === 18 ? 3180000 - t : 3127000 - Math.max(0, t - 110000));
    assert.equal(s.clocks.blackMs, ply === 19 ? 4860000 - (t - 83000) : ply === 20 ? 4863000 : 4860000);
    if (ply === 18) continue;
    assert.equal(s.scene.frames, undefined);
    assert.equal(s.scene.kind, t < 89000 || (t >= 110000 && t < 116000) ? "actual-move" : "thinking");
    for (const engine of s.engines) {
      const stockfish = engine.id === "sesse";
      const first = stockfish ? 90000 : 96000;
      if (t < first || ply === 20) {
        assert.equal(engine.score, "—");
        assert.equal(engine.depth, undefined);
        assert.equal(engine.work, undefined);
        assert.equal(engine.wdl, undefined);
        assert.deepEqual(engine.candidates, []);
        assert.equal(engine.status, "Updating for this position");
      } else {
        const step = Math.min(2, Math.floor((t - first) / 3000));
        assert.equal(engine.depth, (stockfish ? 24 : 18) + step);
        assert.equal(engine.work, (stockfish ? 4000000 : 20000) * (step + 1));
        assert.equal(engine.status, step === 2 ? "Ready" : "Provisional");
        assert.equal(engine.score, stockfish ? "+0.18" : "26 / 54 / 20");
        assert.equal(engine.candidates[0].moves[0], "exd4");
        assert.deepEqual(engine.wdl, stockfish ? undefined : [26, 54, 20]);
      }
    }
  }
});

test("rejects a legal but unrelated second root and illegal PV tails beyond playback", () => {
  const position = providers.leela.positions[1];
  const history = position.rootMoves;
  try {
    position.rootMoves = [...demo.moves, "h3"];
    assert.throws(() => new Director(), /Wrong game or history/);
  } finally {
    position.rootMoves = history;
  }
  const fullLine = providers.sesse.positions[0].candidates[0].pv;
  assert.throws(() => variationFrames(demo.moves, [...fullLine, "Qh8"]));
});
