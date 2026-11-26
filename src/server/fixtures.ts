import { createHash } from "node:crypto";
import { Chess, DEFAULT_POSITION } from "chess.js";
import demo from "../../fixtures/demo-game.json" with { type: "json" };
import sesse from "../../fixtures/sesse.json" with { type: "json" };
import leela from "../../fixtures/leela.json" with { type: "json" };
import type { BoardFrame, EngineId } from "../shared/types.js";

export { demo };
export const providers = { sesse, leela };
export function replay(moves: string[]): Chess {
  const game = new Chess();
  for (const san of moves) game.move(san);
  return game;
}
export function rootKey(
  gameId: string,
  epoch: number,
  revision: number,
  moves: string[],
): string {
  const game = replay(moves);
  const uci = game
    .history({ verbose: true })
    .map((m) => m.from + m.to + (m.promotion ?? ""));
  return createHash("sha256")
    .update(
      JSON.stringify({
        gameId,
        epoch,
        revision,
        initial: DEFAULT_POSITION,
        uci,
        fen: game.fen(),
      }),
    )
    .digest("hex");
}
export function boardFrame(game: Chess): BoardFrame {
  const move = game.history({ verbose: true }).at(-1);
  return {
    fen: game.fen(),
    pieces: game
      .board()
      .flatMap((rank) =>
        rank.flatMap((p) =>
          p ? [{ square: p.square, type: p.type, color: p.color }] : [],
        ),
      ),
    san: move?.san ?? "",
    moveLabel: move
      ? `${Math.ceil(game.history().length / 2)}.${move.color === "b" ? ".." : ""}${move.san}`
      : "Initial position",
    from: move?.from,
    to: move?.to,
  };
}
export function variationFrames(root: string[], moves: string[]): BoardFrame[] {
  const game = replay(root);
  const frames = [boardFrame(game)];
  for (const move of moves.slice(0, 8)) {
    game.move(move); // Fail closed: chess.js throws for every illegal move, including special moves.
    frames.push(boardFrame(game));
  }
  return frames;
}
export function validateFixtures(): void {
  replay([...demo.moves, demo.realMove.san]);
  for (const id of Object.keys(providers) as EngineId[]) {
    const source = providers[id];
    if (
      source.gameId !== demo.id ||
      rootKey(source.gameId, 1, 1, source.rootMoves) !==
        rootKey(demo.id, 1, 1, demo.moves)
    ) {
      throw new Error(`Wrong game or history in ${id} fixture`);
    }
    for (const candidate of source.candidates)
      variationFrames(source.rootMoves, candidate.pv);
  }
  const wdl = leela.wdl;
  if (
    wdl.perspective !== "white" ||
    wdl.scope !== "root" ||
    wdl.scale !== 1000 ||
    wdl.values.some((v) => v < 0 || v > wdl.scale) ||
    wdl.values.reduce((a, b) => a + b, 0) !== wdl.scale
  ) {
    throw new Error("Unsupported synthetic WDL contract");
  }
}
