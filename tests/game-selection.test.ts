import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Director } from "../src/server/director.js";
import { createBroadcastServer } from "../src/server/http.js";
import type { Catalogue } from "../src/shared/catalogue.js";
import type { BroadcastOperator, BroadcastSnapshot, RealProgramme } from "../src/shared/types.js";

type UpstreamCall = { url: string; reply: (response: Response) => void };
function controlledUpstream() {
  const calls: UpstreamCall[] = [];
  // Deliberately finish even an aborted request to exercise the epoch fence.
  const request: typeof fetch = async (input) => new Promise<Response>(reply => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, reply });
  });
  return { calls, request };
}

async function launch(dbPath: string, request: typeof fetch, cataloguePath?: string) {
  const app = createBroadcastServer({
    dbPath, publicDir: resolve("dist/public"), request, cataloguePath,
    now: () => 0, wallNow: () => Date.parse("2026-11-28T12:00:00Z"),
  });
  await new Promise<void>(ready => app.server.listen(0, "127.0.0.1", ready));
  const addr = app.server.address();
  assert(addr && typeof addr !== "string");
  const url = `http://127.0.0.1:${addr.port}`;
  const programme = async (): Promise<BroadcastSnapshot> => (await fetch(url + "/api/programme")).json();
  const operator = async (): Promise<BroadcastOperator> => (await fetch(url + "/api/operator")).json();
  const real = async (): Promise<RealProgramme> => {
    const snapshot = await programme();
    assert.equal(snapshot.mode, "REAL");
    return snapshot;
  };
  const command = (body: object, origin = url) => fetch(url + "/api/operator/command", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
  return { app, url, programme, real, operator, command };
}

async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail("Expected the upstream response to be reflected on the server");
}

function select(id: string, gameId: string, selectionEpoch: number) {
  return { id, command: "select-game", gameId, selectionEpoch };
}

function gameThreePgn(whiteId = "14205483") {
  return `[Event "FIDE World Chess Championship Match"]
[Site "Geneva, Switzerland"]
[Round "3.1"]
[White "Sindarov, Javokhir"]
[Black "Gukesh D"]
[WhiteFideId "${whiteId}"]
[BlackFideId "46616543"]
[Result "1/2-1/2"]
[GameURL "https://lichess.org/broadcast/fide-world-chess-championship-2026/game-3/fnmEB1kH/RD8sbYw1"]

1. d4 d5 1/2-1/2`;
}

test("real selections, retries, late replies and restored snapshots share one authority request per take", async () => {
  const temp = await mkdtemp(join(tmpdir(), "chess-g1-"));
  const db = join(temp, "air.sqlite");
  const upstream = controlledUpstream();
  let host = await launch(db, upstream.request);
  try {
    const initial = await host.real();
    assert.equal(initial.state, "unselected");
    assert.equal(initial.game, null);
    assert.equal(initial.summary, null);
    const epoch = initial.selectionEpoch;
    const game4 = select("take-four", "game-4", epoch);
    assert.equal((await host.command(game4, "https://untrusted.example")).status, 403);
    assert.ok((await host.command(select("unknown", "no-such-round", epoch))).status >= 400);
    assert.equal((await host.real()).selectionEpoch, epoch);
    assert.equal(upstream.calls.length, 0);

    assert.equal((await host.command(game4)).status, 200);
    const pending = await host.real();
    assert.equal(pending.game?.id, "game-4");
    assert.equal(pending.summary, null);
    const retry = await host.command(game4);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal((await host.command(select(game4.id, "game-3", epoch))).status, 409);
    assert.equal((await host.command(select("stale", "game-3", epoch))).status, 409);
    const game3 = select("take-three", "game-3", pending.selectionEpoch);
    assert.equal((await host.command(game3)).status, 200);
    await eventually(async () => upstream.calls.length === 2);
    assert.match(upstream.calls[0].url, /\/wIwJtPqz\.pgn/);
    assert.match(upstream.calls[1].url, /\/fnmEB1kH\.pgn/);
    upstream.calls[1].reply(new Response(gameThreePgn()));
    await eventually(async () => (await host.real()).state === "finished");
    const accepted = await host.real();
    assert.equal(accepted.game?.id, "game-3");
    assert.equal(accepted.summary?.plies, 2);
    assert.equal(accepted.summary.lastSan, "d5");
    assert.equal(accepted.summary.result, "1/2-1/2");
    // A late malformed response for Game 4 must not disturb Game 3's verified summary or diagnostics.
    upstream.calls[0].reply(new Response("late Game 4 failure", { status: 503 }));
    await delay(20);
    const control = await host.operator();
    assert.equal(control.authorityStatus, "verified");
    assert.deepEqual(control.programme, await host.programme());
    const publicSnapshot = await host.real();
    for (const field of ["binding", "diagnostic", "authorityStatus", "clockConvention", "engines", "clocks", "ticker"]) {
      assert.equal(JSON.stringify(publicSnapshot).includes(`"${field}"`), false);
    }
    assert.equal((await host.command(game4)).status, 200);
    assert.equal((await host.real()).game?.id, "game-3");
    assert.equal(upstream.calls.length, 2);

    await host.app.close();
    host = await launch(db, upstream.request);
    const restored = await host.real();
    assert.equal(restored.game?.id, "game-3");
    assert.equal(restored.selectionEpoch, accepted.selectionEpoch);
    assert.deepEqual(restored.summary, accepted.summary);
    assert.equal((await (await host.command(game3)).json()).duplicate, true);
  } finally {
    await host.app.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a chapter with mismatched player identity supplies no programme summary", async () => {
  const temp = await mkdtemp(join(tmpdir(), "chess-identity-"));
  const upstream = controlledUpstream();
  const host = await launch(join(temp, "air.sqlite"), upstream.request);
  try {
    assert.equal((await host.command(select("take", "game-3", (await host.real()).selectionEpoch))).status, 200);
    await eventually(async () => upstream.calls.length === 1);
    upstream.calls[0].reply(new Response(gameThreePgn("9999999")));
    await eventually(async () => (await host.operator()).authorityStatus === "mismatch");
    const snapshot = await host.real();
    assert.equal(snapshot.game?.id, "game-3");
    assert.equal(snapshot.summary, null);
    assert.ok((await host.operator()).diagnostic);
  } finally {
    await host.app.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("legacy rehearsal starts off air, resumes its checkpoint on explicit entry, and fences old rehearsal cues", async () => {
  const temp = await mkdtemp(join(tmpdir(), "chess-legacy-"));
  const dbPath = join(temp, "old.sqlite");
  const original = new Director();
  original.command("release-move");
  const checkpoint = original.checkpoint();
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE checkpoint (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE commands (id TEXT PRIMARY KEY, command TEXT NOT NULL, epoch INTEGER NOT NULL, applied_ms INTEGER NOT NULL);
  `);
  legacy.prepare("INSERT INTO checkpoint VALUES (1, ?)").run(JSON.stringify(checkpoint));
  legacy.close();
  const upstream = controlledUpstream();
  let host = await launch(dbPath, upstream.request);
  try {
    const initial = await host.real();
    assert.equal(initial.state, "unselected");
    const cue = { id: "restart-demo", command: "restart", epoch: checkpoint.epoch, revision: 1 };
    assert.ok((await host.command({ ...cue, selectionEpoch: initial.selectionEpoch })).status >= 400);
    assert.equal((await host.command({ id: "rehearse", command: "enter-demo", selectionEpoch: initial.selectionEpoch })).status, 200);
    const rehearsal = await host.programme();
    assert.equal(rehearsal.mode, "DEMO");
    assert.equal(rehearsal.actual.fen, original.snapshot().actual.fen);
    assert.equal(rehearsal.presentationMs, checkpoint.elapsedMs);
    assert.equal((await host.command({ id: "leave", command: "clear-selection", selectionEpoch: rehearsal.selectionEpoch })).status, 200);
    const neutral = await host.real();
    assert.equal(neutral.game, null);
    assert.equal((await host.command({ id: "re-enter", command: "enter-demo", selectionEpoch: neutral.selectionEpoch })).status, 200);
    assert.equal((await host.command({ ...cue, selectionEpoch: rehearsal.selectionEpoch })).status, 409);
    const onAirDemo = await host.programme();
    assert.equal(onAirDemo.mode, "DEMO");
    await host.app.close();
    host = await launch(dbPath, upstream.request);
    const restarted = await host.real();
    assert.equal(restarted.state, "unselected");
    assert.equal(restarted.game, null);
    assert.ok(restarted.selectionEpoch > onAirDemo.selectionEpoch!);
    assert.equal((await host.command({
      id: "resume-after-restart", command: "enter-demo", selectionEpoch: restarted.selectionEpoch,
    })).status, 200);
    const resumed = await host.programme();
    assert.equal(resumed.mode, "DEMO");
    assert.equal(resumed.actual.fen, onAirDemo.actual.fen);
    assert.equal(resumed.presentationMs, onAirDemo.presentationMs);
    assert.equal(upstream.calls.length, 0);
  } finally {
    await host.app.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a published round without its feed binding can go to air and restore during a catalogue outage", async () => {
  const temp = await mkdtemp(join(tmpdir(), "chess-pending-"));
  const db = join(temp, "air.sqlite");
  const path = join(temp, "catalogue.json");
  const catalogue: Catalogue = JSON.parse(await readFile("config/championship.json", "utf8"));
  const pending = catalogue.games.find(g => g.id === "game-4")!;
  pending.binding = null;
  await writeFile(path, JSON.stringify(catalogue));
  const upstream = controlledUpstream();
  let host = await launch(db, upstream.request, path);
  try {
    assert.equal((await host.command(select("take", pending.id, (await host.real()).selectionEpoch))).status, 200);
    assert.equal((await host.operator()).authorityStatus, "pending-binding");
    const slate = await host.real();
    assert.equal(slate.game?.scheduledStart, pending.scheduledStart);
    assert.equal(slate.summary, null);
    await host.app.close();
    await rm(path);
    host = await launch(db, upstream.request, path);
    assert.equal((await host.operator()).authorityStatus, "pending-binding");
    const restored = await host.real();
    assert.deepEqual(restored.game, slate.game);
    assert.equal(restored.selectionEpoch, slate.selectionEpoch);
    assert.ok(upstream.calls.every(call => /\/fnmEB1kH\.pgn/.test(call.url)));
    assert.equal(restored.waiting?.previous, undefined);
  } finally {
    await host.app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
