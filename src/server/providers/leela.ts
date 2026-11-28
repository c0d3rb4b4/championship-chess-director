import { count, line, list, object, providerFenMatches, wirePositions, type Game } from "./game.js";

// Each subscription is scoped to an explicitly mapped provider game and an
// authoritative root. A new connection must send a matching position first.
export class LeelaReplay {
  private generation = 0;
  private matched = false;
  private candidates = new Map<string, { pv: string[]; evalId: number; nodes?: number }>();
  private evalId?: number;

  subscribe(gameId: number, game: Game) {
    const doublePush = wirePositions(game).at(-1)?.doublePush;
    const generation = ++this.generation;
    this.matched = false;
    this.evalId = undefined;
    this.candidates.clear();
    return (packet: unknown) => {
      if (generation !== this.generation) return;
      const frame = object(packet);
      const selected = (v: unknown) => list(v ?? []).map(object)
        .filter(p => p.gameId === gameId && p.ply === game.moves.length);
      for (const position of selected(frame.positions)) {
        this.matched = providerFenMatches(position.fen, game.fen, doublePush);
        if (!this.matched) {
          this.candidates.clear();
          this.evalId = undefined;
        }
      }
      if (!this.matched) return;
      for (const evaluation of selected(frame.evaluations)) {
        const id = count(evaluation.evalId);
        if (id === undefined || (this.evalId !== undefined && id < this.evalId)) continue;
        const next = new Map(this.candidates);
        for (const entry of list(evaluation.variations)) {
          const variation = object(entry);
          // The pinned backend emits nodes-only variations for older evaluations.
          // Without a move identifier those rows cannot update a named candidate.
          if (variation.pvUci === undefined) continue;
          if (typeof variation.pvUci !== "string") throw Error("Missing PV");
          const moves = variation.pvUci.trim().split(/\s+/);
          if (!moves.every(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) throw Error("Invalid UCI PV");
          const pv = line(game, moves);
          next.set(pv[0], { pv, evalId: id, nodes: count(variation.nodes) });
        }
        this.candidates = next;
        this.evalId = id;
      }
      return { gameId, fen: game.fen, evalId: this.evalId,
        candidates: structuredClone([...this.candidates.values()]) };
    };
  }

  disconnect() { ++this.generation; }
}
