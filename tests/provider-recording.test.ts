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
    { ...authority, receivedMs: 10 },
    { ...delta, receivedMs: 10.5 }, // A versioned delta cannot cross the disconnect.
    { ...full, receivedMs: 11 },
    { ...subscribe, connection: 2, receivedMs: 12 }, { ...frame, receivedMs: 13 },
    { ...frame, connection: 2, receivedMs: 14 }
  );
  const run = () => {
    writeFileSync(file, JSON.stringify(recording));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-providers.mjs", file], { encoding: "utf8" });
  };
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /Sesse packet at 10\.5: full snapshot required/);
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

test("coverage requires live moves, work updates, idle traffic and each provider's recovery", t => {
  const dir = mkdtempSync(join(tmpdir(), "provider-coverage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "capture.json");
  const recording = JSON.parse(readFileSync("fixtures/provider-simulation.json", "utf8"));
  const packet = (at: number) => recording.packets.find((row: { receivedMs: number }) => row.receivedMs === at);
  const authority = packet(0);
  const oldFrame = packet(4);
  const newFrame = packet(18);
  const run = () => {
    writeFileSync(file, JSON.stringify(recording));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-providers.mjs", file, "--coverage"],
      { encoding: "utf8" });
  };

  const partial = run();
  assert.equal(partial.status, 2, partial.stderr);
  const report = JSON.parse(partial.stdout);
  assert.deepEqual(report.pending, [
    "authority: idle traffic", "sesse: disconnect and recovery",
    "leela: idle traffic", "leela: disconnect and recovery",
  ]);
  assert.deepEqual(report.evidence.sharedMove, {
    before: { ply: 1, authorityAt: 0, sesseAt: 1, leelaAt: 4 },
    after: { ply: 2, authorityAt: 7, sesseAt: 9, leelaAt: 11 },
  });
  assert.deepEqual(report.evidence.clockedSharedMove.after.clock, { receivedMs: 7, seconds: 594 });
  assert.deepEqual(report.evidence.authority.recovered, { disconnectedAt: 12, recoveredAt: 18 });

  recording.packets.splice(recording.packets.indexOf(packet(7)), 0,
    { ...oldFrame, receivedMs: 6.25, body: { status: {} } },
    { ...authority, receivedMs: 6.5 });
  recording.packets.push(
    { source: "sesse", event: "disconnect", receivedMs: 19 },
    { ...packet(15), receivedMs: 20 },
    // A scheduled subscription change is excluded even with a fresh matching evaluation.
    { source: "leela", connection: 3, event: "disconnect", reason: "authority root changed", receivedMs: 21 },
    { ...packet(16), connection: 4, receivedMs: 22 },
    { ...newFrame, connection: 4, receivedMs: 23 }
  );
  const rollover = run();
  assert.equal(rollover.status, 2, rollover.stderr);
  assert.deepEqual(JSON.parse(rollover.stdout).pending, ["leela: disconnect and recovery"]);

  recording.packets.push(
    { source: "leela", connection: 4, event: "disconnect", reason: "socket closed", receivedMs: 24 },
    { ...newFrame, connection: 4, receivedMs: 25 },
    { ...packet(16), connection: 5, ply: 2, receivedMs: 26 },
    { ...newFrame, connection: 5, receivedMs: 27 }
  );
  const complete = run();
  assert.equal(complete.status, 0, complete.stderr);
  const { evidence, pending } = JSON.parse(complete.stdout);
  assert.deepEqual(pending, []);
  assert.deepEqual(evidence.leela.recovered, { disconnectedAt: 24, recoveredAt: 27 });
  assert.equal(evidence.leela.workAt, 6);
  assert.equal(complete.stdout, run().stdout);
});

test("coverage rejects an archived result as evidence of in-play search or clocks", t => {
  const dir = mkdtempSync(join(tmpdir(), "provider-archive-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "capture.json");
  const recording = JSON.parse(readFileSync("fixtures/provider-replay.json", "utf8"));
  recording.packets[0].body = recording.packets[0].body.replace(/\*$/, "1/2-1/2");
  writeFileSync(file, JSON.stringify(recording));
  const result = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/replay-providers.mjs", file, "--coverage"], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  const { evidence } = JSON.parse(result.stdout);
  assert.equal(evidence.sesse.workAt, null);
  assert.equal(evidence.sharedMove, null);
  assert.equal(evidence.clockedSharedMove, null);
});
