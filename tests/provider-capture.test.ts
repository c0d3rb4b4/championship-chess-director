import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { captureProviders } from "../scripts/capture-providers.js";

test("capture binds the chapter and preserves the Sesse delta chain across a move and reconnect", async t => {
  const fixture = JSON.parse(readFileSync("fixtures/provider-simulation.json", "utf8"));
  const roundId = "Round001";
  const binding = { ...fixture.binding, gameId: "Game0001" };
  const chapter = `https://lichess.org/broadcast/example/round/${roundId}/${binding.gameId}`;
  const [initial, next] = [0, 7].map(time => fixture.packets.find((p: { receivedMs: number }) => p.receivedMs === time).body);
  const pgn = (body: string) => `[GameURL "${chapter}"]\n${body}`;
  const initialSesse = fixture.packets.find((p: { receivedMs: number }) => p.receivedMs === 1).body;
  const nextSesse = fixture.packets.find((p: { receivedMs: number }) => p.receivedMs === 15).body;
  const leelaAtPly = [4, 11, 18].map(time => fixture.packets.find((p: { receivedMs: number }) => p.receivedMs === time).body);
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(5_000)]);
  const packets: Array<Parameters<Parameters<typeof captureProviders>[1]>[0] & { receivedMs: number }> = [];
  const events = new EventEmitter();
  const until = async (check: () => boolean, requestSignal: AbortSignal) => {
    while (!check()) await once(events, "packet", { signal: requestSignal });
  };
  const captured = (source: string, field: string, value: unknown) =>
    packets.some(packet => packet.source === source && packet[field] === value);
  const hasEvaluation = (connection: number) =>
    packets.some(p => p.connection === connection && p.body && "evaluations" in (p.body as object));
  let authorityRequests = 0;
  let socketCount = 0;
  let freshSesseRequests = 0;

  class Socket extends EventTarget {
    constructor(private index: number) {
      super();
      queueMicrotask(() => this.emit({ games: [{
        gameId: 15, feedUrl: chapter.replace(binding.gameId, "Other000"),
      }, {
        gameId: fixture.leelaGameId, feedUrl: chapter,
        player1: { fideId: 101 }, player2: { fideId: 102 },
      }] }));
    }
    send(payload: string) {
      assert.deepEqual(JSON.parse(payload), { gameId: fixture.leelaGameId, ply: this.index === 0 ? 1 : 2 });
      queueMicrotask(() => this.emit(leelaAtPly[this.index]));
    }
    close() {}
    emit(body: unknown) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(body) }));
    }
  }

  const leelaGameId = await captureProviders({ roundId, binding }, packet => {
    packets.push({ ...packet, receivedMs: packets.length });
    events.emit("packet");
    if (hasEvaluation(3) && captured("sesse", "version", "104")) stop.abort();
  }, signal, {
    openSocket: () => new Socket(socketCount++),
    pause: (_, abort) => delay(4, undefined, { signal: abort }),
    request: async (input, options) => {
      const url = new URL(String(input));
      const abort = options!.signal!;
      if (url.hostname === "lichess.org") {
        switch (++authorityRequests) {
          case 1: return new Response(pgn(initial));
          case 2:
            await until(() => captured("sesse", "version", "101") && hasEvaluation(1), abort);
            return new Response(pgn(next));
          case 3:
            await until(() => captured("sesse", "version", "103") && hasEvaluation(2), abort);
            return new Response(null, { status: 503 });
          case 4: return new Response(pgn(next));
          default: await until(() => false, abort);
        }
      }
      const base = url.searchParams.get("ims");
      const reply = (body: unknown, version: string) => Response.json(body, { headers: { "X-RGLM": version } });
      switch (base) {
        case null: return ++freshSesseRequests === 1 ? reply(initialSesse, "100") : reply(nextSesse, "104");
        case "100": return reply([], "101");
        case "101":
          await until(() => captured("authority", "body", pgn(next)), abort);
          return reply([[[], nextSesse]], "103");
        default: await until(() => false, abort);
      }
      throw Error("Expected an abort");
    },
  });

  assert.equal(leelaGameId, fixture.leelaGameId);
  assert.deepEqual(packets.filter(p => p.source === "sesse" && p.version).map(p => [p.base, p.version]),
    [[undefined, "100"], ["100", "101"], ["101", "103"], [undefined, "104"]]);
  assert.deepEqual(packets.filter(p => p.source === "leela" && p.event === "subscribe").map(p => [p.connection, p.ply]),
    [[1, 1], [2, 2], [3, 2]]);
  assert.equal(packets.filter(p => p.source === "authority" && p.event === "disconnect").length, 1);

  const dir = mkdtempSync(join(tmpdir(), "provider-capture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const recording = join(dir, "recording.json");
  writeFileSync(recording, JSON.stringify({ binding, leelaGameId, packets }));
  const replay = spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-providers.mjs", recording], { encoding: "utf8" });
  assert.equal(replay.status, 0, replay.stderr);
  const observations = replay.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(observations.filter(row => row.source === "leela").map(row => row.observation.evalId), [1, 3, 4]);
  assert.equal(observations.filter(row => row.source === "sesse").at(-1).observation.fen,
    observations.filter(row => row.source === "authority").at(-1).observation.fen);
});

test("operator reconnects are labelled and recover each provider on the same root", async t => {
  const fixture = JSON.parse(readFileSync("fixtures/provider-replay.json", "utf8"));
  const [authority, full, , , frame] = fixture.packets;
  const roundId = "Round001";
  const binding = { ...fixture.binding, gameId: "Game0001" };
  const chapter = `https://lichess.org/broadcast/example/round/${roundId}/${binding.gameId}`;
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(5_000)]);
  const reconnects = new Set<"authority" | "sesse" | "leela">();
  const packets: Array<Parameters<Parameters<typeof captureProviders>[1]>[0] & { receivedMs: number }> = [];
  const events = new EventEmitter();
  const until = async (check: () => boolean) => {
    while (!check()) await once(events, "packet", { signal });
  };
  const countPackets = (source: string, match: (packet: typeof packets[number]) => boolean) =>
    packets.filter(packet => packet.source === source && match(packet)).length;
  const snapshots = (source: string) => countPackets(source, p => !!p.body && !Array.isArray(p.body));
  const evaluations = () => countPackets("leela", p => !!p.body && "evaluations" in (p.body as object));
  const disconnects = () => packets.filter(p => p.event === "disconnect" && p.initiatedBy === "operator");
  let version = 0;

  class Socket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.emit({ games: [{
        gameId: fixture.leelaGameId, feedUrl: chapter,
        player1: { fideId: binding.whiteId }, player2: { fideId: binding.blackId },
      }] }));
    }
    private heartbeat?: ReturnType<typeof setInterval>;
    send() {
      queueMicrotask(() => this.emit(frame.body));
      this.heartbeat = setInterval(() => this.emit({ status: {} }), 5);
    }
    close() { clearInterval(this.heartbeat); }
    private emit(body: unknown) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(body) }));
    }
  }

  const capture = captureProviders({ roundId, binding }, packet => {
    packets.push({ ...packet, receivedMs: packets.length });
    events.emit("packet");
  }, signal, {
    reconnects,
    openSocket: () => new Socket(),
    pause: (_, abort) => delay(4, undefined, { signal: abort }),
    request: async input => {
      const url = new URL(String(input));
      if (url.hostname === "lichess.org") return new Response(`[GameURL "${chapter}"]\n${authority.body}`);
      return Response.json(url.searchParams.has("ims") ? [] : full.body, { headers: { "X-RGLM": String(++version) } });
    },
  });
  try {
    await until(() => snapshots("sesse") === 1 && evaluations() === 1);
    reconnects.add("sesse");
    await until(() => snapshots("sesse") === 2);
    reconnects.add("leela");
    await until(() => evaluations() === 2);
    reconnects.add("authority");
    await until(() => snapshots("sesse") === 3 && evaluations() === 3);
  } finally {
    stop.abort();
  }
  const leelaGameId = await capture;
  assert.deepEqual(disconnects().map(p => p.source), ["sesse", "leela", "authority"]);
  assert.deepEqual(packets.filter(p => p.event === "subscribe").map(p => [p.connection, p.ply]), [[1, 1], [2, 1], [3, 1]]);
  assert.ok(packets.filter(p => p.source === "sesse" && p.body && !Array.isArray(p.body)).every(p => p.base === undefined));

  const dir = mkdtempSync(join(tmpdir(), "provider-reconnect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const recording = join(dir, "recording.json");
  writeFileSync(recording, JSON.stringify({ binding, leelaGameId, packets }));
  const replay = spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-providers.mjs", recording, "--coverage"], { encoding: "utf8" });
  assert.equal(replay.status, 2, replay.stderr);
  const { evidence } = JSON.parse(replay.stdout);
  for (const gap of disconnects()) {
    const recovered = evidence[gap.source].recovered;
    assert.equal(recovered.initiatedBy, "operator");
    assert.equal(recovered.disconnectedAt, gap.receivedMs);
    assert.ok(recovered.recoveredAt > gap.receivedMs);
  }
  assert.equal(evidence.sharedMove, null);
});
