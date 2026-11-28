import type { RecapPage, RecapSide, RealProgramme } from "../shared/types.js";
import { escape as e } from "./board.js";
import { recapEvaluation, recapTime } from "./statistics.js";

export const recapLabels: Record<RecapPage, string> = {
  result: "Final result", numbers: "Game in numbers", time: "Time used",
  evaluation: "Evaluation history", replay: "Replay",
};

const points = (score: number) => score % 1 ? (score === .5 ? "½" : `${Math.floor(score)}½`) : String(score);

export function finishedPanel(s: RealProgramme, formatResult: (result: string) => string,
    formatStart: (start: string, zone: string) => string): string {
  const recap = s.recap!, game = s.game!, summary = s.position!.summary;
  const sides = [{ colour: "White", ...recap.white }, { colour: "Black", ...recap.black }];
  const row = (name: string, stat: keyof Pick<RecapSide, "moves" | "captures">) =>
    `<tr><th scope="row">${name}</th>${sides.map(side => `<td>${side[stat]}</td>`).join("")}</tr>`;
  const result = formatResult(summary.result!);
  switch (recap.page) {
    case "result":
      return `<section class="live-lead"><h2>${e(result)}</h2>
        <p>Half-moves recorded <b>${summary.plies}</b></p></section>
        ${recap.matchScore ? `<div class="recap-detail"><span>Match score through ${e(game.label)}</span>
          <strong>${e(game.white.name)} ${points(recap.matchScore.white)}–${points(recap.matchScore.black)} ${e(game.black.name)}</strong></div>` : ""}
        ${recap.next ? `<div class="recap-detail"><span>Next scheduled game</span>
          <strong>${e(recap.next.label)} · ${e(formatStart(recap.next.start, s.timeZone))}</strong></div>` : ""}`;
    case "numbers":
      return `<section class="recap-stats"><h2>Game in numbers</h2>
        <table><thead><tr><td></td><th scope="col">White</th><th scope="col">Black</th></tr></thead>
        <tbody>${row("Moves played", "moves")}${row("Captures", "captures")}</tbody></table>
        ${recap.opening ? `<div class="recap-detail"><span>Opening · PGN</span><strong>${e(recap.opening)}</strong></div>` : ""}</section>`;
    case "time":
      return recapTime(recap);
    case "evaluation":
      return recapEvaluation(recap);
    case "replay": {
      const replay = recap.replay!;
      return `<section class="live-lead"><p>Final score · ${e(result)}</p><h2>${e(replay.frame.moveLabel)}</h2>
        <p>${replay.mover ? (replay.mover === "w" ? "White played" : "Black played") : "Before the first move"}</p></section>
        <div class="recap-detail"><span>Half-moves replayed</span><strong>${replay.ply} / ${summary.plies}</strong></div>`;
    }
  }
}
