import { board, escape as e } from "./board.js";
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
function players(s: ProgrammeSnapshot, compact = false): string {
  return `<div class="players ${compact ? "compact" : ""}">
    <div class="player ${s.game.turn === "w" ? "running" : ""}"><span class="player-name"><i class="player-piece white-dot"></i>${e(s.game.white)}</span><strong data-clock="w">${clock(s.clocks.whiteMs)}</strong></div>
    <div class="player ${s.game.turn === "b" ? "running" : ""}"><span class="player-name"><i class="player-piece black-dot"></i>${e(s.game.black)}</span><strong data-clock="b">${clock(s.clocks.blackMs)}</strong></div>
  </div>`;
}
function engineSummary(engine: EngineView): string {
  return `<div class="engine-summary ${engine.id}"><div><span class="eyebrow">${engine.id === "sesse" ? "STOCKFISH / SESSE" : "LEELA CHESS ZERO"}</span><strong>${e(engine.score)}</strong></div><p>${engine.status === "Updating for this position" ? e(engine.status) : e(engine.scoreLabel)}</p></div>`;
}
function engineColumn(engine: EngineView): string {
  return `<section class="engine-column ${engine.id}"><div class="engine-heading"><span>${engine.id === "sesse" ? "Stockfish" : "Leela"}</span><span class="source-state">${e(engine.status)}</span></div>
    ${engine.candidates.length ? engine.candidates.map((c, i) => `<div class="candidate ${i === 0 ? "preferred" : ""}"><div><span class="candidate-label">${i === 0 ? "TOP CANDIDATE" : "ALTERNATIVE"}</span><span class="depth">Depth ${c.depth}</span></div><strong>${e(c.moves[0])}</strong><p>${e(c.moves.slice(1, 5).join("  "))}</p></div>`).join("") : '<div class="updating"><span class="quiet-mark">···</span><h3>Updating for this position</h3><p>Previous suggestions have been cleared. Waiting for matching analysis.</p></div>'}
    </section>`;
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
function programme(s: ProgrammeSnapshot): string {
  const spotlight = s.scene.kind === "spotlight";
  const index = s.scene.frameIndex ?? 0;
  return `<main class="programme ${spotlight ? "spotlight" : ""}" data-scene="${s.scene.kind}" data-instance="${s.scene.instance}" data-testid="programme">
    <header class="programme-header"><div><h1><span class="brand-icon">♞</span>${e(s.game.event)}</h1><p>${e(s.game.round)}<span class="separator">/</span>ACTUAL GAME · ${s.game.turn === "w" ? "WHITE" : "BLACK"} TO MOVE · after ${e(s.actual.moveLabel)}</p></div><div class="broadcast-label"><span class="demo-badge">DEMO</span><span>Fictional game · fixture analysis</span></div></header>
    ${
      spotlight
        ? `<section class="mini-actual"><h2>ACTUAL GAME</h2><p class="actual-caption">Position after ${e(s.actual.moveLabel)}</p><div class="mini-board">${board(s.actual, "actual")}</div>${players(s, true)}<div class="think-caption"><span class="thinking-indicator"></span>${s.game.turn === "w" ? "White" : "Black"} is still thinking.</div><p class="mini-note">The actual game stays here.<br>A played move interrupts this line.</p></section>
      <section class="analysis-region"><h2>ANALYSIS LINE NOT PLAYED</h2><div class="analysis-board" data-frame="${index}">${board(s.scene.frames![index], "analysis")}</div></section>
      <aside class="variation-rail sesse"><span class="eyebrow">POSSIBLE CONTINUATION</span><h2>Stockfish idea</h2><p>From the actual position<br>after ${e(s.actual.moveLabel)}</p><ol>${s.scene
        .frames!.slice(1)
        .map(
          (f, i) =>
            `<li class="${i + 1 === index ? "current" : i + 1 < index ? "passed" : ""}"><span>${e(f.moveLabel)}</span></li>`,
        )
        .join(
          "",
        )}</ol><div class="rail-footer"><strong>Frozen legal line</strong><span>${index === 0 ? "Root position" : `Ply ${index} of ${s.scene.frames!.length - 1}`}</span><span>Sesse · synthetic fixture</span></div></aside>`
        : `<section class="large-actual">${players(s)}<div class="actual-board-wrap">${board(s.actual, "actual")}</div></section>
      <div class="summary-row">${s.engines.map(engineSummary).join("")}</div>
      <section class="comparison-panel"><div class="panel-title"><h2>${s.scene.kind === "actual-move" ? "A move on the board" : "Two engines. Two ideas."}</h2><span>${s.scene.kind === "actual-move" ? "ACTUAL MOVE" : "ENGINE CHOICES"}</span></div>
      ${s.scene.kind === "actual-move" ? `<div class="move-announcement"><span class="move-number">10.</span><strong>d4</strong><p>White opens the centre.</p><span>Analysis playback interrupted · actual board restored</span></div><div class="pending-strip">Sesse and Leela · Updating for this position</div>` : `<div class="engine-columns">${s.engines.map(engineColumn).join("")}</div><p class="panel-disclaimer">${s.game.ply > 18 ? "The actual board has advanced. Previous-position analysis is hidden." : "Illustrative engine choices · hypothetical moves, not player predictions"}</p>`}
      </section>`
    }
    <footer class="ticker"><span>${spotlight ? "ACTUAL GAME CONTINUES" : s.scene.kind === "actual-move" ? "MOVE PLAYED" : "THE CLASSICAL ROOM"}</span><p>${e(s.ticker)}</p></footer>
    <div class="connection-banner" ${connected ? "hidden" : ""}>DEMO · CONNECTION INTERRUPTED · last confirmed board · clocks paused</div>
  </main>`;
}
function resizeProgramme(): void {
  if (!operator)
    app.style.setProperty(
      "--programme-scale",
      String(Math.min(innerWidth / 1920, innerHeight / 1080)),
    );
}
function renderProgramme(s: ProgrammeSnapshot): void {
  const key = JSON.stringify([
    s.scene.instance,
    s.scene.frameIndex,
    s.engines.map((x) => [x.status, x.depth]),
  ]);
  if (key !== renderKey) {
    renderKey = key;
    app.innerHTML = programme(s);
    resizeProgramme();
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
  app.innerHTML = `<header class="operator-header"><a class="operator-brand" href="/operator"><span class="brand-icon">♞</span>CHESS DIRECTOR<span class="brand-divider"></span><span class="room-label">Control room</span></a><div><span class="demo-badge">DEMO</span><a class="text-link" href="/programme" target="_blank" rel="noopener">Open programme</a></div></header>
    <div class="operator-layout"><aside class="operator-sidebar"><span class="eyebrow">LOCAL REHEARSAL</span><h1>The Classical<br>Room</h1><p class="sidebar-caption">One game. One shared programme.</p><div class="sidebar-section"><span class="eyebrow">BOUND EVENT</span><h3>Alex Morgan <span>vs</span><br>Sam Rivera</h3><p>Game 1 · White at the bottom<br>Italian Game · fictional players</p><div class="metadata-row"><span>Move authority</span><b>DEMO fixture</b></div><div class="metadata-row"><span>Programme delay</span><b>0 seconds</b></div><div class="metadata-row"><span>Audio</span><b>Silent</b></div></div><div class="sidebar-section"><span class="eyebrow">FIXTURE SOURCES</span><div id="source-health"></div><p>Hand-authored data. No live provider connections.</p></div><div class="sidebar-bottom"><span class="local-mark"></span>Loopback access only<p>Synthetic demo · v0.1.0</p></div></aside>
    <main class="operator-main"><div class="operator-title"><div><span class="eyebrow">PROGRAMME MONITOR</span><h2>Direct the next moment.</h2><p>Every viewer sees the same scene, including the OBS programme.</p></div><div class="connection-status" id="connection-status">Connecting…</div></div>
      <div class="control-grid"><section class="preview-section"><div class="section-bar"><span><i class="preview-light"></i>ON-AIR PREVIEW · DEMO</span><span>1920 × 1080</span></div><div class="programme-preview"><iframe src="/programme" title="Shared DEMO programme preview" tabindex="-1"></iframe></div><div class="preview-caption"><span id="current-scene">Thinking</span><span>Shared server timeline · no added delay</span></div>
      <section class="cue-section"><div><span class="eyebrow">REHEARSAL CUES</span><h3>A complete story in three moments</h3></div><div class="cue-timeline"><div data-phase="thinking"><span class="step-dot"></span><strong>A player thinks</strong><small>0:00 · actual board stays large</small></div><div data-phase="spotlight"><span class="step-dot"></span><strong>An idea takes focus</strong><small>1:15 · frozen Stockfish continuation</small></div><div data-phase="actual-move"><span class="step-dot"></span><strong>A real move takes priority</strong><small>1:23 · 10.d4 restores the actual board</small></div></div><div class="cue-buttons"><button data-command="restart" class="button secondary">Restart demo</button><button data-command="cue-spotlight" class="button secondary">Cue variation</button><button data-command="release-move" class="button primary">Play actual move</button><button data-command="return-live" class="button quiet">Return to actual board</button></div><p class="cue-note">Cues advance presentation time. Leave it running to play the same sequence automatically in 83 seconds.</p><p id="command-status" role="status" aria-live="polite"></p></section>
      </section><aside class="inspector"><section><span class="eyebrow">DIRECTOR STATUS</span><h3 id="director-scene">Player thinking</h3><div class="metadata-row"><span>Fixture time</span><b id="fixture-time">0:00</b></div><div class="metadata-row"><span>Actual position</span><b id="actual-position">After 9…h6</b></div><div class="metadata-row"><span>Game epoch / revision</span><b id="game-revision">1 / 1</b></div><div class="metadata-row"><span>Applied commands</span><b id="journal-count">0</b></div><p class="inspector-note">Real moves outrank playback. Return to actual board cancels the current variation without advancing the game.</p></section>
      <section><span class="eyebrow">POSITION INTEGRITY</span><h3 class="integrity">Legal history verified</h3><p>Initial position, full move history, epoch and revision identify the analysis root.</p><code id="root-key"></code><p id="provider-contract"></p></section>
      <section class="obs-card"><span class="eyebrow">READY FOR OBS</span><h3>One clean Browser Source</h3><p>Add the programme URL at <b>1920 × 1080</b>, 30 fps. Keep refresh-on-activation and shutdown-when-hidden disabled.</p><button class="button secondary" id="copy-url">Copy programme URL</button><p class="obs-footnote">Mix music separately in OBS.</p></section></aside></div>
      <section class="operator-bottom"><div><span class="eyebrow">ACTUAL MOVES</span><div class="move-history" id="move-history"></div></div><div><span class="eyebrow">SCOPE OF THIS SLICE</span><p>Deterministic fixture rehearsal. Live feed capture, production protocol verification, delayed broadcasts and the full panel rotation are future milestones.</p></div></section>
    </main></div>`;
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
  setText("#actual-position", `After ${s.actual.moveLabel}`);
  setText("#game-revision", `${s.game.epoch} / ${s.game.revision}`);
  setText(
    "#director-scene",
    s.scene.kind === "spotlight"
      ? "Variation spotlight"
      : s.scene.kind === "actual-move"
        ? "Actual move · 10.d4"
        : s.game.ply > 18
          ? "Black is thinking"
          : "White is thinking",
  );
  setText(
    "#current-scene",
    `${s.scene.kind === "spotlight" ? "ANALYSIS LINE NOT PLAYED" : "ACTUAL GAME"} · ${s.game.turn === "w" ? "White" : "Black"} to move`,
  );
  setText("#root-key", s.game.rootKey.slice(0, 24) + "…");
  const key = JSON.stringify([
    s.scene.instance,
    s.engines.map((x) => x.status),
  ]);
  if (key !== renderKey) {
    renderKey = key;
    app.querySelector("#source-health")!.innerHTML = s.engines
      .map(
        (x) =>
          `<div class="source-health ${x.id}"><div><strong>${x.source === "Sesse" ? "Stockfish / Sesse" : "Leela Chess Zero"}</strong><span>${e(x.status)}</span></div><small>synthetic-demo-v1 · local fixture</small></div>`,
      )
      .join("");
    app.querySelector("#move-history")!.innerHTML = recentMoves(s);
    app
      .querySelectorAll<HTMLElement>("[data-phase]")
      .forEach((el) =>
        el.classList.toggle(
          "active",
          el.dataset.phase === (s.game.ply > 18 ? "actual-move" : s.scene.kind),
        ),
      );
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
        ? "Demo restarted. White is thinking."
        : command === "cue-spotlight"
          ? "Variation cued. The actual board stays visible."
          : command === "release-move"
            ? "10.d4 played. Old playback cancelled."
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
