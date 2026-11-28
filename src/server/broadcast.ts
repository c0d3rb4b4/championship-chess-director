import { randomUUID } from "node:crypto";
import type { BroadcastOperator, BroadcastSnapshot, Command, FinishedRecap, RealProgramme, SelectionControls } from "../shared/types.js";
import type { Catalogue, CatalogueGame } from "../shared/catalogue.js";
import { loadCatalogue, parseCatalogue } from "./catalogue.js";
import { GameFeed, type FeedOptions } from "./game-feed.js";
import { Director } from "./director.js";
import type { Recap } from "./recap.js";
import type { Selection, Store } from "./store.js";

export type SelectionCommand = "select-game" | "enter-demo" | "clear-selection";
export interface BroadcastOptions extends FeedOptions {
  now?: () => number;
  cataloguePath?: string;
  startInDemo?: boolean;
}

export class CommandError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function identity(catalogue: Catalogue, game: CatalogueGame) {
  return JSON.stringify([catalogue.eventId, game.id, game.white.id, game.black.id, game.startFen, game.binding]);
}

/** One shared selection and one authority session per take, independent of SSE subscriber count. */
export class Broadcast {
  private readonly catalogue: Catalogue;
  private readonly catalogueWarning: string | null;
  private selection: Selection;
  private feed?: GameFeed;
  private recapMetadata?: { source: Recap; matchScore?: FinishedRecap["matchScore"]; next?: FinishedRecap["next"] };
  private legacySummary: RealProgramme["summary"] = null;
  private sequence = 0;
  private readonly streamId = randomUUID();
  private director?: Director;
  private baseMs = 0;
  private anchor = 0;
  private persistedSecond = -1;
  current!: BroadcastSnapshot;

  constructor(private readonly store: Store, private readonly options: BroadcastOptions, private readonly publish: () => void) {
    if (!Number.isSafeInteger(options.delayMs ?? 0) || (options.delayMs ?? 0) < 0) throw Error("Invalid programme delay");
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
    this.feed?.stop();
    this.feed = undefined;
    this.recapMetadata = undefined;
    this.legacySummary = null;
    this.director = undefined;
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
      this.feed = new GameFeed(this.store, this.selection.epoch, identity(this.catalogue, game), game, this.options);
      // G1 saved a verified summary without a move journal. Preserve its timestamped slate
      // at zero delay until the first full authority read can supply the actual board.
      if (!this.feed.delay) {
        const { sessePlayers, elapsedTime, ...oldBinding } = game.binding;
        const saved = this.store.loadSummary<{ identity: string; summary: RealProgramme["summary"] }>(this.selection.epoch, game.id);
        if (saved?.identity === identity(this.catalogue, { ...game, binding: oldBinding })) this.legacySummary = saved.summary;
      }
    }
    this.current = this.realSnapshot();
  }

  private realState(): RealProgramme["state"] {
    const game = this.game;
    if (!game) return "unselected";
    const released = this.feed?.released;
    const summary = released?.position?.summary ?? this.legacySummary;
    if (summary?.result) return "finished";
    if (summary?.plies) return "underway";
    if (summary && !released?.interrupted) return "waiting";
    if (this.feed?.delay && !summary && !released?.interrupted) return "buffering";
    if (game.scheduledStart && this.wallNow() - (this.feed?.delay ?? 0) >= Date.parse(game.scheduledStart)) return "unavailable";
    return "pending";
  }

  private currentRecap(): FinishedRecap | undefined {
    const feed = this.feed;
    const recap = feed?.recap;
    if (!recap) return;
    const game = this.game!;
    if (this.recapMetadata?.source !== recap) {
      const next = this.catalogue.games.find(round => round.order > game.order);
      const totals = new Map([[game.white.id, 0], [game.black.id, 0]]);
      const completedRounds = this.catalogue.games.filter(round => round.order <= game.order);
      let complete = completedRounds.length === game.order;
      for (const round of completedRounds) {
        const result = round.id === game.id ? feed.released.position?.summary.result
          : this.store.releasedFinal(identity(this.catalogue, round), recap.finishedAt, feed.delay);
        if (!result || !totals.has(round.white.id) || !totals.has(round.black.id)) {
          complete = false;
          break;
        }
        totals.set(round.white.id, totals.get(round.white.id)! + (result === "1-0" ? 1 : result === "1/2-1/2" ? .5 : 0));
        totals.set(round.black.id, totals.get(round.black.id)! + (result === "0-1" ? 1 : result === "1/2-1/2" ? .5 : 0));
      }
      this.recapMetadata = { source: recap,
        ...(complete && { matchScore: { white: totals.get(game.white.id)!, black: totals.get(game.black.id)! } }),
        ...(next?.scheduledStart && { next: { label: next.label, start: next.scheduledStart } }) };
    }
    const { matchScore, next } = this.recapMetadata;
    return { ...recap.at(this.wallNow()), matchScore, next };
  }

  private realSnapshot(recap = this.currentRecap()): RealProgramme {
    const game = this.game;
    return {
      mode: "REAL", streamId: this.streamId, sequence: ++this.sequence, selectionEpoch: this.selection.epoch,
      eventName: this.catalogue.eventName, timeZone: this.catalogue.timeZone,
      game: game ? { id: game.id, label: game.label, order: game.order, scheduledStart: game.scheduledStart,
        white: game.white, black: game.black } : null,
      state: this.realState(), ...this.feed?.released, recap, summary: this.feed?.released.position?.summary ?? this.legacySummary,
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
    } else if (this.current.mode === "REAL") {
      const feedChanged = this.feed?.tick();
      const recap = this.currentRecap(), previous = this.current.recap;
      if (feedChanged || this.current.state !== this.realState() ||
          recap?.page !== previous?.page || recap?.replay?.ply !== previous?.replay?.ply) {
        this.current = this.realSnapshot(recap);
      }
    }
    return this.current;
  }

  operator(): BroadcastOperator {
    const controls: SelectionControls = {
      catalogue: this.catalogue, selectionEpoch: this.selection.epoch,
      authorityStatus: this.feed?.status ?? (this.game ? "pending-binding" : "idle"),
      ...(this.feed && { feedHealth: { delayMs: this.feed.delay, lastRead: this.feed.lastRead, ...this.feed.sources } }),
      diagnostic: [this.catalogueWarning, this.feed?.diagnostic].filter(Boolean).join(" ") || null,
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
    this.feed?.stop();
    if (this.director) this.store.save(this.director.checkpoint());
  }
}
