import type { CatalogueGame } from "../src/shared/catalogue.js";

export const startFen = "r3k2r/1P6/8/8/8/8/6p1/R3K2R w KQkq - 0 1";
export const sans = ["O-O-O", "O-O", "bxa8=Q", "gxh1=Q", "Rxh1", "Rxa8"];
export const annotatedMoves = [
  "1. O-O-O {[%emt 0:00:12]}",
  "O-O {[%emt 0:00:05]}",
  "2. bxa8=Q {[%clk 0:50:00]}",
  "gxh1=Q {[%emt 0:00:21]}",
  "3. Rxh1 {[%emt 0:00:00]}",
  "Rxa8 {[%emt 0:00:17]}",
];
export const finalResult = "1/2-1/2";

export function score(game: CatalogueGame, plies: number, result: string, { opening = true } = {}) {
  const binding = game.binding!;
  return `[Event "${binding.events[0]}"]
[Round "${binding.pgnRound}"]
[White "${game.white.name}"]
[Black "${game.black.name}"]
[WhiteFideId "${game.white.id}"]
[BlackFideId "${game.black.id}"]
[GameURL "https://lichess.org/broadcast/test/round/${binding.roundId}/${binding.chapterId}"]
[Result "${result}"]
[SetUp "1"]
[FEN "${game.startFen}"]
${opening ? '[Opening "Local composition"]\n' : ""}
${annotatedMoves.slice(0, plies).join(" ")} ${result}`;
}
