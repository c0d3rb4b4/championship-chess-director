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
  clockConvention: "unknown" | "post-move";

}

export function decodeGame(
  binding: Binding, authority: string, gameId: string, pgn: string, { inspectClock = false } = {},
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
  return {
    white: h.White, black: h.Black, clocks, binding: { ...binding }, moves, fen: game.fen(), result,
    ...(clock && { clockAnnotation: {
      ...clock, ply: moves.length, san: moves[moves.length - 1], mover: game.turn() === "b" ? "white" : "black",
    } }),
  };
}

function parseClock(comment = "") {
  // PGN clock annotations use hours:minutes:seconds, with optional decimals.
  const match = /\[%clk ((\d+):([0-5]\d):([0-5]\d(?:\.\d+)?))\]/.exec(comment);
  if (!match) return;
  const [, pgnClock, hours, minutes, seconds] = match;
  const totalSeconds = +hours * 3600 + +minutes * 60 + +seconds;
  if (Number.isFinite(totalSeconds)) return { pgnClock, seconds: totalSeconds };
}

export type Game = ReturnType<typeof decodeGame>;
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
