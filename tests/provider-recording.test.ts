import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("replay reconnects all three providers and ignores pre-recovery traffic", t => {
  const dir = mkdtempSync(join(tmpdir(), "provider-replay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "capture.json");
  const recording = JSON.parse(readFileSync("fixtures/provider-replay.json", "utf8"));
  const [authority, full, delta, subscribe, frame] = recording.packets;
  const close = { source: "authority", authority: authority.authority, gameId: authority.gameId,
    event: "disconnect", receivedMs: 7 };
  recording.packets.push(
    { ...delta, version: "102", base: "101", body: [], receivedMs: 5 },
    { ...frame, body: { status: {} }, receivedMs: 6 },
    close, { ...frame, receivedMs: 8 }, { ...delta, receivedMs: 9 },
    { ...authority, receivedMs: 10 }, { ...full, receivedMs: 11 },
    { ...subscribe, connection: 2, receivedMs: 12 }, { ...frame, receivedMs: 13 },
    { ...frame, connection: 2, receivedMs: 14 }
  );
  const run = () => {
    writeFileSync(file, JSON.stringify(recording));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-providers.mjs", file], { encoding: "utf8" });
  };
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(run().stdout, first.stdout);
  const observations = first.stdout.trim().split("\n").map(row => JSON.parse(row));
  assert.deepEqual(observations.map(row => row.receivedMs), [0, 1, 2, 4, 5, 6, 10, 11, 14]);
  for (const [before, after] of [[0, 6], [1, 7], [3, 8], [2, 4], [3, 5]])
    assert.deepEqual(observations[before].observation, observations[after].observation);

  recording.packets.push({ ...subscribe, receivedMs: 15 });
  assert.match(run().stderr, /Reused Leela connection generation/);
  close.gameId = "unrelated";
  assert.match(run().stderr, /Unbound authority disconnect/);
});
