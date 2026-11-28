import { pawnEstimate, authorityLabels, countdownLabel, lastMoveLabel, realProgramme, roundStates, startLabel, waitingHeadline } from "./game-day.js";
import { syncProgrammeCues } from "./programme-cues.js";
import { bindDirection, directionControls, updateDirection } from "./direction-controls.js";
import { liveView, livePanel, type BoardProgramme } from "./live-view.js";
import { recapLabels } from "./recap.js";
import { statisticsPanel } from "./statistics.js";
import { board, escape as e } from "./board.js";
import { cutProgrammeMotion, interruptPanel, reducedMotion, revealPanel, switchSpotlight } from "./programme-motion.js";
import type {
  Command,
  EngineView,
  BroadcastOperator,
  BroadcastSnapshot,
  RealProgramme,
  SelectionControls,
  ProgrammeSnapshot,
} from "../shared/types.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
const operator = location.pathname === "/operator";
document.body.className = operator ? "operator-page" : "programme-page";
document.title = operator
  ? "Control room · Chess Director"
  : "Programme · Chess Director";
let latest: BroadcastSnapshot | undefined;
let controls: SelectionControls | undefined;
let detailsRequest = 0;
let renderKey = "";
let pending = false;
let connected = false;
let recovering = false;

function clock(ms?: number): string {
  if (ms === undefined) return "—";
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
function shortTime(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}
function player(s: BoardProgramme, side: "w" | "b"): string {
  const white = side === "w";
  const name = white ? s.game.white : s.game.black;
  const country = white ? s.game.whiteCountry : s.game.blackCountry;
  const ms = white ? s.clocks?.whiteMs : s.clocks?.blackMs;
  const flag = country && /^[A-Z]{2}$/.test(country)
    ? `<img class="player-flag" src="/flags/${country.toLowerCase()}.svg" alt="${country}">`
    : "";
  return `<div class="player${s.game.turn === side ? " running" : ""}" data-side="${side}" role="group" aria-label="${white ? "White" : "Black"}">
      <span class="player-identity"><i class="player-piece" aria-hidden="true"></i>${flag}<span class="player-name">${e(name)}</span></span>
      <strong data-clock="${side}">${clock(ms)}</strong>
    </div>`;
}
function outcomeEstimate(values: [number, number, number], candidate?: string): string {
  const labels = ["White win", "Draw", "Black win"];
  return `<div class="wdl" aria-label="Leela outcome estimate${candidate ? ` after ${e(candidate)}` : " for the current position"}">
    ${candidate ? `<div class="outcome-scope">After ${e(candidate)}</div>` : ""}
    <div class="wdl-values">${values.map((value, i) => `<div><span>${labels[i]}</span><strong>${value}%</strong></div>`).join("")}</div>
    <div class="wdl-bar" aria-hidden="true">${values.map((value) => `<i style="width:${value}%"></i>`).join("")}</div>
  </div>`;
}

function engineSheet(engine: EngineView): string {
  const stats = engine.wdl
    ? outcomeEstimate(engine.wdl, engine.conditionalSan)
    : engine.pawns !== undefined && Number.isFinite(engine.pawns)
      ? pawnEstimate(engine.pawns, engine.score)
      : "";
  const rows = engine.candidates.slice(0, 3).map((line, i) =>
    `<tr><td>${i + 1}</td><th scope="row">${e(line.moves[0])}</th><td>${e(line.moves.slice(1, 5).join("  "))}</td><td>${line.depth ?? "—"}</td></tr>`
  ).join("");
  return `<section class="engine-sheet ${engine.id}">
    <header><div><h2>${e(engine.name)}</h2><p>${engine.id === "sesse" ? e(engine.source) + " · " : ""}${e(engine.status)}</p></div>${stats}</header>
    ${rows ? `<table aria-label="${e(engine.name)} candidates"><thead><tr><th>#</th><th>Move</th><th>Continuation</th><th>Depth</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
  </section>`;
}

function playedMoves(s: BoardProgramme): string {
  const moves = s.game.moves;
  if (s.real) {
    const tail = moves.slice(-10);
    return `<footer class="played-moves"><h2>Played moves</h2><ol>${tail.map((san, i) => {
      const ply = (s.startPly ?? 0) + moves.length - tail.length + i;
      return `<li><span>${Math.floor(ply / 2) + 1}${ply % 2 ? "…" : "."}</span><b>${e(san)}</b></li>`;
    }).join("")}</ol></footer>`;
  }
  const start = Math.max(0, (Math.ceil(moves.length / 2) - 5) * 2);
  const pairs: string[] = [];
  for (let i = start; i < moves.length; i += 2) {
    pairs.push(`<li><span>${i / 2 + 1}.</span><b>${e(moves[i])}</b>${moves[i + 1] ? `<b>${e(moves[i + 1])}</b>` : ""}</li>`);
  }
  return `<footer class="played-moves"><h2>Played moves</h2><ol>${pairs.join("")}</ol></footer>`;
}
function recentMoves(s: BoardProgramme): string {
  const rows = [];
  for (
    let i = Math.max(0, Math.floor((s.game.moves.length - 8) / 2) * 2);
    i < s.game.moves.length;
    i += 2
  ) {
    rows.push(
      `<span>${Math.floor(i / 2) + 1}.</span><b>${e(s.game.moves[i])}</b><b class="${i + 1 === s.game.moves.length ? "empty-move" : ""}">${e(s.game.moves[i + 1] ?? "…")}</b>`,
    );
  }
  return rows.join("");
}
function supportingPanel(s: BoardProgramme): string {
  const real = livePanel(s);
  if (real) return real;
  const waiting = s.engines.every(engine => engine.status === "Updating for this position");
  return s.panel !== "comparison" ? statisticsPanel(s, outcomeEstimate) : waiting
      ? `<div class="pending-panel"><div class="last-move"><span>Last move</span><strong>${e(s.actual.moveLabel)}</strong></div>
           <div class="analysis-status"><span>${s.engines.map(engine => e(engine.name)).join(" / ")}</span><h2>Updating for this position</h2></div></div>`
      : s.engines.map(engineSheet).join("");
}
function spotlightContents(s: BoardProgramme): string {
  const index = s.scene.frameIndex ?? 0;
  const frames = s.scene.frames!;
  const engine = s.engines.find(engine => engine.id === s.scene.source);
  return `<section class="analysis-region"><h2>ANALYSIS LINE NOT PLAYED</h2>
        <div class="analysis-board" data-frame="${index}">${board(frames[index], "analysis")}</div></section>
      <aside class="variation-rail"><header><h2>${e(engine?.name ?? s.scene.source ?? "Variation")}</h2>
          <span>${index} / ${frames.length - 1} plies</span></header>
        <ol>${frames.slice(1).map((frame, i) =>
          `<li${i + 1 === index ? ' class="current" aria-current="step"' : ""}>${e(frame.moveLabel)}</li>`
        ).join("")}</ol></aside>`;
}
function supportingScene(s: BoardProgramme, content: string): string {
  return s.scene.kind === "spotlight"
    ? `<div class="spotlight-layer">${spotlightContents(s)}</div>`
    : `<section class="comparison-panel${s.real ? " directed-panel" : ""}" aria-label="${e(s.scene.title)}">${content}</section>`;
}
function programmeHeader(s: BoardProgramme): string {
  return `<header class="programme-header"><div class="event"><h1>${e(s.game.event)}</h1>
       <p>${e(s.game.round)}<span>${e(s.game.opening)}</span>${s.game.turn === "w" ? "White" : "Black"} to move</p></div>
       <div class="broadcast-label">${s.real ? `<strong>${s.real.interrupted ? "Game feed interrupted" : e(s.actual.moveLabel)}</strong>` : '<span class="demo-badge">DEMO</span>'}</div></header>`;
}
function programme(s: BoardProgramme, support: string): string {
  const spotlight = s.scene.kind === "spotlight";
  return `<main class="programme" ${s.real ? `data-state="underway" data-game-id="${e(s.game.id)}" data-revision="${s.game.revision}" data-panel="${s.panel}"` : ""} data-scene="${s.scene.kind}" data-instance="${s.scene.instance}" data-testid="programme">
    ${programmeHeader(s)}
    <section class="actual-game ${spotlight ? "mini-actual" : "large-actual"}"><h2 class="board-slug">Actual game</h2>
      <div class="players">
        ${player(s, "b")}
        <div class="actual-board-wrap${spotlight ? " mini-board" : ""}">${board(s.actual, "actual")}</div>
        ${player(s, "w")}
      </div>
      <p class="mini-position" ${spotlight ? "" : "hidden"}>${e(s.actual.moveLabel)}</p></section>
    ${supportingScene(s, support)}<div class="panel-timer" aria-hidden="true" hidden><i></i></div>${playedMoves(s)}
    <div class="connection-banner" ${connected ? "hidden" : ""}>CONNECTION INTERRUPTED · Clocks paused</div></main>`;
}
function resizeProgramme(): void {
  if (!operator)
    app.style.setProperty(
      "--programme-scale",
      String(Math.min(innerWidth / 1920, innerHeight / 1080)),
    );
}
let renderedGame: ProgrammeSnapshot["game"] | undefined;
let renderedKind = "";
let renderedInstance = "";
let renderedSupport = "";
function isNextPlayedMove(s: BoardProgramme): boolean {
  const previous = renderedGame;
  return Boolean(previous && s.scene.kind === "actual-move" &&
    s.game.id === previous.id && s.game.epoch === previous.epoch && s.game.revision === previous.revision &&
    s.game.ply > previous.ply && previous.moves.every((move, index) => s.game.moves[index] === move));
}

function renderProgramme(s: BoardProgramme): void {
  const game = s.game;
  const playersChanged = renderedGame?.turn !== game.turn || renderedGame.white !== game.white ||
    renderedGame.black !== game.black || renderedGame.whiteCountry !== game.whiteCountry ||
    renderedGame.blackCountry !== game.blackCountry;
  const key = JSON.stringify([game.rootKey, game.turn, game.white, game.black, game.whiteCountry, game.blackCountry,
    s.scene.instance, s.scene.frameIndex, s.real?.interrupted, s.engines, s.panel,
    s.panel === "time" && s.moveTimes, s.panel === "history" && s.history.map(r => [r.sesse,r.leela,r.rootKey])]);
  if (key !== renderKey) {
    const transition = renderedInstance && renderedInstance !== s.scene.instance;
    const motion = Boolean(transition && connected && !recovering && !reducedMotion.matches);
    renderKey = key;
    const main = app.querySelector<HTMLElement>(".programme");
    const spotlight = s.scene.kind === "spotlight";
    const support = spotlight ? "" : supportingPanel(s);
    const interrupted = motion && isNextPlayedMove(s);
    if (main && (renderedGame?.rootKey === s.game.rootKey || interrupted)) {
      if (playersChanged) {
        for (const side of ["b", "w"] as const) {
          main.querySelector(`.player[data-side="${side}"]`)!.outerHTML = player(s, side);
        }
      }
      if (s.real) {
        main.dataset.panel = s.panel;
        if (!interrupted) main.querySelector(".programme-header")!.outerHTML = programmeHeader(s);
      }
      if (interrupted) {
        // Publish the played position immediately, then reveal its tint on landing.
        main.querySelector(".actual-board-wrap")!.innerHTML = board(s.actual, "actual");
        main.querySelector(".mini-position")!.textContent = s.actual.moveLabel;
        main.querySelector(".programme-header")!.outerHTML = programmeHeader(s);
        main.querySelector(".played-moves")!.outerHTML = playedMoves(s);
        const next = supportingScene(s, support);
        if (main.querySelector(".spotlight-layer")) switchSpotlight(main, false, next, "interruption");
        else interruptPanel(main, next);
      } else if (spotlight !== (renderedKind === "spotlight")) {
        switchSpotlight(main, spotlight, supportingScene(s, support), motion ? "normal" : "cut");
      } else if (spotlight) {
        // Keep the animated layer in place as the hypothetical line advances.
        main.querySelector(".spotlight-layer:not([data-departing])")!.innerHTML = spotlightContents(s);
      } else if (support !== renderedSupport) {
        const panel = main.querySelector<HTMLElement>(".comparison-panel:not([data-departing])")!;
        panel.innerHTML = support;
        if (motion) {
          panel.getAnimations().forEach(animation => animation.cancel());
          revealPanel(panel);
        }
      }
      main.dataset.instance = s.scene.instance;
      main.dataset.scene = s.scene.kind;
    } else {
      // A new game or correction replaces the scene immediately.
      cutProgrammeMotion();
      app.innerHTML = programme(s, support);
      resizeProgramme();
      const panel = app.querySelector<HTMLElement>(".comparison-panel");
      if (motion && panel && renderedGame?.revision === s.game.revision) revealPanel(panel);
    }
    renderedKind = s.scene.kind;
    renderedGame = s.game;
    renderedInstance = s.scene.instance;
    renderedSupport = support;
  }
  for (const [color, ms] of [
    ["w", s.clocks?.whiteMs],
    ["b", s.clocks?.blackMs],
  ] as const) {
    const el = app.querySelector(`[data-clock="${color}"]`);
    if (el) el.textContent = clock(ms);
  }
}
function operatorShell(): void {
  app.innerHTML = `<main class="control-room">
    <header class="operator-header">
      <div><span class="demo-badge" id="demo-label" hidden>DEMO</span><h1>Control room</h1></div>
      <div><span class="connection-status" id="connection-status">Connecting…</span>
      <a class="text-link" href="/programme" target="_blank" rel="noopener">Open programme</a></div>
    </header>
    <div class="control-grid">
      <section class="station">
        <div class="section-bar"><h2>Programme preview</h2><span>1920 × 1080</span></div>
        <div class="programme-preview"><iframe src="/programme" title="Programme preview" tabindex="-1"></iframe></div>
        <div class="preview-caption"><strong id="director-scene">—</strong><span data-rehearsal hidden>Elapsed <b id="fixture-time">0:00</b></span></div>
        <div class="cue-buttons" data-rehearsal hidden role="group" aria-label="Rehearsal controls">
          <button data-command="restart">Restart demo</button>
          <button data-command="cue-spotlight">Cue variation</button>
          <button data-command="release-move" class="primary">Play actual move</button>
          <button data-command="return-live">Return to actual board</button>
        </div>
        ${directionControls}
        <p id="command-status" role="status" aria-live="polite"></p>
      </section>
      <aside class="inspector">
        <section class="round-controls">
          <h2>Game selection</h2>
          <label for="round-choice">Championship game</label>
          <select id="round-choice" disabled><option value="">Choose a game</option></select>
          <p class="choice-detail" id="choice-detail"></p>
          <button class="primary" id="take-game" disabled>Take game to programme</button>
          <div class="selection-actions">
            <button id="enter-demo" disabled>Enter demo rehearsal</button>
            <button id="clear-selection" disabled hidden>Clear selection</button>
          </div>
        </section>
        <section><h2>On programme</h2>
          <dl class="data-rows">
            <dt>Event</dt><dd id="bound-event">—</dd>
            <dt>Round</dt><dd id="bound-round">—</dd>
            <dt>White</dt><dd id="white-player">—</dd>
            <dt>Black</dt><dd id="black-player">—</dd>
            <dt>Last move</dt><dd id="actual-position">—</dd>
            <dt data-real hidden>Scheduled start</dt><dd data-real id="selected-start" hidden>—</dd>
            <dt data-real hidden>Programme delay</dt><dd data-real id="programme-delay" hidden>—</dd>
            <dt data-real hidden>Latest authority read</dt><dd data-real id="latest-read" hidden>—</dd>
            <dt data-real hidden>Sesse upstream</dt><dd data-real id="sesse-health" hidden>—</dd>
            <dt data-real hidden>Leela upstream</dt><dd data-real id="leela-health" hidden>—</dd>
            <dt data-real hidden>Authority</dt><dd data-real id="authority-status" hidden>—</dd>
          </dl>
          <p class="binding-diagnostic" id="binding-diagnostic" hidden></p>
        </section>
        <section data-rehearsal hidden><h2>Recent moves</h2><div class="move-history" id="move-history"></div></section>
        <section data-rehearsal hidden><h2>Fixture feeds</h2><dl class="data-rows" id="source-health"></dl></section>
        <details class="diagnostics" data-rehearsal hidden><summary>Rehearsal details</summary>
          <dl class="data-rows">
            <dt>Time control</dt><dd id="time-control">—</dd>
            <dt>Variation cue</dt><dd id="variation-time">—</dd>
            <dt>Move cue</dt><dd id="move-time">—</dd>
            <dt>Epoch / revision</dt><dd id="game-revision">—</dd>
            <dt>Commands</dt><dd id="journal-count">—</dd>
            <dt>Root hash</dt><dd><code id="root-key">—</code></dd>
          </dl><p id="provider-contract"></p>
        </details>
        <button id="copy-url">Copy programme URL</button>
      </aside>
    </div></main>`;
  app
    .querySelectorAll<HTMLButtonElement>("[data-command]")
    .forEach((button) =>
      button.addEventListener(
        "click",
        () => void sendCommand(button.dataset.command as Command),
      ),
    );
  bindDirection(app, () => latest?.mode === "REAL" ? latest : undefined, () => controls, setCommandStatus, operatorDetails);
  app.querySelector("#round-choice")!.addEventListener("change", renderSelector);
  app.querySelector("#take-game")!.addEventListener("click", () => void changeSelection("select-game"));
  app.querySelector("#enter-demo")!.addEventListener("click", () => void changeSelection("enter-demo"));
  app.querySelector("#clear-selection")!.addEventListener("click", () => void changeSelection("clear-selection"));
  app.querySelector("#copy-url")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/programme`);
      setCommandStatus("Programme URL copied.");
    } catch {
      setCommandStatus(`Programme URL: ${location.origin}/programme`);
    }
  });
}
function setText(selector: string, value: string): void {
  const el = app.querySelector(selector);
  if (el && el.textContent !== value) el.textContent = value;
}
function setCommandStatus(value: string): void {
  setText("#command-status", value);
}
function renderDemoOperator(s: ProgrammeSnapshot): void {
  setText("#fixture-time", shortTime(s.presentationMs));
  const key = JSON.stringify([
    s.scene.instance,
    s.game.rootKey,
    s.engines.map((engine) => engine.status),
  ]);
  if (key !== renderKey) {
    renderKey = key;
    setText("#bound-event", s.game.event);
    setText("#bound-round", s.game.round);
    setText("#white-player", s.game.white);
    setText("#black-player", s.game.black);
    setText("#actual-position", s.actual.moveLabel);
    setText("#game-revision", `${s.game.epoch} / ${s.game.revision}`);
    setText("#root-key", s.game.rootKey);
    const scene = {
      spotlight: "Variation",
      "actual-move": "Move played",
      thinking: "Actual board",
    }[s.scene.kind];
    setText("#director-scene", `${scene} · ${s.game.turn === "w" ? "White" : "Black"} to move`);
    app.querySelector("#source-health")!.innerHTML = s.engines
      .map((engine) =>
        `<dt>${e(engine.source)}</dt><dd>${e(engine.status)}</dd>`
      ).join("");
    app.querySelector("#move-history")!.innerHTML = recentMoves(s);
  }
  app
    .querySelectorAll<HTMLButtonElement>("[data-command]")
    .forEach((button) => {
      button.disabled =
        pending ||
        !connected ||
        (button.dataset.command === "cue-spotlight" && s.game.ply > 18) ||
        (button.dataset.command === "release-move" && s.game.ply > 18);
    });
}
function renderSelector(): void {
  const select = app.querySelector<HTMLSelectElement>("#round-choice")!;
  const choice = controls?.catalogue.games.find(game => game.id === select.value);
  const ready = Boolean(connected && !pending && latest && controls &&
    latest.selectionEpoch === controls.selectionEpoch);
  updateDirection(app, controls, latest?.mode === "REAL" ? latest : undefined, ready);
  select.disabled = !controls;
  const take = app.querySelector<HTMLButtonElement>("#take-game")!;
  take.disabled = !ready || !choice;
  setText("#take-game", choice ? `Take ${choice.label} to programme` : "Take game to programme");
  setText("#choice-detail", choice
    ? `${choice.white.name} (White) · ${choice.black.name} (Black)\n${startLabel(choice.scheduledStart)} · ${choice.binding ? "Feed mapped" : "Feed binding pending"}`
    : "");
  const demo = app.querySelector<HTMLButtonElement>("#enter-demo")!;
  demo.hidden = latest?.mode === "DEMO";
  demo.disabled = !ready;
  const clear = app.querySelector<HTMLButtonElement>("#clear-selection")!;
  clear.hidden = !latest || (latest.mode === "REAL" && latest.game === null);
  clear.disabled = !ready;
  setText("#clear-selection", latest?.mode === "DEMO" ? "Leave demo rehearsal" : "Clear selection");
}

function renderRealOperator(s: RealProgramme): void {
  const game = s.game;
  const scene = s.live ? (s.live.scene.kind === "spotlight" ? "Analysis variation" : s.live.panel) : s.recap ? recapLabels[s.recap.page] : s.waiting ? waitingHeadline(s) : roundStates[s.state];
  setText("#director-scene", game ? `${game.label} · ${scene}` : scene);
  setText("#bound-event", s.eventName);
  setText("#bound-round", game?.label ?? "No game selected");
  setText("#white-player", game?.white.name ?? "—");
  setText("#black-player", game?.black.name ?? "—");
  setText("#actual-position", (s.summary && lastMoveLabel(s.summary)) ?? "—");
  setText("#selected-start", game ? startLabel(game.scheduledStart) : "—");
}

function renderOperator(s: BroadcastSnapshot): void {
  if (s.mode === "DEMO") renderDemoOperator(s);
  else renderRealOperator(s);
  renderSelector();
}

function showMode(mode: BroadcastSnapshot["mode"]): void {
  document.title = `${operator ? "Control room" : "Programme"} · Chess Director${mode === "DEMO" ? " DEMO" : ""}`;
  if (operator) {
    for (const node of app.querySelectorAll<HTMLElement>("[data-rehearsal], #demo-label")) node.hidden = mode !== "DEMO";
    for (const node of app.querySelectorAll<HTMLElement>("[data-real]")) node.hidden = mode !== "REAL";
  }
}

let catalogueKey = "";
function showDetails(details: BroadcastOperator): void {
  controls = details;
  const select = app.querySelector<HTMLSelectElement>("#round-choice")!;
  const key = JSON.stringify(details.catalogue.games);
  if (catalogueKey !== key) {
    catalogueKey = key;
    const selected = select.value || (details.programme.mode === "REAL" ? details.programme.game?.id : "");
    select.replaceChildren(new Option("Choose a game", ""),
      ...details.catalogue.games.map(game => new Option(game.label, game.id)));
    select.value = selected ?? "";
  }
  const health = details.feedHealth;
  setText("#programme-delay", health ? `${health.delayMs / 1000} s` : "—");
  setText("#latest-read", health?.lastRead ? new Date(health.lastRead).toLocaleTimeString() : "—");
  setText("#sesse-health", health?.sesse ?? "—");
  setText("#leela-health", health?.leela ?? "—");
  setText("#authority-status", authorityLabels[details.authorityStatus]);
  const diagnostic = app.querySelector<HTMLElement>("#binding-diagnostic")!;
  diagnostic.hidden = !details.diagnostic;
  diagnostic.textContent = details.diagnostic;
  if ("timeControl" in details) {
    setText("#time-control", details.timeControl);
    setText("#variation-time", shortTime(details.spotlightAtMs));
    setText("#move-time", shortTime(details.moveAtMs));
    setText("#journal-count", String(details.journalEntries));
    setText("#provider-contract", details.providerContract);
  }
  renderSelector();
}

async function operatorDetails(): Promise<void> {
  const request = ++detailsRequest;
  try {
    const response = await fetch("/api/operator", { cache: "no-store" });
    if (!response.ok) throw new Error("Operator details unavailable");
    const details: BroadcastOperator = await response.json();
    if (request !== detailsRequest || (latest &&
        (latest.streamId !== (details.programme as BroadcastSnapshot).streamId ||
        latest.selectionEpoch !== details.selectionEpoch))) return;
    showDetails(details);
  } catch {
    if (request !== detailsRequest) return;
    controls = undefined;
    renderSelector();
    setText("#authority-status", "Control room details unavailable");
    setText("#provider-contract", "Reconnecting to operator diagnostics.");
    setTimeout(() => {
      if (connected && request === detailsRequest) void operatorDetails();
    }, 2000);
  }
}

async function changeSelection(command: "select-game" | "enter-demo" | "clear-selection"): Promise<void> {
  if (pending || !connected || !controls || !latest || controls.selectionEpoch !== latest.selectionEpoch) return;
  const gameId = app.querySelector<HTMLSelectElement>("#round-choice")!.value;
  if (command === "select-game" && !gameId) return;
  pending = true;
  renderOperator(latest);
  setCommandStatus("Switching programme…");
  try {
    const response = await fetch("/api/operator/command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), command, selectionEpoch: controls.selectionEpoch,
        ...(command === "select-game" ? { gameId } : {}),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Selection rejected");
    if (!latest || latest.streamId !== result.programme.streamId || (latest.selectionEpoch ?? 0) > result.programme.selectionEpoch) {
      setCommandStatus("Programme changed. Review the active game.");
      return;
    }
    accept(result.programme);
    setCommandStatus(command === "enter-demo" ? "Demo rehearsal on programme." :
      command === "clear-selection" ? "Game selection cleared." : "Selected game on programme.");
  } catch (error) {
    setCommandStatus(error instanceof Error ? error.message : "Selection failed");
  } finally {
    await operatorDetails();
    pending = false;
    if (latest) renderOperator(latest);
  }
}
async function sendCommand(command: Command): Promise<void> {
  if (pending || !latest || latest.mode !== "DEMO") return;
  pending = true;
  renderOperator(latest);
  setCommandStatus("Applying cue…");
  try {
    const response = await fetch("/api/operator/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        command,
        epoch: latest.game.epoch,
        selectionEpoch: latest.selectionEpoch,
        revision: latest.game.revision,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Cue rejected");
    if (!latest || latest.streamId !== result.programme.streamId || (latest.selectionEpoch ?? 0) > result.programme.selectionEpoch) {
      setCommandStatus("Programme changed. Review the active game.");
      return;
    }
    accept(result.programme);
    setCommandStatus(
      command === "restart"
        ? "Demo restarted."
        : command === "cue-spotlight"
          ? "Variation cued."
          : command === "release-move"
            ? `${result.programme.actual.moveLabel} played.`
            : "Actual board restored.",
    );
  } catch (error) {
    setCommandStatus(error instanceof Error ? error.message : "Cue failed");
  } finally {
    await operatorDetails();
    pending = false;
    if (latest) renderOperator(latest);
  }
}
function connection(value: boolean): void {
  if (connected === value && latest) return;
  connected = value;
  if (!value) cutProgrammeMotion();
  // Initial HTTP and SSE snapshots can have the same sequence on a quiet board.
  if (!operator) syncProgrammeCues(app.querySelector(".programme"), value ? latest?.cues : undefined);
  const banner = app.querySelector<HTMLElement>(".connection-banner");
  if (banner) banner.hidden = value;
  setText(
    "#connection-status",
    value ? "Director connected" : "Connection interrupted",
  );
  app.querySelector("#connection-status")?.classList.toggle("offline", !value);
  if (operator && latest) renderOperator(latest);
}
function accept(s: BroadcastSnapshot): void {
  const newStream = latest && latest.streamId !== s.streamId;
  if (latest && !newStream && s.sequence <= latest.sequence) return;
  const previous = latest;
  latest = s;
  if (newStream || previous?.mode !== s.mode) {
    cutProgrammeMotion();
    renderedGame = undefined;
    renderedKind = renderedInstance = renderedSupport = renderKey = "";
    showMode(s.mode);
  }
  if (operator) {
    const selectionChanged = previous && (previous.selectionEpoch !== s.selectionEpoch || previous.mode !== s.mode ||
      (previous.mode === "REAL" && s.mode === "REAL" && previous.game?.id !== s.game?.id));
    if (selectionChanged) {
      // Discard a draft based on a superseded on-air selection.
      app.querySelector<HTMLSelectElement>("#round-choice")!.value = s.mode === "REAL" ? s.game?.id ?? "" : "";
    }
    if (newStream || selectionChanged) controls = undefined;
    // The regular details poll covers operator-only health. A replay tick does not change it.
    const changed = newStream || !previous || previous.selectionEpoch !== s.selectionEpoch ||
      (s.mode === "REAL" && previous.mode === "REAL" && previous.state !== s.state);
    if (changed) {
      const diagnostic = app.querySelector<HTMLElement>("#binding-diagnostic")!;
      diagnostic.hidden = true;
      setText("#authority-status", "Checking…");
      void operatorDetails();
    }
    renderOperator(s);
  } else if (s.mode === "REAL" && s.live) {
    renderProgramme(liveView(s));
    if (previous?.mode === "REAL" && previous.waiting && !newStream && !recovering && connected && !reducedMotion.matches)
      app.querySelector(".programme")?.classList.add("opening-take");
  } else if (s.mode === "DEMO") {
    renderProgramme(s);
  } else {
    cutProgrammeMotion();
    renderedGame = undefined;
    renderedInstance = renderedKind = renderedSupport = "";
    const waiting = s.waiting;
    const showsCountdown = waiting && (waiting.remainingSeconds ?? 0) > 0;
    const key = JSON.stringify([s.selectionEpoch, s.state, s.eventName, s.timeZone, s.game, s.position, s.analysis,
      s.interrupted, s.summary, s.recap, waiting?.previous, showsCountdown]);
    if (key !== renderKey) {
      renderKey = key;
      app.innerHTML = realProgramme(s, connected);
      if (previous?.mode === "REAL" && !newStream && connected && !recovering &&
          previous.selectionEpoch === s.selectionEpoch) {
        const programme = app.querySelector(".live-round");
        if (previous.position?.actual.fen !== s.position?.actual.fen ||
            (s.recap?.replay && previous.recap?.replay && previous.recap.replay.ply !== s.recap.replay.ply))
          programme?.classList.add("released-move");
        if (previous.waiting && s.state === "underway" && !reducedMotion.matches)
          programme?.classList.add("opening-take");
        if (waiting?.previous?.replay && previous.waiting?.previous?.replay?.gameId === waiting.previous.replay.gameId &&
            previous.waiting.previous.replay.ply !== waiting.previous.replay.ply)
          app.querySelector(".waiting-replay")?.classList.add("released-move");
        if (s.recap && previous.recap && previous.recap.page !== s.recap.page &&
            previous.position?.revision === s.position?.revision)
          programme?.classList.add("recap-enter");
      }
      resizeProgramme();
    } else if (showsCountdown && (previous?.mode !== "REAL" || waiting.remainingSeconds !== previous.waiting?.remainingSeconds)) {
      // Update the clock without replacing the replay board or restarting its move tint.
      setText(".waiting-clock", countdownLabel(waiting.remainingSeconds!));
    }
  }
  if (!operator) syncProgrammeCues(app.querySelector(".programme"), connected ? s.cues : undefined);
}
async function resnapshot(): Promise<void> {
  if (recovering) return;
  const atStart = latest;
  recovering = true;
  cutProgrammeMotion();
  try {
    const response = await fetch("/api/programme", { cache: "no-store" });
    if (!response.ok) throw new Error("Snapshot unavailable");
    const snapshot: BroadcastSnapshot = await response.json();
    // Trust a new process from the ordered stream or a fresh read. An older
    // in-flight HTTP response cannot replace a generation learned in the interim.
    if (latest && latest !== atStart && latest.streamId !== snapshot.streamId) return;
    accept(snapshot);
  } catch {
    connection(false);
  } finally {
    recovering = false;
  }
}
if (operator) {
  operatorShell();
  setInterval(() => { if (connected && latest?.mode === "REAL") void operatorDetails(); }, 3000);
}
resizeProgramme();
addEventListener("resize", resizeProgramme);
void resnapshot();
let stream: EventSource;
let lastReceived = performance.now();
function connectStream(): void {
  stream?.close();
  const source = new EventSource("/api/programme/events");
  stream = source;
  source.addEventListener("open", () => {
    lastReceived = performance.now();
    void resnapshot();
    if (operator && latest) void operatorDetails();
  });
  source.addEventListener("snapshot", (event) => {
    if (source !== stream || !navigator.onLine) return;
    lastReceived = performance.now();
    const s = JSON.parse((event as MessageEvent).data) as BroadcastSnapshot;
    connection(true);
    if (latest && latest.streamId === s.streamId && latest.selectionEpoch === s.selectionEpoch && s.sequence > latest.sequence + 1) {
      void resnapshot();
      return;
    }
    accept(s);
  });
  source.addEventListener("error", () => {
    if (source === stream) connection(false);
  });
}
connectStream();
addEventListener("offline", () => {
  stream.close();
  connection(false);
});
addEventListener("online", connectStream);
setInterval(() => {
  if (connected && performance.now() - lastReceived > 3000) {
    connection(false);
    if (navigator.onLine) connectStream();
  }
}, 1000);
