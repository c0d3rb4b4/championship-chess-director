import { randomUUID } from "node:crypto";
import type { BroadcastOperator, BroadcastSnapshot, Command, RealProgramme, SelectionControls } from "../shared/types.js";
import type { Catalogue, CatalogueGame } from "../shared/catalogue.js";
import { loadCatalogue, parseCatalogue } from "./catalogue.js";
import { BindingError, fetchGameSummary } from "./game-summary.js";
import { Director } from "./director.js";
import type { Selection, Store } from "./store.js";

export type SelectionCommand = "select-game" | "enter-demo" | "clear-selection";
export interface BroadcastOptions {
  now?: () => number;
  wallNow?: () => number;
  request?: typeof fetch;
  cataloguePath?: string;
  startInDemo?: boolean;
}

export class CommandError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type VerifiedSummary = NonNullable<RealProgramme["summary"]>;
interface SavedSummary { identity: string; summary: VerifiedSummary }

function identity(catalogue: Catalogue, game: CatalogueGame) {
  return JSON.stringify([catalogue.eventId, game.id, game.white.id, game.black.id, game.startFen, game.binding]);
}

/** One shared selection and one authority read per take, independent of SSE subscriber count. */
export class Broadcast {
  private readonly catalogue: Catalogue;
  private readonly catalogueWarning: string | null;
  private selection: Selection;
  private summary: VerifiedSummary | null = null;
  private status: SelectionControls["authorityStatus"] = "idle";
  private diagnostic: string | null = null;
  private read?: AbortController;
  private sequence = 0;
  private readonly streamId = randomUUID();
  private director?: Director;
  private baseMs = 0;
  private anchor = 0;
  private persistedSecond = -1;
  current!: BroadcastSnapshot;

  constructor(private readonly store: Store, private readonly options: BroadcastOptions, private readonly publish: () => void) {
    this.selection = store.loadSelection();
    const cached = store.loadCatalogue<Catalogue>();
    let catalogue: Catalogue;
    this.catalogueWarning = null;
    try {
      catalogue = loadCatalogue(options.cataloguePath);
      if (cached && this.selection.gameId && (catalogue.eventId !== cached.eventId ||
          !catalogue.games.some(game => game.id === this.selection.gameId))) {
        throw Error("Configured catalogue omits the active championship game");
      }
    } catch (error) {
      if (!cached) throw error;
      catalogue = parseCatalogue(cached);
      this.catalogueWarning = "Using the last validated catalogue. " + (error instanceof Error ? error.message : "Configuration unavailable");
    }
    this.catalogue = catalogue;
    store.saveCatalogue(catalogue);
    if (options.startInDemo && this.selection.epoch === 0) {
      store.selectGame("startup-demo", 0, "demo", null);
      this.selection = store.loadSelection();
    } else if (!options.startInDemo && this.selection.mode === "demo") {
      // A normal restart never puts a rehearsal checkpoint back on air by itself.
      store.selectGame(randomUUID(), this.selection.epoch, "real", null);
      this.selection = store.loadSelection();
    }
    this.activate();
  }

  private get game() { return this.catalogue.games.find(game => game.id === this.selection.gameId); }
  private now() { return this.options.now?.() ?? performance.now(); }
  private wallNow() { return (this.options.wallNow ?? Date.now)(); }

  private activate() {
    this.read?.abort();
    this.read = undefined;
    this.director = undefined;
    this.summary = null;
    this.diagnostic = null;
    this.status = "idle";
    if (this.selection.mode === "demo") {
      this.director = new Director(this.store.load());
      this.baseMs = this.director.checkpoint().elapsedMs;
      this.anchor = this.now();
      this.persistedSecond = -1;
      this.current = { ...this.director.snapshot(), streamId: this.streamId, selectionEpoch: this.selection.epoch, sequence: ++this.sequence };
      return;
    }
    const game = this.game;
    if (game?.binding) {
      const cached = this.store.loadSummary<SavedSummary>(this.selection.epoch, game.id);
      if (cached?.identity === identity(this.catalogue, game)) this.summary = cached.summary;
      this.status = "loading";
      this.read = new AbortController();
      void this.readAuthority(game, this.selection.epoch, this.read);
    } else if (game) this.status = "pending-binding";
    this.current = this.realSnapshot();
  }

  private async readAuthority(game: CatalogueGame, epoch: number, read: AbortController) {
    try {
      const record = await fetchGameSummary(game, read.signal, this.options.request);
      if (read.signal.aborted) return;
      const summary = { ...record, observedAt: new Date(this.wallNow()).toISOString() };
      if (!this.store.saveSummary(epoch, game.id, { identity: identity(this.catalogue, game), summary })) return;
      this.summary = summary;
      this.status = "verified";
    } catch (error) {
      if (read.signal.aborted) return;
      this.status = error instanceof BindingError ? "mismatch" : "unavailable";
      this.diagnostic = error instanceof Error ? error.message : "Authority summary unavailable";
    }
    this.current = this.realSnapshot();
    this.publish();
  }

  private realState(): RealProgramme["state"] {
    const game = this.game;
    if (!game) return "unselected";
    if (this.summary) {
      if (this.summary.result) return "finished";
      return this.summary.plies ? "underway" : "waiting";
    }
    if (game.scheduledStart && this.wallNow() >= Date.parse(game.scheduledStart)) return "unavailable";
    return "pending";
  }

  private realSnapshot(): RealProgramme {
    const game = this.game;
    return {
      mode: "REAL", streamId: this.streamId, sequence: ++this.sequence, selectionEpoch: this.selection.epoch,
      eventName: this.catalogue.eventName, timeZone: this.catalogue.timeZone,
      game: game ? { id: game.id, label: game.label, order: game.order, scheduledStart: game.scheduledStart,
        white: game.white, black: game.black } : null,
      state: this.realState(), summary: this.summary,
    };
  }

  tick() {
    if (this.director) {
      const next = this.director.advanceTo(this.baseMs + Math.max(0, this.now() - this.anchor));
      const second = Math.floor(next.presentationMs / 1000);
      if (second !== this.persistedSecond) {
        this.store.save(this.director.checkpoint());
        this.persistedSecond = second;
      }
      this.current = { ...next, streamId: this.streamId, selectionEpoch: this.selection.epoch, sequence: ++this.sequence };
    } else if (this.current.mode === "REAL" && this.current.state !== this.realState()) {
      this.current = this.realSnapshot();
    }
    return this.current;
  }

  operator(): BroadcastOperator {
    const controls = {
      catalogue: this.catalogue, selectionEpoch: this.selection.epoch,
      authorityStatus: this.status, diagnostic: [this.catalogueWarning, this.diagnostic].filter(Boolean).join(" ") || null,
    };
    if (this.current.mode === "REAL") return { ...controls, programme: this.current };
    return { ...controls, ...this.director!.operator(this.current, this.store.count) };
  }

  select(id: string, command: SelectionCommand, epoch: number, gameId?: string) {
    if (command === "select-game" && !this.catalogue.games.some(game => game.id === gameId))
      throw new CommandError(400, "Unknown championship game");
    if (command !== "select-game" && gameId !== undefined)
      throw new CommandError(400, "Unexpected game ID");
    if (this.director) this.store.save(this.director.checkpoint());
    const result = this.store.selectGame(id, epoch, command === "enter-demo" ? "demo" : "real", gameId ?? null);
    if (result === "duplicate") return true;
    if (result !== "applied") throw new CommandError(409, result === "conflict"
      ? "Command ID was already used for another request" : "On-air selection changed. Review the active game before taking another.");
    this.selection = this.store.loadSelection();
    this.activate();
    this.publish();
    return false;
  }

  cue(id: string, command: Command, selectionEpoch: number, epoch?: number, revision?: number) {
    const director = this.director;
    if (!director || this.current.mode !== "DEMO" || selectionEpoch !== this.selection.epoch)
      throw new CommandError(409, "Rehearsal cues require the active demo selection");
    const prior = this.store.getCommand(id);
    if (prior) {
      if (prior.command === command && prior.epoch === epoch && prior.selectionEpoch === selectionEpoch &&
          revision === this.current.game.revision) return true;
      throw new CommandError(409, "Command ID was already used for another request");
    }
    if (epoch !== this.current.game.epoch || revision !== this.current.game.revision)
      throw new CommandError(409, "Game changed. Refresh before issuing this command.");
    const previous = director.checkpoint();
    try {
      const next = director.command(command);
      this.store.commitCommand(id, command, epoch, director.checkpoint(), selectionEpoch);
      this.baseMs = next.presentationMs;
      this.anchor = this.now();
      this.current = { ...next, streamId: this.streamId, selectionEpoch, sequence: ++this.sequence };
    } catch (error) {
      director.restore(previous);
      throw new CommandError(409, error instanceof Error ? error.message : "Command rejected");
    }
    this.publish();
    return false;
  }

  stop() {
    this.read?.abort();
    if (this.director) this.store.save(this.director.checkpoint());
  }
}
