import { createHash } from "node:crypto";
import { Chess, DEFAULT_POSITION, type Move } from "chess.js";
import demo from "../../fixtures/demo-game.json" with { type: "json" };
import sesse from "../../fixtures/sesse.json" with { type: "json" };
import leela from "../../fixtures/leela.json" with { type: "json" };
import type { BoardFrame, EngineId } from "../shared/types.js";

export { demo };
export const providers = { sesse, leela };
export function replay(moves: string[], initial = DEFAULT_POSITION): Chess {
  const game = new Chess(initial);
  for (const san of moves) game.move(san);
  return game;
}
export function rootKey(
  gameId: string,
  epoch: number,
  revision: number,
  moves: string[], initial = DEFAULT_POSITION,
): string {
  const game = replay(moves, initial);
  const uci = game
    .history({ verbose: true })
    .map((m) => m.from + m.to + (m.promotion ?? ""));
  return createHash("sha256")
    .update(
      JSON.stringify({
        gameId,
        epoch,
        revision,
        initial,
        uci,
        fen: game.fen(),
      }),
    )
    .digest("hex");
}
export function boardFrame(game: Chess, move: Move | undefined = game.history({ verbose: true }).at(-1)): BoardFrame {
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
      ? `${move.before.split(" ")[5]}.${move.color === "b" ? ".." : ""}${move.san}`
      : "Initial position",
    from: move?.from,
    to: move?.to,
  };
}
export function variationFrames(root: string[], moves: string[], initial = DEFAULT_POSITION): BoardFrame[] {
  const game = replay(root, initial);
  const frames = [boardFrame(game)];
  for (const move of moves) {
    game.move(move); // Fail closed: chess.js throws for every illegal move, including special moves.
    if (frames.length <= 8) frames.push(boardFrame(game));
  }
  return frames;
}
// Each fixture is replayed in the current demo epoch. Index by ply only after
// verifying the complete position history against the authoritative timeline.
export function validateFixtures() {
  const moves = [...demo.moves];
  const histories = new Map([[moves.length, rootKey(demo.id, 1, 1, moves)]]);
  let previousTime = 0;
  for (const event of demo.events) {
    if (event.atMs <= previousTime) throw new Error("Unordered game events");
    moves.push(event.san);
    histories.set(moves.length, rootKey(demo.id, 1, 1, moves));
    previousTime = event.atMs;
  }
  type Position = (typeof sesse.positions | typeof leela.positions)[number];
  const positions = { sesse: new Map<number, Position>(), leela: new Map<number, Position>() };
  for (const id of Object.keys(providers) as EngineId[]) {
    const source = providers[id];
    for (const position of source.positions) {
      const ply = position.rootMoves.length;
      if (source.gameId !== demo.id || positions[id].has(ply) ||
          histories.get(ply) !== rootKey(source.gameId, 1, 1, position.rootMoves))
        throw new Error(`Wrong game or history in ${id} fixture`);
      for (const candidate of position.candidates)
        variationFrames(position.rootMoves, candidate.pv);
      if (position.revisions.some((r, i, all) => i > 0 && r.atMs <= all[i - 1].atMs))
        throw new Error("Unordered analysis revisions");
      if ("score" in position) {
        const score = position.score;
        if (score.kind !== "pawns" || score.perspective !== "white" || !Number.isFinite(score.value))
          throw new Error("Unsupported synthetic pawn score");
      }
      positions[id].set(ply, position);
    }
  }
  return positions;
}
