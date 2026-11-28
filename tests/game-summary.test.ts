import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { loadCatalogue, parseCatalogue } from "../src/server/catalogue.js";
import { BindingError, decodeGameSummary, fetchGameSummary } from "../src/server/game-summary.js";
import type { CatalogueGame } from "../src/shared/catalogue.js";

const catalogue = loadCatalogue();
const selected = catalogue.games[3];
const other = catalogue.games[2];
// Original short mainlines exercise the deployed tag dialect without replaying a provider capture.
function pgn(game: CatalogueGame, moves = "1. d4 d5 *", result = "*") {
  const { roundId, chapterId, pgnRound, events } = game.binding!;
  return [
    `[Event "${events[0]}"]`, `[Round "${pgnRound}"]`, `[White "${game.white.name}"]`, `[Black "${game.black.name}"]`,
    `[WhiteFideId "${game.white.id}"]`, `[BlackFideId "${game.black.id}"]`, `[Result "${result}"]`,
    `[GameURL "https://lichess.org/broadcast/test/round/${roundId}/${chapterId}"]`, "", moves,
  ].join("\n");
}

test("published catalogue covers fourteen ordered games and accepts a newly published unbound round", () => {
  assert.deepEqual(catalogue.games.map(g => g.order), Array.from({length: 14}, (_, i) => i + 1));
  assert.equal(selected.scheduledStart, "2026-11-28T14:00:00Z");
  assert.equal(selected.white.id, other.black.id);
  assert.equal(selected.black.id, other.white.id);
  const next = { ...selected, id: "tie-break", order: 15, binding: null, scheduledStart: null };
  assert.deepEqual(parseCatalogue({ ...catalogue, games: [next, ...catalogue.games] }).games.at(-1), next);
});

test("catalogue rejects ambiguous bindings, identities, invalid FENs and local times", () => {
  for (const bad of [
    {id: other.id}, {order: other.order}, {binding: other.binding}, {black: selected.white},
    {startFen: "?"}, {scheduledStart: "2026-11-28T15:00:00"}, {scheduledStart: "2026-02-31T14:00:00Z"},
    {binding: {...selected.binding, roundId: "?"}}, {binding: {...selected.binding, events: []}},
  ]) {
    const games = catalogue.games.map(g => g.id === selected.id ? {...g, ...bad} : g);
    assert.throws(() => parseCatalogue({ ...catalogue, games }));
  }
});

test("only the selected chapter contributes legal moves, final position and explicit result", async () => {
  const board = new Chess();
  board.move("d4"); board.move("d5");
  const body = [pgn(other), pgn(selected, "1. d4 d5 1/2-1/2", "1/2-1/2")].join("\n\n\n").replaceAll("\n", "\r\n");
  const summary = await fetchGameSummary(selected, new AbortController().signal, async (url, init) => {
    assert.equal(String(url), "https://lichess.org/api/broadcast/round/wIwJtPqz.pgn?clocks=true&comments=false");
    assert.ok(init?.signal);
    return new Response(body);
  });
  assert.deepEqual(summary, {plies: 2, fen: board.fen(), lastSan: "d5", result: "1/2-1/2"});
  assert.deepEqual(decodeGameSummary(selected, pgn(selected, "*")), {
    plies: 0, fen: new Chess().fen(), lastSan: null, result: null,
  });
  assert.equal(decodeGameSummary(selected, pgn(selected, "1-0", "1-0")).result, "1-0");
});

test("a known live Event replaces the scheduled header only after checking the full binding again", () => {
  const live = pgn(selected).replace("Salesforce FIDE World Championship 2026", "FIDE World Chess Championship Match");
  assert.equal(decodeGameSummary(selected, live).plies, 2);
  assert.throws(() => decodeGameSummary(selected, live.replace("46616543", "999")), BindingError);
});

test("rejects identity changes, ambiguous chapters, malformed results, illegal mainlines and invalid starts", () => {
  const valid = pgn(selected);
  const malformed = [
    "", pgn(other), valid + "\n\n" + valid,
    pgn(selected, "1. d4 ; commentator mentions 1-0", "1-0"),
    pgn(selected, "1. d4 {1-0}", "1-0"),
    valid.replace("wIwJtPqz", "xxxxxxxx"), valid.replace("IriXvwPw", "xxxxxxxx"), valid.replace("lichess.org", "example.com"),
    valid.replace("Salesforce FIDE World Championship 2026", "Another event"), valid.replace("4.1", "3.1"),
    valid.replace(/WhiteFideId "[0-9]+"/, `WhiteFideId "${selected.black.id}"`),
    valid.replace('[Result "*"]', '[Result "1-0"]'), valid.replace(/\*$/, ""), valid.replace("d4 d5", "d4 d4"),
    valid.replace("[Event", '[Variant "Atomic"]\n[Event'),
    valid.replace("[Round", '[Round "1"]\n[Round'),
    valid.replace("[Round", '[GameURL  "https://lichess.org/other/chapter"]\n[Round'),
    valid.replace("[Round", '[FEN "8/8/8/8/8/2K5/8/k7 w - - 0 1"]\n[Round'),
  ];
  for (const body of malformed) assert.throws(() => decodeGameSummary(selected, body), BindingError);
  assert.throws(() => decodeGameSummary({...selected, binding: null}, valid), BindingError);
});

test("strict replay starts at the verified custom FEN", () => {
  const fen = "8/8/8/8/8/2K5/8/k7 b - - 0 14";
  const game = { ...selected, startFen: fen };
  const body = pgn(game, "14... Ka2 *").replace("[Round", `[SetUp "1"]\n[FEN "${fen}"]\n[Round`);
  const board = new Chess(fen);
  board.move("Ka2");
  assert.equal(decodeGameSummary(game, body).fen, board.fen());
  assert.throws(() => decodeGameSummary(game, body.replace('[SetUp "1"]\n', "")), BindingError);
});

test("transport outage and identity rejection are distinct", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(fetchGameSummary(selected, signal, async () => new Response("", { status: 503 })), /HTTP 503/);
  await assert.rejects(fetchGameSummary(selected, signal, async () => new Response(pgn(other))), BindingError);
});

test("cold-join clock evidence binds the running side, both anchors and the exact played position", async () => {
  const { decodeBoundGame, gamePosition, fetchThinkTime } = await import("../src/server/game-summary.js");
  const decoded = decodeBoundGame(selected, pgn(selected, "1. d4 {[%clk 1:59:48]} d5 {[%clk 1:59:42]} *"));
  const position = gamePosition(selected, decoded, 0), binding = selected.binding!;
  assert.deepEqual(position.elapsed?.map(row => row.elapsedMs), [12000, 18000]);
  const game = { id: binding.chapterId, status: "*", fen: position.actual.fen, lastMove: "d7d5", thinkTime: 94,
    players: [{ fideId: selected.white.id, clock: 718800 }, { fideId: selected.black.id, clock: 718200 }] };
  const read = (overrides: Record<string,unknown>, age = "0") => fetchThinkTime(selected, position, new AbortController().signal,
    async () => Response.json({ round: { id: binding.roundId, ongoing: true }, games: [{...game, ...overrides}] }, {headers:{age}}));
  assert.equal(await read({}, "2"), 96000);
  for (const patch of [{status:"1-0"}, {id:"another"}, {fen:selected.startFen}, {lastMove:"d2d4"},
    {thinkTime:-1}, {players:[...game.players].reverse()}, {players:[game.players[0],{...game.players[1],clock:700000}]}])
    assert.equal(await read(patch), undefined);
  assert.equal(await read({}, "900"), undefined);
});
