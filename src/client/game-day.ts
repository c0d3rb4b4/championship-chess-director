import type { RealProgramme, SelectionControls } from "../shared/types.js";
import { escape as e } from "./board.js";

export const roundStates: Record<RealProgramme["state"], string> = {
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

export function realProgramme(s: RealProgramme, connected: boolean): string {
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
