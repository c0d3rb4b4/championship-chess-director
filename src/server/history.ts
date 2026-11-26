import { demo, rootKey, type validateFixtures } from "./fixtures.js";
import { outcomes } from "./statistics.js";
import type { HistoryRow } from "../shared/types.js";

export class FixtureHistory {
  private rootKeys = new Map<string, string>();
  rows(moves: string[], elapsedMs: number, positions: ReturnType<typeof validateFixtures>,
       epoch: number, correction?: { fromPly: number; revision: number }): HistoryRow[] {
    const rows: HistoryRow[] = [];
    for (let ply = demo.moves.length; ply <= moves.length; ply++) {
      const next = demo.events[ply - demo.moves.length];
      const frozen = next && next.atMs <= elapsedMs;
      const cutoffMs = frozen ? next.atMs : elapsedMs;
      const revision = correction && ply >= correction.fromPly ? correction.revision : 1;
      const prefix = moves.slice(0, ply);
      const identity = JSON.stringify([epoch, revision, prefix]);
      let key = this.rootKeys.get(identity);
      if (!key) {
        key = rootKey(demo.id, epoch, revision, prefix);
        this.rootKeys.set(identity, key);
      }
      const row: HistoryRow = { ply, san: moves[ply-1], rootKey: key, revision, cutoffMs };
      for (const id of ["sesse", "leela"] as const) {
        const position = positions[id].get(ply);
        const sample = position?.revisions.filter(r => frozen ? r.atMs < cutoffMs : r.atMs <= cutoffMs).at(-1);
        // These observations belong to fixture revision 1. An edited suffix
        // remains a gap until analysis bound to the new revision exists.
        if (revision !== 1 || !position || !sample ||
            position.rootMoves.some((san,i) => san !== prefix[i])) continue;
        const meta = { observedMs: sample.atMs, version: sample.version };
        if ("score" in position) row.sesse = { ...meta, pawns: position.score.value };
        else if (position.wdl.scope === "root") {
          const percentages = outcomes(position.wdl, ply % 2 === 1);
          if (percentages) row.leela = { ...meta, percentages };
        }
      }
      rows.push(row);
    }
    return rows;
  }
}
