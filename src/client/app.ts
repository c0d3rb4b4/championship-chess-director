import { statisticsPanel } from "./statistics.js";
import { board, escape as e } from "./board.js";
import { cutProgrammeMotion, reducedMotion, revealPanel, switchSpotlight } from "./programme-motion.js";
import type {
  Command,
  EngineView,
  OperatorSnapshot,
  ProgrammeSnapshot,
} from "../shared/types.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
const operator = location.pathname === "/operator";
document.body.className = operator ? "operator-page" : "programme-page";
document.title = operator
  ? "Control room · Chess Director DEMO"
  : "Programme · Chess Director DEMO";
let latest: ProgrammeSnapshot | undefined;
let renderKey = "";
let pending = false;
let connected = false;
let recovering = false;

function clock(ms: number): string {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
function shortTime(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}
function players(s: ProgrammeSnapshot): string {
  return `<div class="players">
    <div class="player ${s.game.turn === "w" ? "running" : ""}"><span class="player-name"><i class="player-piece white-dot"></i>${e(s.game.white)}</span><strong data-clock="w">${clock(s.clocks.whiteMs)}</strong></div>
    <div class="player ${s.game.turn === "b" ? "running" : ""}"><span class="player-name"><i class="player-piece black-dot"></i>${e(s.game.black)}</span><strong data-clock="b">${clock(s.clocks.blackMs)}</strong></div>
  </div>`;
}
function outcomeEstimate(values: [number, number, number]): string {
  const labels = ["White win", "Draw", "Black win"];
  return `<div class="wdl" aria-label="Leela outcome estimate for the current position">
    <div class="wdl-values">${values.map((value, i) => `<div><span>${labels[i]}</span><strong>${value}%</strong></div>`).join("")}</div>
    <div class="wdl-bar" aria-hidden="true">${values.map((value) => `<i style="width:${value}%"></i>`).join("")}</div>
  </div>`;
}

function engineSheet(engine: EngineView): string {
  const stats = engine.wdl
    ? (engine.conditionalSan ? `<span>After ${e(engine.conditionalSan)}</span>` : "") + outcomeEstimate(engine.wdl)
    : engine.id === "sesse" && engine.candidates.length
      ? `<div class="pawn-score"><span>White eval · pawns</span><strong>${e(engine.score)}</strong></div>`
      : "";
  const rows = engine.candidates.slice(0, 3).map((line, i) =>
    `<tr><td>${i + 1}</td><th scope="row">${e(line.moves[0])}</th><td>${e(line.moves.slice(1, 5).join("  "))}</td><td>${line.depth ?? "—"}</td></tr>`
  ).join("");
  return `<section class="engine-sheet ${engine.id}">
    <header><div><h2>${e(engine.name)}</h2><p>${engine.id === "sesse" ? e(engine.source) + " · " : ""}${e(engine.status)}</p></div>${stats}</header>
    ${rows ? `<table aria-label="${e(engine.name)} candidates"><thead><tr><th>#</th><th>Move</th><th>Continuation</th><th>Depth</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
  </section>`;
}

function playedMoves(s: ProgrammeSnapshot): string {
  const moves = s.game.moves;
  const start = Math.max(0, (Math.ceil(moves.length / 2) - 5) * 2);
  const pairs: string[] = [];
  for (let i = start; i < moves.length; i += 2) {
    pairs.push(`<li><span>${i / 2 + 1}.</span><b>${e(moves[i])}</b>${moves[i + 1] ? `<b>${e(moves[i + 1])}</b>` : ""}</li>`);
  }
  return `<footer class="played-moves"><h2>Played moves</h2><ol>${pairs.join("")}</ol></footer>`;
}
function recentMoves(s: ProgrammeSnapshot): string {
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
function supportingPanel(s: ProgrammeSnapshot): string {
  const waiting = s.engines.every(engine => engine.status === "Updating for this position");
  return s.panel !== "comparison" ? statisticsPanel(s, outcomeEstimate) : waiting
      ? `<div class="pending-panel"><div class="last-move"><span>Last move</span><strong>${e(s.actual.moveLabel)}</strong></div>
           <div class="analysis-status"><span>${s.engines.map(engine => e(engine.name)).join(" / ")}</span><h2>Updating for this position</h2></div></div>`
      : s.engines.map(engineSheet).join("");
}
function spotlightContents(s: ProgrammeSnapshot): string {
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
function supportingScene(s: ProgrammeSnapshot): string {
  return s.scene.kind === "spotlight"
    ? `<div class="spotlight-layer">${spotlightContents(s)}</div>`
    : `<section class="comparison-panel" aria-label="Engine analysis">${supportingPanel(s)}</section>`;
}
function programme(s: ProgrammeSnapshot): string {
  const spotlight = s.scene.kind === "spotlight";
  return `<main class="programme" data-scene="${s.scene.kind}" data-instance="${s.scene.instance}" data-testid="programme">
    <header class="programme-header"><div class="event"><h1>${e(s.game.event)}</h1>
       <p>${e(s.game.round)}<span>${e(s.game.opening)}</span>${s.game.turn === "w" ? "White" : "Black"} to move</p></div>
       <div class="broadcast-label"><span class="demo-badge">${e(s.mode)}</span>${players(s)}</div></header>
    <section class="actual-game ${spotlight ? "mini-actual" : "large-actual"}"><h2 class="board-slug">Actual game</h2>
      <div class="actual-board-wrap${spotlight ? " mini-board" : ""}">${board(s.actual, "actual")}</div>
      <p class="mini-position" ${spotlight ? "" : "hidden"}>${e(s.actual.moveLabel)}</p></section>
    ${supportingScene(s)}${playedMoves(s)}
    <div class="connection-banner" ${connected ? "hidden" : ""}>CONNECTION INTERRUPTED · Clocks paused</div></main>`;
}
function resizeProgramme(): void {
  if (!operator)
    app.style.setProperty(
      "--programme-scale",
      String(Math.min(innerWidth / 1920, innerHeight / 1080)),
    );
}
let renderedRoot = "";
let renderedKind = "";
let renderedInstance = "";
function renderProgramme(s: ProgrammeSnapshot): void {
  const key = JSON.stringify([s.scene.instance, s.scene.frameIndex, s.engines, s.panel,
    s.panel === "time" && s.moveTimes, s.panel === "history" && s.history.map(r => [r.sesse,r.leela,r.rootKey])]);
  if (key !== renderKey) {
    const transition = renderedInstance && renderedInstance !== s.scene.instance;
    const motion = Boolean(transition && connected && !recovering && !reducedMotion.matches);
    renderKey = key;
    const main = app.querySelector<HTMLElement>(".programme");
    const spotlight = s.scene.kind === "spotlight";
    if (main && renderedRoot === s.game.rootKey) {
      if (spotlight !== (renderedKind === "spotlight")) {
        switchSpotlight(main, spotlight, supportingScene(s), motion);
      } else if (spotlight) {
        // Keep the animated layer in place as the hypothetical line advances.
        main.querySelector(".spotlight-layer:not([data-departing])")!.innerHTML = spotlightContents(s);
      } else {
        const panel = main.querySelector<HTMLElement>(".comparison-panel:not([data-departing])")!;
        panel.innerHTML = supportingPanel(s);
        if (motion) {
          panel.getAnimations().forEach(animation => animation.cancel());
          revealPanel(panel);
        }
      }
      main.dataset.instance = s.scene.instance;
      main.dataset.scene = s.scene.kind;
    } else {
      // A played move or correction takes the entire old position off air immediately.
      cutProgrammeMotion();
      app.innerHTML = programme(s);
      resizeProgramme();
      const panel = app.querySelector<HTMLElement>(".comparison-panel");
      if (motion && panel) revealPanel(panel);
    }
    renderedKind = s.scene.kind;
    renderedRoot = s.game.rootKey;
    renderedInstance = s.scene.instance;
  }
  for (const [color, ms] of [
    ["w", s.clocks.whiteMs],
    ["b", s.clocks.blackMs],
  ] as const) {
    const el = app.querySelector(`[data-clock="${color}"]`);
    if (el) el.textContent = clock(ms);
  }
}
function operatorShell(): void {
  app.innerHTML = `<main class="control-room">
    <header class="operator-header">
      <div><span class="demo-badge">DEMO</span><h1>Control room</h1></div>
      <div><span class="connection-status" id="connection-status">Connecting…</span>
      <a class="text-link" href="/programme" target="_blank" rel="noopener">Open programme</a></div>
    </header>
    <div class="control-grid">
      <section class="station">
        <div class="section-bar"><h2>Programme preview</h2><span>1920 × 1080</span></div>
        <div class="programme-preview"><iframe src="/programme" title="Programme preview" tabindex="-1"></iframe></div>
        <div class="preview-caption"><strong id="director-scene">—</strong><span>Elapsed <b id="fixture-time">0:00</b></span></div>
        <div class="cue-buttons" role="group" aria-label="Rehearsal controls">
          <button data-command="restart">Restart demo</button>
          <button data-command="cue-spotlight">Cue variation</button>
          <button data-command="release-move" class="primary">Play actual move</button>
          <button data-command="return-live">Return to actual board</button>
        </div>
        <p id="command-status" role="status" aria-live="polite"></p>
      </section>
      <aside class="inspector">
        <section><h2>Game</h2>
          <dl class="data-rows">
            <dt>Event</dt><dd id="bound-event">—</dd>
            <dt>Round</dt><dd id="bound-round">—</dd>
            <dt>White</dt><dd id="white-player">—</dd>
            <dt>Black</dt><dd id="black-player">—</dd>
            <dt>Last move</dt><dd id="actual-position">—</dd>
          </dl>
        </section>
        <section><h2>Recent moves</h2><div class="move-history" id="move-history"></div></section>
        <section><h2>Fixture feeds</h2><dl class="data-rows" id="source-health"></dl></section>
        <details class="diagnostics"><summary>Rehearsal details</summary>
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
  if (el) el.textContent = value;
}
function setCommandStatus(value: string): void {
  setText("#command-status", value);
}
function renderOperator(s: ProgrammeSnapshot): void {
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
async function operatorDetails(): Promise<void> {
  try {
    const response = await fetch("/api/operator", { cache: "no-store" });
    if (!response.ok) throw new Error("Operator diagnostics unavailable");
    const details = (await response.json()) as OperatorSnapshot;
    setText("#time-control", details.timeControl);
    setText("#variation-time", shortTime(details.spotlightAtMs));
    setText("#move-time", shortTime(details.moveAtMs));
    setText("#journal-count", String(details.journalEntries));
    setText("#provider-contract", details.providerContract);
  } catch {
    setText("#provider-contract", "Diagnostics unavailable; reconnecting.");
  }
}
async function sendCommand(command: Command): Promise<void> {
  if (pending || !latest) return;
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
        revision: latest.game.revision,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Cue rejected");
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
    await operatorDetails();
  } catch (error) {
    setCommandStatus(error instanceof Error ? error.message : "Cue failed");
  } finally {
    pending = false;
    if (latest) renderOperator(latest);
  }
}
function connection(value: boolean): void {
  connected = value;
  if (!value) cutProgrammeMotion();
  const banner = app.querySelector<HTMLElement>(".connection-banner");
  if (banner) banner.hidden = value;
  setText(
    "#connection-status",
    value ? "Director connected" : "Connection interrupted",
  );
  app.querySelector("#connection-status")?.classList.toggle("offline", !value);
  if (operator && latest) renderOperator(latest);
}
function accept(s: ProgrammeSnapshot): void {
  if (latest && s.sequence <= latest.sequence) return;
  latest = s;
  if (operator) renderOperator(s);
  else renderProgramme(s);
}
async function resnapshot(): Promise<void> {
  if (recovering) return;
  recovering = true;
  cutProgrammeMotion();
  try {
    const response = await fetch("/api/programme", { cache: "no-store" });
    if (!response.ok) throw new Error("Snapshot unavailable");
    const snapshot = (await response.json()) as ProgrammeSnapshot;
    if (latest && snapshot.sequence < latest.sequence) {
      latest = undefined;
      renderKey = "";
    }
    accept(snapshot);
  } catch {
    connection(false);
  } finally {
    recovering = false;
  }
}
if (operator) {
  operatorShell();
  void operatorDetails();
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
  });
  source.addEventListener("snapshot", (event) => {
    if (source !== stream || !navigator.onLine) return;
    lastReceived = performance.now();
    const s = JSON.parse((event as MessageEvent).data) as ProgrammeSnapshot;
    connection(true);
    if (latest && s.sequence > latest.sequence + 1) {
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
