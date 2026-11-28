import type { ClockReading } from "../../shared/types.js";
import type { TimeControl } from "../../shared/catalogue.js";
import { duration } from "../statistics.js";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { replay } from "../fixtures.js";

export interface Binding {
  authority: string;
  gameId: string;
  event: string;
  round: string;
  whiteId: string;
  blackId: string;
  startFen: string;
  sessePlayers?: { white: string; black: string };
  timeControl?: TimeControl;
  clockConvention: "unknown" | "post-move";

}

export function decodeGame(
  binding: Binding, authority: string, gameId: string, pgn: string, { inspectClock = false, verifiedElapsed = false } = {},
) {
  if (authority !== binding.authority || gameId !== binding.gameId) throw Error("Unbound authority");
  const game = new Chess();
  game.loadPgn(pgn, { strict: true });
  const h = game.getHeaders();
  if (h.Event !== binding.event || h.Round !== binding.round ||
      h.WhiteFideId !== binding.whiteId || h.BlackFideId !== binding.blackId ||
      (h.FEN ?? DEFAULT_POSITION) !== binding.startFen) throw Error("Unbound game");
  const moves = game.history();
  const result = ["1-0", "0-1", "1/2-1/2"].includes(h.Result) ? h.Result : undefined;
  const clocks = binding.clockConvention === "post-move" ? game.getComments().flatMap(comment => {
    const clock = parseClock(comment.comment);
    return clock ? [{ fen: comment.fen, seconds: clock.seconds }] : [];
  }) : [];
  const clock = inspectClock && moves.length ? parseClock(game.getComment()) : undefined;
  const times = new Map(clocks.map(c => [c.fen, Math.round(c.seconds * 1000)]));
  let anchors: ClockReading | undefined;
  if (clocks.length) {
    const last = game.history({ verbose: true }).slice(-2);
    const reading = (colour: "w" | "b") => {
      const move = last.find(m => m.color === colour);
      return move ? times.get(move.after) : binding.startFen === DEFAULT_POSITION ? binding.timeControl?.startingMs : undefined;
    };
    const whiteMs = reading("w"), blackMs = reading("b");
    if (whiteMs !== undefined || blackMs !== undefined) anchors = { whiteMs, blackMs };
  }
  const recorded = verifiedElapsed ? elapsedTimes(game) : [];
  const control = binding.timeControl;
  const elapsed = clocks.length && control && binding.clockConvention === "post-move" ? game.history({ verbose: true }).map((move, index, moves) => {
    const supplied = recorded.find(row => row.ply === index + 1);
    if (supplied) return supplied;
    const fullMove = Number(move.before.split(" ")[5]);
    const previous = index < 2 && binding.startFen === DEFAULT_POSITION ? control.startingMs :
      times.get(moves[index-2]?.after ?? "");
    return { ply: index + 1, san: move.san, elapsedMs: duration(previous, { postMs: times.get(move.after),
      incrementMs: fullMove >= control.incrementFromMove ? control.incrementMs : 0,
      bonusMs: control.bonuses.find(b => b.afterMove === fullMove)?.ms ?? 0, adjustmentMs: 0 }) };
  }) : recorded;
  const opening = h.Opening?.trim();
  return {
    white: h.White, black: h.Black, clocks, ...(anchors && { anchors }), binding: { ...binding }, moves, fen: game.fen(), result,
    ...(opening && { opening }),
    ...(elapsed?.some(row => row.elapsedMs !== null) && { elapsed }),
    ...(clock && { clockAnnotation: {
      ...clock, ply: moves.length, san: moves[moves.length - 1], mover: game.turn() === "b" ? "white" : "black",
    } }),
  };
}

function elapsedTimes(game: Chess) {
  const comments = new Map(game.getComments().map(({ fen, comment }) => [fen, comment]));
  return game.history({ verbose: true }).flatMap(({ after, san }, index) => {
    const annotations = [...(comments.get(after) ?? "").matchAll(/\[%emt\b([^\]]*)\]/g)];
    const time = annotations.length === 1 && parseTime(annotations[0][1].trim());
    const elapsedMs = time && Math.round(time.seconds * 1000);
    return typeof elapsedMs === "number" && Number.isSafeInteger(elapsedMs) ? [{ ply: index + 1, san, elapsedMs }] : [];
  });
}

function parseClock(comment = "") {
  const values = [...comment.matchAll(/\[%clk ([^\]]+)\]/g)];
  return values.length === 1 ? parseTime(values[0][1]) : undefined;
}

function parseTime(time: string) {
  const match = /^((\d+):([0-5]\d):([0-5]\d(?:\.\d+)?))$/.exec(time);
  if (!match) return;
  const [, pgnClock, hours, minutes, seconds] = match;
  const totalSeconds = +hours * 3600 + +minutes * 60 + +seconds;
  if (Number.isFinite(totalSeconds)) return { pgnClock, seconds: totalSeconds };
}

export type Game = ReturnType<typeof decodeGame>;
/** Some PGN broadcasters retain the target square after every double pawn push.
 * Accept only the alternate spelling proved by that exact legal move. */
export function providerFenMatches(fen: unknown, expected: string, san: string | undefined) {
  if (fen === expected) return true;
  if (typeof fen !== "string" || !san || !/^[a-h][45]$/.test(san)) return false;
  // The caller supplies the proven double push, never an inferred pawn destination.
  const fields = expected.split(" ");
  if (fields[3] !== "-") return false;
  fields[3] = san[0] + (san[1] === "4" ? "3" : "6");
  return fen === fields.join(" ");
}

export function wirePositions(game: Game) {
  return replay(game.moves, game.binding.startFen).history({ verbose: true }).map(move => ({
    fen: move.after, doublePush: move.isBigPawn() ? move.san : undefined, uci: move.lan,
  }));
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected object");
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error("Expected array");
  return value;
}
export function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
export function line(game: Game, moves: unknown[]) {
  if (!moves.length || !moves.every(m => typeof m === "string")) throw Error("Invalid PV");
  const board = replay([], game.fen);
  return moves.map(m => board.move(m).san);
}
