import type { EngineId, LiveDirection, LivePanel, LiveProfile, Scene } from "../shared/types.js";
import type { GameFeed } from "./game-feed.js";
import { rootKey, variationFrames } from "./fixtures.js";
import { ordinaryProfile } from "./statistics.js";

export const defaultProfile: LiveProfile = {
  version: 1, panels: [...ordinaryProfile.map(([id, ms]): [LivePanel, number] => [id, ms]), ["notation", 16_000], ["numbers", 18_000]],
  settleMs: 12000, provisionalMs: 30000, longThinkMs: 75_000, cooldownMs: 90_000, maxPlies: 8, plyMs: 2000, pressureMs: 300_000,
};

export function validateProfile(input: unknown): LiveProfile {
  const p = input as LiveProfile;
  const range = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
  if (!p || p.version !== 1 || !Array.isArray(p.panels) || p.panels.length !== defaultProfile.panels.length ||
      !defaultProfile.panels.every(([id]) => p.panels.some(row => Array.isArray(row) && row.length === 2 && row[0] === id && range(row[1], 6000, 120000))) ||
      !range(p.settleMs, 6000, 30000) || !range(p.provisionalMs, p.settleMs, 60000) ||
      !range(p.longThinkMs, 75000, 600000) || !range(p.cooldownMs, 90000, 600000) ||
      !range(p.maxPlies, 2, 8) || !range(p.plyMs, 1000, 4000) || 4000 + p.maxPlies * p.plyMs + 2100 > 24000 ||
      !range(p.pressureMs, 300000, 900000)) throw Error("Invalid cadence, panel order or spotlight budget");
  return { version: 1, panels: p.panels, settleMs: p.settleMs, provisionalMs: p.provisionalMs, longThinkMs: p.longThinkMs, cooldownMs: p.cooldownMs,
    maxPlies: p.maxPlies, plyMs: p.plyMs, pressureMs: p.pressureMs };
}

export class LiveDirector {
  state = {
    key: "", rootAt: 0, recent: [] as number[], quietUntil: 0, ply: 0, revision: 0,
    panel: "notation" as LivePanel, panelUntil: 0, emphasizeUntil: 0,
    heldAt: 0, automatic: true, pinned: undefined as LivePanel | undefined, held: false,
    spotlight: undefined as { at: number; until: number; scene: Scene } | undefined,
    lastSource: undefined as EngineId | undefined, nextSpot: 0,
    profile: structuredClone(defaultProfile),
  };
  private position?: GameFeed["released"]["position"];
  private key = "";
  private available: LivePanel[] = [];
  private canFeature = false;
  private preferSpot = false;
  private nextPanel = false;

  constructor(private epoch: number, private gameId: string, saved?: Partial<LiveDirector["state"]>) {
    Object.assign(this.state, saved);
  }

  get featureEligible() { return this.canFeature; }
  panelEligible(panel: unknown) { return this.available.includes(panel as LivePanel); }

  endSpot(now: number) {
    const s = this.state;
    if (s.spotlight) {
      s.nextSpot = Math.min(now, s.spotlight.until) + Math.max(45000, s.profile.cooldownMs);
      s.spotlight = undefined;
    }
  }

  control(command: string, now: number, value?: unknown) {
    const s = this.state;
    switch (command) {
      case "hold": this.endSpot(now); if (!s.held) s.heldAt = now; s.held = true; break;
      case "resume": if (s.held && s.nextSpot > s.heldAt) s.nextSpot += now - s.heldAt; s.held = false; s.emphasizeUntil = 0; break;
      case "profile": s.profile = validateProfile(value); this.endSpot(now); s.panelUntil = now; break;
      case "auto": s.automatic = true; s.pinned = undefined; break;
      case "pause-auto": this.endSpot(now); s.automatic = false; break;
      case "pin": if (!this.available.includes(value as LivePanel)) throw Error("Panel unavailable at the released position");
        this.endSpot(now); s.pinned = value as LivePanel; break;
      case "next": this.endSpot(now); s.pinned = undefined; this.nextPanel = true; break;
      case "feature": if (!this.canFeature) throw Error("No eligible variation"); this.preferSpot = true; break;
      case "actual": this.endSpot(now); s.nextSpot = Math.max(s.nextSpot, now + 45000); break;
      default: throw Error("Unknown direction control");
    }
  }

  at(feed: GameFeed, now: number): LiveDirection | undefined {
    const { position, analysis = {}, interrupted } = feed.released;
    const s = this.state;
    if (!position?.moves.length || position.summary.result || !feed.facts) {
      this.endSpot(now); s.key = ""; s.pinned = undefined; this.canFeature = false; this.available = []; return;
    }
    if (position !== this.position) {
      this.position = position;
      this.key = rootKey(this.gameId, this.epoch, position.revision, position.moves, position.startFen);
    }
    const rootChanged = s.key !== this.key;
    if (rootChanged) {
      const contiguous = s.key && s.revision === position.revision;
      const added = contiguous ? Math.min(3, Math.max(0, position.moves.length - s.ply)) : 1;
      s.recent = [...(contiguous ? s.recent.filter(at => at >= feed.rootAt - 30000) : []), ...Array<number>(added).fill(feed.rootAt)].slice(-3);
      if (!contiguous) s.quietUntil = 0;
      if (s.recent.length === 3) s.quietUntil = feed.rootAt + 45000;
      this.endSpot(feed.rootAt);
      Object.assign(s, { key: this.key, rootAt: feed.rootAt, ply: position.moves.length, revision: position.revision,
        pinned: undefined, panel: "notation", panelUntil: feed.rootAt + 6000,
        emphasizeUntil: feed.rootAt + 6000 });
    }
    const clocks = position.clocks && { ...position.clocks };
    if (clocks && position.clockRunning) {
      const running = position.summary.fen.split(" ")[1] === "w" ? "whiteMs" : "blackMs";
      const freezeAt = interrupted ? feed.rootAt : now;
      if (clocks[running] !== undefined) clocks[running] = Math.max(0, clocks[running] - Math.max(0, freezeAt - s.rootAt));
    }
    const low = Math.min(clocks?.whiteMs ?? Infinity, clocks?.blackMs ?? Infinity);
    const minimum = !!clocks && low <= 60000;
    const facts = feed.facts;
    const panels = new Set<LivePanel>(["notation", "numbers"]);
    if (Object.keys(analysis).length) panels.add("comparison");
    if (analysis.leela?.wdl) panels.add("outcomes");
    if (facts.white.timedMoves || facts.black.timedMoves) panels.add("time");
    if (Object.values(analysis).some(a => a?.work !== undefined)) panels.add("search");
    if (facts.samples.some(row => row.pawns !== undefined || row.wdl) || analysis.sesse?.pawns !== undefined || analysis.leela?.wdl)
      panels.add("history");
    const emphasis = now < s.emphasizeUntil;
    const settling = panels.has("comparison") && (now - s.rootAt < s.profile.settleMs || (now - s.rootAt < s.profile.provisionalMs && !Object.values(analysis).some(a => a?.progress?.ready)));
    const slots = s.profile.panels.filter(([panel]) => panels.has(panel));
    this.available = slots.map(([id]) => id);
    const sources = (["sesse", "leela"] as const).filter(id => {
      const a = analysis[id];
      return a?.historyVerified && a.progress?.ready && a.line.length >= 2;
    });
    const safe = clocks?.whiteMs !== undefined && clocks.blackMs !== undefined && position.clockRunning === true && !s.held && !interrupted && low > s.profile.pressureMs && now >= s.quietUntil;
    if (s.spotlight && (!safe || !analysis[s.spotlight.scene.source!] || now >= s.spotlight.until)) this.endSpot(now);
    this.canFeature = safe && !!sources.length && !s.spotlight && now >= s.nextSpot && now - s.rootAt >= s.profile.longThinkMs;
    if (this.canFeature && ((s.automatic && !s.pinned) || this.preferSpot)) {
      const other = sources.find(id => id !== s.lastSource && analysis[id]?.line.join(" ") !== analysis[s.lastSource!]?.line.join(" "));
      const source = other ?? sources[0];
      const frames = variationFrames(position.moves, analysis[source]!.line, position.startFen).slice(0, s.profile.maxPlies + 1);
      s.spotlight = { at: now, until: now + 2000 + (frames.length - 2) * s.profile.plyMs + 4000,
        scene: { kind: "spotlight", instance: `${s.key}-pv-${now}`, source, rootKey: s.key, frames, title: "Analysis variation" } };
      s.lastSource = source;
      s.panelUntil = s.spotlight.until;
    }
    this.preferSpot = false;
    if (s.spotlight) {
      const spot = s.spotlight;
      return { rootKey: s.key, panel: s.panel, scene: { ...spot.scene, frameIndex: Math.min(spot.scene.frames!.length - 1,
        now < spot.at + 2000 ? 0 : 1 + Math.floor((now - spot.at - 2000) / s.profile.plyMs)) }, clocks, facts };
    }
    const basic = panels.has("comparison") ? "comparison" : "notation";
    let panel = s.panel;
    if (emphasis) panel = "notation";
    else if (minimum || interrupted) panel = basic;
    else if (s.pinned && panels.has(s.pinned)) panel = s.pinned;
    else if (settling && !this.nextPanel) panel = basic;
    else if (this.nextPanel || !panels.has(panel) || (s.automatic && now >= s.panelUntil)) {
      panel = slots[(slots.findIndex(([id]) => id === panel) + 1) % slots.length][0];
    }
    if (panel !== s.panel || this.nextPanel || s.panelUntil <= now) {
      s.panel = panel; s.panelUntil = now + slots.find(([id]) => id === panel)![1];
    }
    this.nextPanel = false;
    const kind = emphasis ? "actual-move" : "thinking";
    return { rootKey: s.key, panel, clocks, facts, scene: { kind, title: panel,
      instance: `${s.key}-${kind}-${panel}` } };
  }
}
