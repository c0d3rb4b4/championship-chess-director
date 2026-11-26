import { test } from "node:test";
import assert from "node:assert/strict";
import { Director } from "../src/server/director.js";
import { demo, rootKey, variationFrames } from "../src/server/fixtures.js";

test("deterministic think → frozen variation → actual move, including an equal-time PV deadline", () => {
  const replay = () => {
    const director = new Director();
    return [
      0, 3000, 6000, 74999, 75000, 77000, 79000, 81000, 82999, 83000, 89000,
      120000,
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
    assert.equal(director.advanceTo(120000).actual.fen, actual.actual.fen);
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
