import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { loadCatalogue } from "../src/server/catalogue.js";
import { GameFeed } from "../src/server/game-feed.js";
import { Store } from "../src/server/store.js";

const game = loadCatalogue().games[3];
const chapter = "https://lichess.org/broadcast/test/round/wIwJtPqz/IriXvwPw";
function pgn(moves: string, result: string) {
  return `[Event "${game.binding!.events[0]}"]
[Round "4.1"]
[White "White"]
[Black "Black"]
[WhiteFideId "${game.white.id}"]
[BlackFideId "${game.black.id}"]
[GameURL "${chapter}"]
[Result "${result}"]

${moves} ${result}`;
}

test("cold final needs full delay, a validated released archive can rejoin, and an amendment buffers again", async () => {
  const store = new Store(":memory:");
  let now = 1000, result = "1-0";
  const select = (epoch: number, delayMs = 60_000) => new GameFeed(store, epoch, "mapped-game", game, {
    wallNow: () => now, delayMs, request: async () => new Response(pgn("", result)),
  });
  let feed = select(1);
  const position = () => feed.released.position;
  try {
    await setImmediate(); feed.tick();
    assert.equal(position(), undefined);
    now += 59_999; feed.tick();
    assert.equal(position(), undefined);
    now++; feed.tick();
    assert.equal(feed.released.position?.summary.result, "1-0");
    feed.stop();
    feed = select(1, 0);
    assert.equal(feed.delay, 60_000);
    feed.stop();
    feed = select(2);
    await setImmediate(); feed.tick();
    assert.equal(feed.released.position?.summary.result, "1-0");
    feed.stop();
    result = "0-1"; feed = select(3);
    await setImmediate(); feed.tick();
    assert.equal(position(), undefined);
    now += 60_000; feed.tick();
    assert.equal(feed.released.position?.summary.result, "0-1");
  } finally { feed.stop(); store.close(); }
});

test("Leela follows the bound chapter, colours, ply and FEN and discards the old socket on a correction", async () => {
  const store = new Store(":memory:");
  class Socket extends EventTarget {
    sent?: object;
    send(body: string) { this.sent = JSON.parse(body); }
    close() {}
    frame(body: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(body) })); }
  }
  const sockets: Socket[] = [];
  let now = 1, moves = "1. e4";
  const feed = new GameFeed(store, 1, "game", game, {
    wallNow: () => now, request: async () => new Response(pgn(moves, "*")), openSocket() {
      const socket = new Socket(); sockets.push(socket); return socket;
    },
  });
  try {
    await setImmediate(); feed.tick();
    const first = sockets[0], gameId = 9;
    const offer = { gameId, feedUrl: chapter, player1: { fideId: game.white.id }, player2: { fideId: game.black.id } };
    first.frame({ games: [{ ...offer, player1: offer.player2 }] });
    assert.equal(first.sent, undefined);
    first.frame({ games: [offer] });
    assert.deepEqual(first.sent, { gameId, ply: 1 });
    const frame = (fen: string) => ({
      positions: [{ gameId, ply: 1, fen }],
      evaluations: [{ gameId, ply: 1, evalId: 1, variations: [{ pvUci: "c7c5 g1f3" }] }],
    });
    first.frame(frame(game.startFen)); feed.tick();
    assert.deepEqual(feed.released.analysis, {});
    const old = frame(feed.released.position!.actual.fen);
    first.frame(old); feed.tick();
    assert.deepEqual(feed.released.analysis?.leela, { line: ["c5", "Nf3"], historyVerified: true });
    moves = "1. d4"; now += 15_000; feed.tick(); await setImmediate(); feed.tick();
    assert.equal(sockets.length, 2);
    first.frame(old); feed.tick();
    assert.deepEqual(feed.released.analysis, {});
    assert.equal(feed.released.position?.revision, 2);
    assert.deepEqual(feed.released.position?.moves, ["d4"]);
  } finally { feed.stop(); store.close(); }
});

test("a migrated G1 summary stays timestamped until a full PGN is available, and stays hidden during delay refill", async () => {
  const { Broadcast } = await import("../src/server/broadcast.js");
  for (const delayMs of [0, 60_000]) {
    const store = new Store(":memory:");
    const catalogue = loadCatalogue();
    store.selectGame("take", 0, "real", game.id);
    const summary = { result: "1-0", fen: game.startFen, plies: 0, lastSan: null, observedAt: "2026-11-28T12:00:00Z" };
    const identity = JSON.stringify([catalogue.eventId, game.id, game.white.id, game.black.id, game.startFen, game.binding]);
    store.saveSummary(1, game.id, { summary, identity });
    const broadcast = new Broadcast(store, { delayMs, wallNow: () => 1, request: async () => new Response("", { status: 503 }) }, () => {});
    try {
      const snapshot = broadcast.current;
      assert.equal(snapshot.mode, "REAL");
      assert.equal(snapshot.state, delayMs ? "buffering" : "finished");
      assert.deepEqual(snapshot.summary, delayMs ? null : summary);
      assert.equal(snapshot.position, undefined);
    } finally { broadcast.stop(); store.close(); }
  }
});
