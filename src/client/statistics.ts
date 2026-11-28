import type { BoardProgramme } from "./live-view.js";
import { escape as e } from "./board.js";
import type { FinishedRecap, ProgrammeSnapshot } from "../shared/types.js";

const colours = ["#f5f2e9", "#a4c9da", "#e4ac76"];
const number = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
interface Series { name: string; values: (number | null)[] }

// All series in a plot share an axis and unit. Null breaks the line.
function chart(labels: string[], series: Series[], unit: string, fixedMaximum?: number): string {
  const values = series.flatMap(s => s.values.filter((n): n is number => n !== null));
  const low = Math.min(0, ...values);
  const high = fixedMaximum ?? Math.max(1, ...values);
  const x = (i: number) => 100 + 690 * i / Math.max(1, labels.length - 1);
  const labelCount = Math.min(7, labels.length);
  const labelIndices = Array.from({ length: labelCount }, (_, i) =>
    Math.round(i * (labels.length - 1) / Math.max(1, labelCount - 1)));
  const y = (n: number) => 178 - 135 * (n-low) / (high-low);
  const ticks = [low, (low+high)/2, high].map(n =>
    `<path d="M96 ${y(n)}h706" stroke="#505451"/><text x="80" y="${y(n)+6}" text-anchor="end">${number(n)}</text>`).join("");
  const lines = series.map((line,j) => {
    let path = "";
    const dots = line.values.map((value,i) => {
      if (value === null) return "";
      path += `${i === 0 || line.values[i-1] === null ? "M" : "L"}${x(i)} ${y(value)} `;
      return `<circle cx="${x(i)}" cy="${y(value)}" r="${Math.max(2, Math.min(6, 220 / labels.length))}"/>`;
    }).join("");
    return `<g fill="${colours[j]}"><path d="${path}" fill="none" stroke="${colours[j]}" stroke-width="4"/>${dots}</g>`;
  }).join("");
  return `<div class="stat-chart"><div class="legend">${series.map((s,i) => `<span style="--line:${colours[i]}">${e(s.name)}</span>`).join("")}</div>
    <svg viewBox="0 0 860 235" role="img" aria-label="${e(unit)}"><text x="20" y="22">${e(unit)}</text>${ticks}${lines}
    ${labelIndices.map(i => `<text x="${x(i)}" y="216" text-anchor="middle">${e(labels[i])}</text>`).join("")}</svg></div>`;
}
function timePanel(s: BoardProgramme): string {
  const totals = [0,0];
  const series: Series[] = [{ name: "White", values: [0] }, { name: "Black", values: [0] }];
  const elapsed = new Map(s.moveTimes.map(m => [m.ply, m.elapsedMs]));
  const labels = ["0"];
  for (let move = 1; move <= Math.ceil(s.game.ply/2); move++) {
    labels.push(String(move));
    for (let side = 0; side < 2; side++) {
      const ms = elapsed.get(move * 2 - 1 + side);
      if (ms != null) totals[side] += ms;
      series[side].values.push(ms == null ? null : totals[side]/60000);
    }
  }
  return `<h2>Time used since game start</h2>
    <div class="time-totals">${series.map((line,i) => `<div><span>${line.name} · recorded</span><strong>${number(totals[i]/60000)} min</strong></div>`).join("")}</div>
    ${chart(labels,series,"Minutes on completed moves")}<p class="axis-label">Move number</p>`;
}
export function statisticsPanel(s: BoardProgramme, outcome: (v: [number,number,number], candidate?: string) => string): string {
  let body = "";
  if (s.panel === "outcomes") {
    const engine = s.engines.find(e => e.id === "leela");
    if (engine?.wdl) {
      const position = engine.conditionalSan ? "" : `<p class="stat-sub">${e(s.actual.moveLabel)} · Current position</p>`;
      body = `<h2>Leela outcomes</h2>${position}${outcome(engine.wdl, engine.conditionalSan)}`;
    }
  } else if (s.panel === "time") body = timePanel(s);
  else if (s.panel === "search") {
    body = `<h2>Search progress</h2>${s.engines.map(engine =>
      `<section class="work"><h3>${e(engine.name)}${engine.workCandidate ? " · " + e(engine.workCandidate) : ""}</h3>${engine.workUnit && engine.work !== undefined ?
        `<p><strong>${number(engine.work)}</strong> ${engine.workUnit} ${engine.depth !== undefined ? `<span>Depth ${engine.depth}</span>` : ""}</p>
        ${engine.workDelta !== undefined ? `<small>Last increase &nbsp; +${number(engine.workDelta)} ${engine.workUnit}</small>` : ""}
        ${engine.visitShares ? `<div class="shares">${engine.visitShares.map(v => `<span>${e(v.san)} &nbsp;${number(v.percent)}%</span>`).join("")}</div>` : ""}` : "<p>Updating for this position</p>"}</section>`).join("")}`;
  } else if (s.panel === "history") {
    const rows = s.history;
    const labels = rows.map(row => row.ply === 0 ? "0" : `${Math.ceil(row.ply/2)}${row.ply%2 ? "." : "…"}${row.san}`);
    body = `<h2>Evaluation history</h2>
      ${chart(labels,[{name:"Stockfish · White evaluation",values:rows.map(r => r.sesse?.pawns ?? null)}],"Pawns")}
      ${chart(labels,["White win","Draw","Black win"].map((name,i) => ({name,values:rows.map(r => r.leela?.percentages[i] ?? null)})), "Leela · Probability (%)",100)}`;
  }
  return `<article class="stat-panel" data-panel="${s.panel}">${body}</article>`;
}

export function recapTime(recap: FinishedRecap): string {
  const series = (["w", "b"] as const).map((colour, index) => {
    let total = 0;
    let visible = true;
    const values = recap.samples.map(sample => {
      if (sample.mover === colour) {
        visible = sample.elapsedMs !== undefined;
        total += sample.elapsedMs ?? 0;
      }
      return visible ? total / 60_000 : null;
    });
    return { name: index === 0 ? "White" : "Black", values };
  });
  const totals = [recap.white, recap.black];
  return `<section class="recap-stats"><h2>Time used</h2>
    <div class="recap-time-totals">${series.map((line, i) => {
      const side = totals[i];
      return `<div><span>${line.name} · ${side.timedMoves}/${side.moves} moves timed</span>
        <strong>${side.timedMoves ? `${number(side.totalMs / 1000)} s` : "—"}</strong>
        ${side.longest ? `<small>Longest ${side.timedMoves < side.moves ? "observed " : ""}think · ${e(side.longest.label)} · ${number(side.longest.elapsedMs / 1000)} s</small>` : ""}
      </div>`;
    }).join("")}</div>
    ${chart(recap.samples.map(sample => sample.label), series, "Recorded cumulative minutes")}
    <p class="axis-label">Played move</p></section>`;
}

export function recapEvaluation(recap: FinishedRecap): string {
  const labels = recap.samples.map(sample => sample.label);
  const pawns = recap.samples.map(sample => sample.pawns ?? null);
  const wdl = ["White win", "Draw", "Black win"].map((name, i) => ({
    name, values: recap.samples.map(sample => sample.wdl?.[i] ?? null),
  }));
  return `<section class="recap-stats"><h2>Evaluation history</h2><p class="recap-sub">Observed during play</p>
    ${pawns.some(value => value !== null) ? chart(labels, [{ name: "Stockfish · Sesse", values: pawns }], "White evaluation · pawns") : ""}
    ${wdl[0].values.some(value => value !== null) ? chart(labels, wdl, "Leela · Probability (%)", 100) : ""}
    <p class="axis-label">Played move</p></section>`;
}
