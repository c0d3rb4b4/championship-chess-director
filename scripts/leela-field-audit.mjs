// Private capture evidence. The replay adapter has already checked the root and legal PVs.
import { count } from "../src/server/providers/game.ts";

export class LeelaFieldAudit {
  position;
  evaluation;
  previous;

  observe({ body, receivedMs, connection }, { gameId, fen, evalId, candidates }, ply) {
    const atRoot = row => row.gameId === gameId && row.ply === ply;
    const positions = (body.positions ?? []).filter(atRoot);
    if (positions.some(position => position.fen !== fen)) {
      this.position = this.evaluation = this.previous = undefined;
    }
    const position = positions.at(-1);
    if (position?.fen === fen) {
      const fields = { nodes: count(position.nodes) ?? null, wdl: wdl(position) };
      if (!this.position || JSON.stringify(fields) !== JSON.stringify(this.position.fields)) {
        this.position = { receivedMs, fields };
      }
    }

    if (this.evaluation?.evalId !== evalId) this.evaluation = undefined;
    for (const row of body.evaluations ?? []) {
      if (!atRoot(row) || row.evalId !== evalId || evalId === undefined) continue;
      this.evaluation ??= { evalId, totalNodes: null, wdlByMove: new Map() };
      if ("nodes" in row) this.evaluation.totalNodes = count(row.nodes) ?? null;
      for (const move of row.variations) {
        if (move.pvUci === undefined) continue;
        const firstUci = move.pvUci.trim().split(/\s+/, 1)[0];
        this.evaluation.wdlByMove.set(firstUci, wdl(move));
      }
    }

    const evaluation = this.evaluation && evaluationFields(this.evaluation, candidates);
    const fields = { position: this.position ?? null, evaluation: evaluation ?? null };
    if (!fields.position && !fields.evaluation) return;
    const serialized = JSON.stringify(fields);
    if (serialized === this.previous) return;
    this.previous = serialized;
    return { gameId, ply, connection, receivedMs, ...fields };
  }
}

function wdl(row) {
  const values = [row.scoreW, row.scoreD, row.scoreB];
  if (values.every(value => value === undefined)) return { status: "missing" };
  if (values.every(value => count(value) !== undefined && value <= 1000) &&
      values.reduce((total, value) => total + value, 0) === 1000) {
    return { status: "per-mille", values };
  }
  return { status: "invalid" };
}

function evaluationFields({ evalId, totalNodes, wdlByMove }, candidates) {
  // Older candidates can still be present in the adapter's display snapshot.
  const current = candidates.filter(candidate => candidate.evalId === evalId);
  const sum = current.every(candidate => candidate.nodes !== undefined)
    ? current.reduce((total, candidate) => total + candidate.nodes, 0) : null;
  const namedNodes = current.length && Number.isSafeInteger(sum) ? sum : null;
  const remainingNodes = totalNodes > 0 && namedNodes !== null ? totalNodes - namedNodes : null;
  const candidateWdl = { "per-mille": 0, missing: 0, invalid: 0 };
  for (const { status } of wdlByMove.values()) candidateWdl[status]++;
  return { evalId, totalNodes, namedCandidates: current.length, namedNodes, remainingNodes, candidateWdl };
}
