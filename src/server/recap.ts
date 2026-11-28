import type { BoardFrame, FinishedRecap, RecapPage, RecapSample, RecapSide, ReleasedPosition, ReplayFrame } from "../shared/types.js";
import { boardFrame, replay } from "./fixtures.js";
import type { Store } from "./store.js";

const resultMs = 30_000;
const plyMs = 2_000;
const finalFrameMs = 4_000;

export class GameReplay {
  readonly frames: BoardFrame[] = [];
  readonly moves;

  constructor(private readonly gameId: string, position: ReleasedPosition) {
    const game = replay([], position.startFen);
    this.frames.push(boardFrame(game));
    this.moves = position.moves.map(san => {
      const move = game.move(san);
      this.frames.push(boardFrame(game, move));
      return move;
    });
  }

  get durationMs() { return this.moves.length * plyMs + finalFrameMs; }

  at(elapsedMs: number): ReplayFrame {
    const ply = Math.min(Math.floor(elapsedMs / plyMs), this.moves.length);
    return { gameId: this.gameId, ply, frame: this.frames[ply], mover: this.moves[ply - 1]?.color };
  }
}

export function commonPlies(a: string[], b: string[]): number {
  let prefix = 0;
  while (prefix < a.length && a[prefix] === b[prefix]) prefix++;
  return prefix;
}

/** Builds the rundown once for the eligible result. Only its cursor advances on ticks. */
export class Recap {
  private readonly playback: GameReplay;
  private readonly pages: { page: RecapPage; ms: number }[] = [{ page: "result", ms: resultMs }];
  readonly facts: Omit<FinishedRecap, "page" | "replay">;

  constructor(gameId: string, position: ReleasedPosition, readonly finishedAt: number,
      { roots, samples: observations }: ReturnType<Store["recapJournal"]>) {
    const emptySide = (): RecapSide => ({ moves: 0, captures: 0, timedMoves: 0, totalMs: 0 });
    const white = emptySide(), black = emptySide();
    this.playback = new GameReplay(gameId, position);
    const samples: RecapSample[] = [{ label: "0" }];

    const durations = new Map(position.elapsed?.map(entry => [entry.ply, entry]));
    for (const [index, move] of this.playback.moves.entries()) {
      const frame = this.playback.frames[index + 1];
      const side = move.color === "w" ? white : black;
      const sample: RecapSample = { label: frame.moveLabel, mover: move.color };
      samples.push(sample);
      side.moves++;
      side.captures += Number(Boolean(move.captured));
      const entry = durations.get(index + 1);
      if (entry?.san !== move.san || entry.elapsedMs == null) continue;
      const elapsedMs = entry.elapsedMs;
      sample.elapsedMs = elapsedMs;
      side.timedMoves++;
      side.totalMs += elapsedMs;
      if (!side.longest || elapsedMs > side.longest.elapsedMs) side.longest = { label: frame.moveLabel, elapsedMs };
    }

    // Walk the journal backwards. After a takeback or divergent move, earlier
    // samples past the common ancestor cannot return even if the SAN later matches.
    const verifiedRoots = new Map<number, number>();
    let validPrefix = position.moves.length;
    for (const root of roots) {
      const moves = root.position?.moves;
      if (!moves) continue;
      validPrefix = Math.min(validPrefix, commonPlies(moves, position.moves));
      if (!root.interrupted && !root.position?.summary.result && moves.length <= validPrefix)
        verifiedRoots.set(root.id, moves.length);
      // An ordinary earlier position is an ancestor, not a takeback. Its
      // shorter line only constrains roots earlier than that observation.
    }
    for (const { root, source, analysis } of observations) {
      const ply = verifiedRoots.get(root);
      if (ply === undefined) continue;
      const sample = samples[ply];
      if (source === "sesse" && Number.isFinite(analysis.pawns)) sample.pawns ??= analysis.pawns;
      const wdl = analysis.wdl;
      if (source === "leela" && wdl?.length === 3 && wdl.every(value => value >= 0 && value <= 100) &&
          Math.abs(wdl.reduce((total, value) => total + value, 0) - 100) < .11)
        sample.wdl ??= wdl;
    }
    this.facts = { white, black, samples, opening: position.opening };
    if (position.moves.length) this.pages.push({ page: "numbers", ms: 12_000 });
    if (white.timedMoves + black.timedMoves) this.pages.push({ page: "time", ms: 15_000 });
    // A final-only observation cannot stand in for a historical series.
    if (samples.slice(0, -1).some(sample => sample.wdl || sample.pawns !== undefined))
      this.pages.push({ page: "evaluation", ms: 15_000 });
    if (position.moves.length)
      this.pages.push({ page: "replay", ms: this.playback.durationMs });
  }

  at(now: number): FinishedRecap {
    let elapsed = Math.max(0, now - this.finishedAt) % this.pages.reduce((total, page) => total + page.ms, 0);
    for (const { page, ms } of this.pages) {
      if (elapsed >= ms) {
        elapsed -= ms;
        continue;
      }
      const panelWindow = { startMs: now - elapsed, endMs: now - elapsed + ms };
      if (page !== "replay") return { ...this.facts, page, panelWindow };
      return { ...this.facts, page, panelWindow, replay: this.playback.at(elapsed) };
    }
    throw Error("Invalid recap timeline");
  }
}
