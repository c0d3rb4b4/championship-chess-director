import { randomUUID } from "node:crypto";
import type { BroadcastOperator, BroadcastSnapshot, Command, FinishedRecap, RealProgramme, SelectionControls, WaitingProgramme } from "../shared/types.js";
import type { Catalogue, CatalogueGame } from "../shared/catalogue.js";
import { loadCatalogue, parseCatalogue } from "./catalogue.js";
import { GameFeed, type FeedOptions } from "./game-feed.js";
import { LiveDirector, validateProfile } from "./live-director.js";
import { Director } from "./director.js";
import { PreviousGame, programmeGame, serialAuthority } from "./previous-game.js";
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

// Adding a newly verified optional field keeps the accepted chapter and authority journal.
function compatibleIdentity(previous: string, next: string) {
  try {
    const a = JSON.parse(previous), b = JSON.parse(next);
    const oldBinding = a.pop(), newBinding = b.pop();
    return JSON.stringify(a) === JSON.stringify(b) && oldBinding && newBinding &&
      Object.keys(oldBinding).every(k => JSON.stringify(oldBinding[k]) === JSON.stringify(newBinding[k]));
  } catch { return false; }
}

/** One shared selection and one authority session per take, independent of SSE subscriber count. */
export class Broadcast {
  private catalogue: Catalogue;
  private catalogueWarning: string | null;
  private scheduleCheckAt = 0;
  private selection: Selection;
  private feed?: GameFeed;
  private previousGame?: PreviousGame;
  private makePreviousGame?: () => PreviousGame;
  private delay = 0;
  private recapMetadata?: { source: Recap; matchScore?: FinishedRecap["matchScore"]; next?: FinishedRecap["next"] };
  private legacySummary: RealProgramme["summary"] = null;
  private sequence = 0;
  private readonly streamId = randomUUID();
  private director?: Director;
  private live?: LiveDirector;
  private directionKey = "";
  private lastSave = 0;
  private compactAt = 0;
  private controlWarning: string | null = null;
  private baseMs = 0;
  private anchor = 0;
  private persistedSecond = -1;
  current!: BroadcastSnapshot;

  constructor(private readonly store: Store, private readonly options: BroadcastOptions, private readonly publish: () => void) {
    if (!Number.isSafeInteger(options.delayMs ?? 0) || (options.delayMs ?? 0) < 0) throw Error("Invalid programme delay");
    if (!options.wallNow) {
      const wall = Date.now(), mono = performance.now();
      this.options = { ...options, wallNow: () => wall + Math.floor(performance.now() - mono) };
    }
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
    this.saveCatalogue(catalogue, this.wallNow());
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

  private scheduleKey(game: CatalogueGame) {
    return JSON.stringify([this.catalogue.eventId, game.id, game.order, game.white.id, game.black.id]);
  }

  private saveCatalogue(catalogue: Catalogue, now: number) {
    this.store.saveCatalogue(catalogue, {
      observedAt: now, games: catalogue.games.map(game => ({ key: this.scheduleKey(game), start: game.scheduledStart })),
    });
    this.scheduleCheckAt = now + 1000;
  }

  private refreshSchedule(now: number) {
    if (now < this.scheduleCheckAt) return;
    this.scheduleCheckAt = now + 1000;
    try {
      const updated = loadCatalogue(this.options.cataloguePath);
      if (updated.eventId !== this.catalogue.eventId) throw Error("A different event requires a restart");
      // Active identities and bindings are pinned. Only the verified schedule is hot-reloaded.
      const starts = new Map(updated.games.map(game => [game.id, game]));
      const games = this.catalogue.games.map(game => {
        const configured = starts.get(game.id);
        return configured && configured.order === game.order &&
          configured.white.id === game.white.id && configured.black.id === game.black.id
          ? { ...game, scheduledStart: configured.scheduledStart } : game;
      });
      if (games.some((game, index) => game.scheduledStart !== this.catalogue.games[index].scheduledStart)) {
        const catalogue = { ...this.catalogue, scheduleSource: updated.scheduleSource, games };
        this.saveCatalogue(catalogue, now);
        this.catalogue = catalogue;
      }
      this.catalogueWarning = null;
    } catch (error) {
      this.catalogueWarning = "Using the last validated schedule. " + (error instanceof Error ? error.message : "Configuration unavailable");
    }
  }

  private activate() {
    this.feed?.stop();
    this.feed = undefined;
    this.previousGame?.stop();
    this.previousGame = undefined;
    this.makePreviousGame = undefined;
    this.recapMetadata = undefined;
    this.legacySummary = null;
    this.director = undefined;
    this.live = undefined;
    this.directionKey = "";
    this.controlWarning = null;
    if (this.selection.mode === "demo") {
      this.director = new Director(this.store.load());
      this.baseMs = this.director.checkpoint().elapsedMs;
      this.anchor = this.now();
      this.persistedSecond = -1;
      this.current = { ...this.director.snapshot(), streamId: this.streamId, selectionEpoch: this.selection.epoch, sequence: ++this.sequence };
      return;
    }
    const game = this.game;
    const readAuthority = serialAuthority(() => this.wallNow());
    this.delay = game ? this.store.sessionDelay(this.selection.epoch, this.options.delayMs ?? 0) : 0;
    if (game) {
      const now = this.wallNow();
      const saved = this.store.direction(this.selection.epoch);
      if (saved && this.delay && (!this.store.journalIntact(this.selection.epoch) || now - saved.seen > (this.options.pollMs ?? 15000) + 2000)) {
        // No producer process observed this interval. Rebind before releasing any of it.
        this.store.withTransaction(() => this.store.refill(this.selection.epoch, this.delay, saved.state, now));
        this.selection = this.store.loadSelection();
      }
      const persisted = this.store.direction(this.selection.epoch)?.state;
      const profile = this.store.profile();
      this.live = new LiveDirector(this.selection.epoch, game.id, persisted ?? (profile ? { profile } : undefined));
    }
    if (game?.binding) {
      const key = identity(this.catalogue, game);
      const prior = this.store.latestIdentity(this.selection.epoch);
      if (prior && prior !== key && compatibleIdentity(prior, key)) this.store.adoptIdentity(this.selection.epoch, prior, key);
      this.feed = new GameFeed(this.store, this.selection.epoch, key, game, { ...this.options, readAuthority });
      // G1 saved a verified summary without a move journal. Preserve its timestamped slate
      // at zero delay until the first full authority read can supply the actual board.
      if (!this.feed.delay) {
        const saved = this.store.loadSummary<{ identity: string; summary: RealProgramme["summary"] }>(this.selection.epoch, game.id);
        if (saved && compatibleIdentity(saved.identity, key)) this.legacySummary = saved.summary;
      }
    }
    if (game) {
      const candidates = this.catalogue.games.filter(round => round.order < game.order && round.binding).reverse()
        .map(round => ({ game: round, identity: identity(this.catalogue, round) }));
      if (candidates.length)
        this.makePreviousGame = () => new PreviousGame(this.store, this.selection.epoch, this.delay, candidates,
          () => this.wallNow(), readAuthority, this.options.request);
    }
    this.current = this.realSnapshot(this.wallNow());
  }

  private realState(game: RealProgramme["game"], presentationTime: number): RealProgramme["state"] {
    if (!game) return "unselected";
    const released = this.feed?.released;
    const summary = released?.position?.summary ?? this.legacySummary;
    if (summary?.result) return "finished";
    if (summary?.plies) return "underway";
    if (summary && !released?.interrupted) return "waiting";
    if (this.feed?.delay && !summary && !released?.interrupted) return "buffering";
    if (game.scheduledStart && presentationTime >= Date.parse(game.scheduledStart)) return "unavailable";
    return "pending";
  }

  private currentRecap(now: number): FinishedRecap | undefined {
    const feed = this.feed;
    const recap = feed?.recap;
    if (!recap) return;
    const game = this.game!;
    if (this.recapMetadata?.source !== recap) {
      const next = this.catalogue.games.find(round => round.order > game.order);
      const start = next && this.store.scheduledStart(this.scheduleKey(next), recap.finishedAt - this.delay);
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
        ...(next && start && { next: { label: next.label, start } }) };
    }
    const { matchScore, next } = this.recapMetadata;
    return { ...recap.at(now), matchScore, next };
  }

  private realSnapshot(now: number, previous?: RealProgramme, feedChanged = false): RealProgramme {
    const presentationTime = now - this.delay;
    const selected = this.game;
    const game = selected ? programmeGame(selected, this.store.scheduledStart(this.scheduleKey(selected), presentationTime)) : null;
    const state = this.realState(game, presentationTime);
    const summary = this.feed?.released.position?.summary ?? this.legacySummary;
    const director = this.live;
    let live = this.feed && director?.at(this.feed, now);
    if (director) {
      for (const row of this.store.dueControls(this.selection.epoch, now)) {
        const { command, value } = JSON.parse(String(row.request));
        this.store.withTransaction(() => {
          try {
            if ((row.root && row.root !== live?.rootKey) || director.state.held) throw Error("Superseded before release");
            director.control(command, now, value);
            live = this.feed && director.at(this.feed, now);
            if (command === "profile") this.store.saveProfile(director.state.profile);
            this.store.finishControl(String(row.id), "applied");
          } catch (error) {
            this.controlWarning = String(error);
            this.store.finishControl(String(row.id), this.controlWarning);
          }
          this.store.saveDirection(this.selection.epoch, director.state, now);
        });
      }
      const key = JSON.stringify(director.state);
      if (key !== this.directionKey || now - this.lastSave >= 1000) {
        this.store.saveDirection(this.selection.epoch, director.state, now);
        this.directionKey = key; this.lastSave = now;
      }
      if (director.state.held) {
        if (previous?.state === "hold") return previous;
        return { mode: "REAL", streamId: this.streamId, sequence: ++this.sequence, selectionEpoch: this.selection.epoch,
          eventName: this.catalogue.eventName, timeZone: this.catalogue.timeZone, game, state: "hold", summary: null };
      }
    }
    const recap = this.currentRecap(now);
    let waiting: WaitingProgramme | undefined;
    if (game && state !== "underway" && state !== "finished") {
      const remainingSeconds = game.scheduledStart === null ? null
        : Math.max(0, Math.ceil((Date.parse(game.scheduledStart) - presentationTime) / 1000));
      this.previousGame ??= this.makePreviousGame?.();
      const archiveReady = !this.feed || !this.feed.reading;
      const previous = this.previousGame?.at(now, archiveReady);
      if (state !== "buffering") waiting = { remainingSeconds, previous };
    } else {
      // The first released move or result already won this tick. Cancel archive lookups
      // and never emit a superseded replay frame beside the new actual board.
      this.previousGame?.stop();
      this.previousGame = undefined;
    }
    const oldArchive = previous?.waiting?.previous, archive = waiting?.previous;
    if (previous && !feedChanged && previous.live?.scene.instance === live?.scene.instance &&
        previous.live?.scene.frameIndex === live?.scene.frameIndex &&
        Math.ceil((previous.live?.clocks?.whiteMs ?? 0)/1000) === Math.ceil((live?.clocks?.whiteMs ?? 0)/1000) &&
        Math.ceil((previous.live?.clocks?.blackMs ?? 0)/1000) === Math.ceil((live?.clocks?.blackMs ?? 0)/1000) && previous.state === state && previous.game?.scheduledStart === game?.scheduledStart &&
        previous.timeZone === this.catalogue.timeZone && previous.recap?.page === recap?.page &&
        previous.recap?.replay?.ply === recap?.replay?.ply && previous.waiting?.remainingSeconds === waiting?.remainingSeconds &&
        oldArchive?.game.id === archive?.game.id && oldArchive?.result === archive?.result &&
        oldArchive?.replay?.ply === archive?.replay?.ply && oldArchive?.replay?.frame.fen === archive?.replay?.frame.fen)
      return previous;
    return {
      mode: "REAL", streamId: this.streamId, sequence: ++this.sequence, selectionEpoch: this.selection.epoch,
      eventName: this.catalogue.eventName, timeZone: this.catalogue.timeZone, game,
      state, ...this.feed?.released, live, recap, waiting, summary,
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
      const now = this.wallNow();
      if (now >= this.compactAt) {
        this.store.compact(now);
        this.compactAt = now + 60000;
      }
      this.refreshSchedule(now);
      const feedChanged = this.feed?.tick();
      this.current = this.realSnapshot(now, this.current, feedChanged);
    }
    return this.current;
  }

  operator(): BroadcastOperator {
    const controls: SelectionControls = {
      catalogue: this.catalogue, selectionEpoch: this.selection.epoch,
      authorityStatus: this.feed?.status ?? (this.game ? "pending-binding" : "idle"),
      ...(this.feed && { feedHealth: { delayMs: this.feed.delay, lastRead: this.feed.lastRead, ...this.feed.sources } }),
      ...(this.live && { direction: { profile: this.live.state.profile, held: this.live.state.held,
        automatic: this.live.state.automatic, pinned: this.live.state.pinned } }),
      diagnostic: [this.controlWarning, this.catalogueWarning, this.feed?.diagnostic, this.previousGame?.diagnostic].filter(Boolean).join(" ") || null,
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

  control(id: string, epoch: number, command: string, value: unknown, expectedRoot?: string) {
    const request = JSON.stringify({ command, value, expectedRoot });
    const prior = this.store.directionCommand(id);
    if (prior && prior.epoch === epoch && prior.request === request) return true;
    if (this.store.getCommand(id)) throw new CommandError(409, "Command ID already used");
    const director = this.live;
    if (!director || epoch !== this.selection.epoch || this.current.mode !== "REAL") throw new CommandError(409, "Selection changed");
    const now = this.wallNow(), root = this.current.live?.rootKey;
    const scoped = ["next","pin","feature","actual","pause-auto"].includes(command);
    if (scoped && (!root || expectedRoot !== root)) throw new CommandError(409, "Released position changed");
    if (command === "profile") {
      try { validateProfile(value); } catch (e) { throw new CommandError(400, String(e)); }
    }
    if (command === "delay" && (!director.state.held || typeof value !== "number" || !Number.isSafeInteger(value) ||
        value < 0 || value > 3600000)) throw new CommandError(409, "Change delay under HOLD, from 0 to 3600 seconds");
    if (command === "feature" && !director.featureEligible) throw new CommandError(409, "No eligible variation");
    if (command === "pin" && !director.panelEligible(value)) throw new CommandError(409, "Panel unavailable");
    this.store.withTransaction(() => {
      const immediate = ["hold","resume","delay"].includes(command);
      this.store.queueControl(id, epoch, request, immediate ? now : now + this.delay, scoped ? root! : null);
      if (immediate) {
        if (command === "delay") this.store.refill(epoch, Number(value), director.state, now);
        else {
          director.control(command, now);
          this.store.saveDirection(epoch, director.state, now);
        }
        this.store.finishControl(id, "applied");
      }
    });
    if (command === "delay") { this.selection = this.store.loadSelection(); this.activate(); }
    else this.tick();
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
    if (this.live) this.store.saveDirection(this.selection.epoch, this.live.state, this.wallNow());
    this.feed?.stop();
    this.previousGame?.stop();
    if (this.director) this.store.save(this.director.checkpoint());
  }
}
