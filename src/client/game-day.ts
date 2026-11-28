import type { RealProgramme, SelectionControls } from "../shared/types.js";
import { board, escape as e } from "./board.js";

export const roundStates: Record<RealProgramme["state"], string> = {
  buffering: "Filling programme buffer",
  unselected: "Awaiting game selection",
  pending: "Waiting for the game",
  waiting: "Waiting for the first move",
  underway: "Game in progress",
  finished: "Final result",
  unavailable: "Awaiting game update",
};

export const authorityLabels: Record<SelectionControls["authorityStatus"], string> = {
  idle: "No game selected",
  "pending-binding": "Feed binding pending",
  loading: "Checking round",
  verified: "Verified round",
  mismatch: "Identity mismatch",
  unavailable: "Authority unavailable",
};

const dateFormats = new Map<string | undefined, Intl.DateTimeFormat>();

export function startLabel(instant: string | null, timeZone?: string): string {
  if (!instant) return "Start time to be confirmed";
  let format = dateFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23", timeZoneName: "short", timeZone,
    });
    dateFormats.set(timeZone, format);
  }
  return format.format(new Date(instant));
}

function resultLabel(result: string): string {
  return ({ "1/2-1/2": "½–½", "1-0": "1–0", "0-1": "0–1" })[result] ?? result;
}

export function lastMoveLabel(summary: NonNullable<RealProgramme["summary"]>): string | null {
  if (!summary.lastSan) return null;
  const [, turn, , , , nextMove] = summary.fen.split(" ");
  return turn === "w" ? `${Number(nextMove) - 1}…${summary.lastSan}` : `${nextMove}.${summary.lastSan}`;
}

export function pawnEstimate(pawns: number, score: string): string {
  // The centre is equal and each half covers five pawns.
  const whiteShare = 50 + Math.max(-5, Math.min(5, pawns)) * 10;
  return `<div class="pawn-score">
      <div><span>White eval · pawns</span><strong>${e(score)}</strong></div>
      <div class="pawn-bar" aria-hidden="true"><i style="width:${whiteShare}%"></i></div>
    </div>`;
}

function liveGame(s: RealProgramme, connected: boolean) {
  const game = s.game!, position = s.position!, summary = position.summary;
  const final = summary.result;
  const player = (side: "white" | "black") => `<div class="live-player ${side}">
    <span>${side === "white" ? "White" : "Black"}</span>${game[side].country ? `<img class="player-flag" alt="" src="/flags/${game[side].country.toLowerCase()}.svg">` : ""}<strong>${e(game[side].name)}</strong></div>`;
  const [, firstTurn, , , , firstMove] = position.startFen.split(" ");
  const start = (Number(firstMove) - 1) * 2 + Number(firstTurn === "b");
  const recent = position.moves.slice(-8).map((san, index, tail) => {
    const ply = start + position.moves.length - tail.length + index;
    return `<li><span>${Math.floor(ply / 2) + 1}${ply % 2 ? "…" : "."}</span>${e(san)}</li>`;
  }).join("");
  const analysis = (["sesse", "leela"] as const).map(id => {
    const a = s.analysis?.[id];
    return a ? `<section class="live-engine"><h3>${id === "sesse" ? "Stockfish · Sesse" : "Leela · LCZero"}</h3>
      <p>Analysis line <b>${e(a.line.slice(0, 5).join(" "))}</b></p>
      ${a.whiteScore && a.pawns !== undefined ? pawnEstimate(a.pawns, a.whiteScore) : a.whiteScore ? `<p>White evaluation <b>${e(a.whiteScore)}</b></p>` : ""}
      ${a.depth !== undefined ? `<p>Depth <b>${a.depth}</b></p>` : ""}</section>` : "";
  }).join("");
  return `<main class="programme live-round" data-testid="programme" data-scene="${s.state}" data-state="${s.state}"
      data-game-id="${e(game.id)}" data-revision="${position.revision}">
    <header class="live-mast"><span>${e(s.eventName)}</span><strong>${final ? "Final result" : "Game in progress"}</strong></header>
    <div class="live-board-stack">${player("black")}${board(position.actual, "actual")}${player("white")}</div>
    <article class="live-sheet"><h1>${e(game.label)}</h1>
      <section class="live-lead"><p>${final ? "Final result" : "Last move"}</p>
        <h2>${e(final ? resultLabel(final) : lastMoveLabel(summary))}</h2>
        ${final ? `<p>Half-moves recorded <b>${summary.plies}</b></p>`
        : `<p>${summary.fen.split(" ")[1] === "w" ? "White" : "Black"} to move</p>`}</section>
      ${recent ? `<section class="live-notation"><h3>Played moves</h3><ol>${recent}</ol></section>` : ""}
      ${analysis}
      ${s.interrupted ? '<p class="authority-gap">Game feed interrupted</p>' : ""}
    </article><div class="connection-banner" ${connected ? "hidden" : ""}>CONNECTION INTERRUPTED</div></main>`;
}

export function realProgramme(s: RealProgramme, connected: boolean): string {
  if (s.position && (s.state === "underway" || s.state === "finished")) return liveGame(s, connected);
  const game = s.game;
  const summary = s.summary;
  const state = roundStates[s.state];
  const headline = summary?.result ? resultLabel(summary.result) : state;
  const pair = game ? ([["White", game.white], ["Black", game.black]] as const).map(([colour, player]) =>
    `<div class="slate-player"><span>${colour}</span><strong>${e(player.name)}</strong></div>`
  ).join("") : "";
  const record = summary
    ? `<div><dt>Half-moves recorded</dt><dd>${summary.plies}</dd></div>
       ${summary.lastSan ? `<div><dt>Last move</dt><dd>${e(lastMoveLabel(summary))}</dd></div>` : ""}`
    : "";
  return `<main class="programme round-slate" data-testid="programme" data-scene="${s.state}" data-state="${s.state}" data-game-id="${e(game?.id ?? "")}">
    <header class="slate-header"><p>${e(s.eventName)}</p></header>
    <div class="slate-body"><section class="slate-identity">
      ${game ? `<h1>${e(game.label)}</h1><div class="slate-pairing">${pair}</div>` : `<h1>${e(state)}</h1>`}
    </section>
    ${game ? `<section class="slate-record">
      ${summary?.result ? `<p class="slate-kicker">${e(state)}</p>` : ""}
      <h2 class="${summary?.result ? "result-value" : ""}">${e(headline)}</h2>
      <dl><div><dt>Scheduled start</dt><dd>${e(startLabel(game.scheduledStart, s.timeZone))}</dd></div>${record}</dl>
    </section>` : ""}</div>
    ${summary ? `<footer class="slate-footer">Game record as of ${e(startLabel(summary.observedAt, s.timeZone))}</footer>` : ""}
    <div class="connection-banner" ${connected ? "hidden" : ""}>CONNECTION INTERRUPTED</div></main>`;
}
