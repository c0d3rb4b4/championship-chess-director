import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { CatalogueGame } from "../src/shared/catalogue.js";
import { loadCatalogue } from "../src/server/catalogue.js";
import { decodeBoundGame, type fetchGameRecord } from "../src/server/game-summary.js";
import { PreviousGame } from "../src/server/previous-game.js";
import { Store } from "../src/server/store.js";

function score(game: CatalogueGame, moves: string) {
  const result = moves.split(" ").at(-1);
  const b = game.binding!;
  const pgn = `[Event "${b.events[0]}"]
[Round "${b.pgnRound}"]
[White "${game.white.name}"]
[Black "${game.black.name}"]
[WhiteFideId "${game.white.id}"]
[BlackFideId "${game.black.id}"]
[GameURL "https://lichess.org/broadcast/test/round/${b.roundId}/${b.chapterId}"]
[Result "${result}"]

${moves}`;
  return { decoded: decodeBoundGame(game, pgn), pgn };
}

test("previous replay waits for eligibility, skips open or invalid records and adopts a newer zero-ply final", async () => {
  const [older, invalid, latest] = loadCatalogue().games;
  const candidates = [latest, invalid, older].map(game => ({ game, identity: game.id }));
  const store = new Store(":memory:");
  let now = 1000, latestResult = "*";
  const reads: string[] = [];
  const request: typeof fetchGameRecord = async game => {
    reads.push(game.id);
    if (game.id === latest.id) return score(game, latestResult);
    if (game.id === invalid.id) return score(game, "1. e5 1-0"); // Illegal for White.
    return score(game, "1. Nf3 Nf6 1/2-1/2");
  };
  const archive = new PreviousGame(store, 1, 60_000, candidates, () => now, request);
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal(archive.at(now, true), undefined);
      await setImmediate();
    }
    assert.deepEqual(reads, [latest.id, invalid.id, older.id]);
    assert.equal(archive.at(60_999, false), undefined);
    const initial = archive.at(61_000, false)!;
    assert.equal(initial.game.id, older.id);
    assert.equal(initial.replay?.ply, 0);
    assert.equal(archive.at(63_000, false)?.replay?.frame.san, "Nf3");
    assert.equal(archive.at(65_000, false)?.replay?.frame.san, "Nf6");
    assert.equal(archive.at(68_999, false)?.replay?.ply, 2);
    assert.equal(archive.at(69_000, false)?.replay?.ply, 0);

    now = 61_000;
    latestResult = "1-0";
    assert.equal(archive.at(now, true)?.game.id, older.id);
    await setImmediate();
    assert.equal(archive.at(120_999, false)?.game.id, older.id);
    const upgraded = archive.at(121_000, true)!;
    assert.equal(upgraded.game.id, latest.id);
    assert.equal(upgraded.result, "1-0");
    assert.equal(upgraded.replay, undefined);
    assert.deepEqual(reads, [latest.id, invalid.id, older.id, latest.id]);
  } finally {
    archive.stop();
    store.close();
  }
});

test("a late archive response after switching cannot write or restore the superseded replay", async () => {
  const game = loadCatalogue().games[2];
  const store = new Store(":memory:");
  let finish!: (result: Awaited<ReturnType<typeof fetchGameRecord>>) => void;
  const archive = new PreviousGame(store, 1, 0, [{ game, identity: game.id }], () => 10_000,
    async () => new Promise(resolve => { finish = resolve; }));
  try {
    assert.equal(archive.at(10_000, true), undefined);
    archive.stop();
    finish(score(game, "1. d4 d5 1/2-1/2"));
    await setImmediate();
    assert.equal(store.archiveAt(game.id, 10_000, 0), undefined);
    assert.equal(archive.at(10_000, false), undefined);
  } finally { store.close(); }
});
