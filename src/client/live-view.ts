import type { ClockReading, EngineView, LivePanel, ProgrammeSnapshot, RealProgramme } from "../shared/types.js";
import { escape as e } from "./board.js";
import { recapTime, recapEvaluation } from "./statistics.js";

export type BoardProgramme = Omit<ProgrammeSnapshot, "mode" | "clocks" | "panel"> & {
  mode: "DEMO" | "REAL"; clocks?: ClockReading; panel: LivePanel;
  real?: RealProgramme; startPly?: number;
};

export function liveView(s: RealProgramme): BoardProgramme {
  const game = s.game!, p = s.position!, live = s.live!;
  const engines: EngineView[] = [];
  for (const id of ["sesse", "leela"] as const) {
    const a = s.analysis?.[id];
    if (!a) continue;
    engines.push({ id, name: id === "sesse" ? "Stockfish" : "Leela", source: id === "sesse" ? "Sesse" : "LCZero",
      score: a.whiteScore ?? "", scoreLabel: "White evaluation", status: a.progress?.ready ? "Ready" : "Provisional",
      depth: a.depth, pawns: a.pawns, wdl: a.wdl, candidates: a.candidates ?? (a.line.length ? [{ moves: a.line, depth: a.depth }] : []),
      work: a.work, workCandidate: id === "leela" ? a.line[0] : undefined, workUnit: id === "sesse" ? "nodes" : "visits", workDelta: a.progress?.delta, visitShares: a.visitShares });
  }
  const fen = p.startFen.split(" ");
  return { mode: "REAL", real: s, sequence: s.sequence, presentationMs: 0, connected: true,
    startPly: (Number(fen[5]) - 1) * 2 + Number(fen[1] === "b"),
    game: { id: game.id, epoch: s.selectionEpoch, revision: p.revision, rootKey: live.rootKey, event: s.eventName,
      round: game.label, white: game.white.name, black: game.black.name, whiteCountry: game.white.country,
      blackCountry: game.black.country, opening: p.opening ?? "", ply: p.moves.length, turn: p.actual.fen.split(" ")[1] as "w" | "b", moves: p.moves },
    actual: p.actual, clocks: live.clocks, engines, scene: live.scene, panel: live.panel, moveTimes: p.elapsed ?? [], history: [], ticker: p.actual.moveLabel };
}

export function livePanel(s: BoardProgramme): string | undefined {
  const live = s.real?.live;
  if (!live) return;
  const facts = live.facts;
  if (s.panel === "time") return recapTime({ ...facts, page: "time" });
  if (s.panel === "history") {
    const samples = [...facts.samples];
    const i = samples.length - 1;
    samples[i] = { ...samples[i], pawns: s.real?.analysis?.sesse?.pawns ?? samples[i].pawns,
      wdl: s.real?.analysis?.leela?.wdl ?? samples[i].wdl };
    return recapEvaluation({ ...facts, samples, page: "evaluation" });
  }
  if (s.panel === "numbers") return `<article class="stat-panel recap-stats"><h2>Game in numbers</h2>
    <table><thead><tr><td></td><th>White</th><th>Black</th></tr></thead><tbody>
    <tr><th>Moves played</th><td>${facts.white.moves}</td><td>${facts.black.moves}</td></tr>
    <tr><th>Captures</th><td>${facts.white.captures}</td><td>${facts.black.captures}</td></tr></tbody></table></article>`;
  if (s.panel === "notation") return `<article class="stat-panel live-score"><h2>${s.scene.kind === "actual-move" ? "Move played" : "Played notation"}</h2>
    <strong>${e(s.actual.moveLabel)}</strong><ol>${facts.samples.slice(1).slice(-12).map(row => `<li>${e(row.label)}</li>`).join("")}</ol></article>`;
}
