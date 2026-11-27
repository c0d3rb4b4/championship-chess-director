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

export function decodeGame(binding: Binding, authority: string, gameId: string, pgn: string) {
  if (authority !== binding.authority || gameId !== binding.gameId) throw Error("Unbound authority");
  const game = new Chess();
  game.loadPgn(pgn, { strict: true });
  const h = game.getHeaders();
  if (h.Event !== binding.event || h.Round !== binding.round ||
      h.WhiteFideId !== binding.whiteId || h.BlackFideId !== binding.blackId ||
      (h.FEN ?? DEFAULT_POSITION) !== binding.startFen) throw Error("Unbound game");
  const moves = game.history();
  const result = ["1-0", "0-1", "1/2-1/2"].includes(h.Result) ? h.Result : undefined;
  // PGN clock annotations use hours:minutes:seconds, with optional decimals.
  const clocks = binding.clockConvention === "post-move" ? game.getComments().flatMap(comment => {
    const match = /\[%clk (\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)\]/.exec(comment.comment);
    return match ? [{ fen: comment.fen, seconds: +match[1] * 3600 + +match[2] * 60 + +match[3] }] : [];
  }) : [];
  return { white: h.White, black: h.Black, clocks, binding: { ...binding }, moves, fen: game.fen(), result };
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
