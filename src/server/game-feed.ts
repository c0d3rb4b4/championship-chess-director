import type { CatalogueGame } from "../shared/catalogue.js";
import type { EngineId, LiveAnalysis, RealProgramme, SelectionControls } from "../shared/types.js";
import { AuthorityHttpError, BindingError, fetchGameRecord, fetchThinkTime, gamePosition, gameSummary } from "./game-summary.js";
import { followAnalysis, type SesseSession, type AnalysisTransport } from "./providers/live-analysis.js";
import type { AuthorityState, Store } from "./store.js";
import { Recap } from "./recap.js";

export interface FeedOptions extends AnalysisTransport {
  wallNow?: () => number;
  delayMs?: number;
  pollMs?: number;
  readAuthority?: typeof fetchGameRecord;
}

export class GameFeed {
  status: SelectionControls["authorityStatus"] = "loading";
  diagnostic: string | null = null;
  lastRead: string | null = null;
  readonly sources = { sesse: "Idle", leela: "Idle" };
  released: Pick<RealProgramme, "position" | "analysis" | "interrupted"> = {};
  recap?: Recap;
  rootAt = 0;
  moveAtMs?: number;
  facts?: Recap["facts"];
  private releasedRoot?: number;
  readonly delay: number;
  private readonly lifetime = new AbortController();
  private wire: SesseSession = {};
  private engines?: AbortController;
  private raw: ReturnType<Store["authorityAt"]>;
  private engineValues: Partial<Record<EngineId, LiveAnalysis>> = {};
  private releaseAt: number;
  private analysisRefreshAt = 0;
  private pollAt = 0;
  private failures = 0;
  private clockProbe?: { root: number; startedAt?: number };
  private readonly clock: () => number;

  constructor(private store: Store, private epoch: number, private identity: string, private game: CatalogueGame,
      private options: FeedOptions) {
    this.clock = options.wallNow ?? Date.now;
    this.delay = store.sessionDelay(epoch, options.delayMs ?? 0);
    this.raw = store.authorityAt(epoch, identity, Number.MAX_SAFE_INTEGER);
    this.releaseAt = 0;
    this.release(this.clock());
    this.tick();
  }

  private release(now: number) {
    const eligible = this.store.authorityAt(this.epoch, this.identity, now);
    const changedRoot = this.releasedRoot !== eligible?.id;
    if (changedRoot) {
      const position = eligible?.state.position;
      this.rootAt = eligible?.eligible ?? 0;
      this.moveAtMs = eligible?.state.moveAtMs;
      this.recap = undefined;
      this.facts = undefined;
      if (eligible && position?.moves.length && !position.summary.result) {
        this.facts = new Recap(this.game.id, position, eligible.eligible,
          this.store.recapJournal(this.epoch, this.identity, eligible.id, eligible.eligible)).facts;
      }
      if (eligible && position?.summary.result) {
        const finishedAt = eligible.state.finishedAt ?? this.store.finalRelease(this.epoch, this.identity, position) ?? eligible.eligible;
        this.recap = new Recap(this.game.id, position, finishedAt,
          this.store.recapJournal(this.epoch, this.identity, eligible.id, finishedAt));
      }
      this.releasedRoot = eligible?.id;
    }
    this.releaseAt = this.store.nextRelease(this.epoch, this.identity, now);
    let analysis = eligible ? this.store.analysisAt(eligible.id, now) : {};
    // Root changes, new sources and invalidations bypass value coalescing.
    const previous = this.released.analysis;
    if (!changedRoot && previous && Object.keys(previous).join() === Object.keys(analysis).join() && now < this.analysisRefreshAt) {
      analysis = previous;
      this.releaseAt = Math.min(this.releaseAt, this.analysisRefreshAt);
    } else if (Object.keys(analysis).length) this.analysisRefreshAt = now + 500;
    this.released = eligible ? {
      position: changedRoot ? eligible.state.position ?? undefined : this.released.position,
      interrupted: eligible.state.interrupted, analysis,
    } : {};

  }

  private accept(state: AuthorityState, raw: string, now: number, eligible: number) {
    const id = this.store.feedEvent(this.epoch, this.identity, "authority", null, now, eligible, raw, state);
    if (state.interrupted || this.raw?.state.position?.revision !== state.position?.revision) this.wire = {};
    this.raw = { id, state, eligible };
    this.engines?.abort();
    this.engines = undefined;
    this.engineValues = {};
    this.sources.sesse = this.sources.leela = "Idle";
    this.releaseAt = Math.min(this.releaseAt, eligible);
  }

  private engine(root: number, source: EngineId, value: LiveAnalysis | null, raw: unknown) {
    if (root !== this.raw?.id || this.lifetime.signal.aborted) return;
    this.sources[source] = value ? "Matched position" : typeof raw === "string" ? raw : "Awaiting matching analysis";
    const now = this.clock();
    const prior = this.engineValues[source];
    if (value?.work !== undefined) {
      const same = prior?.line[0] === value.line[0] && prior.progress && prior.work !== undefined && prior.work <= value.work;
      const advance = same && value.work > prior!.work!;
      const firstAt = same ? prior!.progress!.firstAt : now;
      const count = same ? prior!.progress!.count + Number(advance) : 1;
      value.progress = { firstAt, count, ready: count >= 3 && (advance ? now - firstAt >= 6000 : !!prior?.progress?.ready),
        delta: advance ? value.work - prior!.work! : same ? prior?.progress?.delta : undefined };
    }
    if (JSON.stringify(prior ?? null) === JSON.stringify(value)) return;
    const eligible = now + this.delay;
    this.store.feedEvent(this.epoch, this.identity, source, root, now, eligible, JSON.stringify(raw), value);
    if (value) this.engineValues[source] = value;
    else delete this.engineValues[source];
    this.releaseAt = Math.min(this.releaseAt, eligible);
  }

  get reading() { return this.pollAt === Infinity; }

  private async poll() {
    this.pollAt = Infinity;
    const signal = this.lifetime.signal;
    let retryAfter = 0;
    try {
      const { decoded, pgn } = await (this.options.readAuthority ?? fetchGameRecord)(this.game, signal, this.options.request);
      if (signal.aborted) return;
      const now = this.clock();
      const old = this.raw?.state.position;
      const summary = gameSummary(decoded);
      const sameMoves = old && JSON.stringify(old.moves) === JSON.stringify(decoded.moves);
      const sameResult = old?.summary.result === summary.result;
      const sameFacts = old?.opening === decoded.opening && JSON.stringify(old?.elapsed) === JSON.stringify(decoded.elapsed) &&
        JSON.stringify(old?.clocks) === JSON.stringify(decoded.anchors);
      // The optional round-clock request runs alongside PGN polling. Consume its
      // evidence only when another authority read confirms the very same mainline.
      const anchor = sameMoves && sameFacts && this.clockProbe?.root === this.raw?.id ? this.clockProbe?.startedAt : undefined;
      const thinkMs = anchor === undefined ? undefined : Math.max(0, now - anchor);
      if (!sameMoves || this.raw?.state.interrupted || !sameResult || !sameFacts || thinkMs !== undefined) {
        const correction = old && (!old.moves.every((san, i) => decoded.moves[i] === san) ||
          (old.summary.result !== null && (!sameResult || !sameMoves)));
        const position = gamePosition(this.game, decoded, now, (old?.revision ?? 1) + Number(Boolean(correction)));
        if (position.clocks) {
          const observedMove = old && position.moves.length === old.moves.length + 1;
          position.clockRunning = !summary.result && !correction && !this.raw?.state.interrupted &&
            (thinkMs !== undefined || !!observedMove || !!(sameMoves && old.clockRunning && sameFacts));
          if (position.clockRunning) position.clockStartedAt = thinkMs !== undefined ? now + this.delay - thinkMs :
            sameMoves ? old.clockStartedAt : now + this.delay;
        }
        let eligible = now + this.delay;
        if (!this.raw && summary.result && this.delay) {
          const cached = this.store.previousFinal(this.identity, this.epoch);
          if (cached && cached.eligible <= now && Date.parse(cached.position.summary.observedAt) + this.delay <= now &&
              cached.position.summary.result === summary.result && JSON.stringify(cached.position.moves) === JSON.stringify(decoded.moves))
            eligible = now;
        }
        const finishedAt = summary.result ? (sameMoves && sameResult
          ? this.raw?.state.finishedAt ?? this.store.finalRelease(this.epoch, this.identity, old) ?? eligible
          : eligible) : undefined;
        const advanced = old && !correction && !sameMoves && old.moves.length < position.moves.length;
        const moveAtMs = advanced ? eligible : sameMoves && !correction ? this.raw?.state.moveAtMs : undefined;
        this.accept({ position, interrupted: false, finishedAt, moveAtMs }, pgn, now, eligible);
      }
      this.lastRead = new Date(now).toISOString();
      this.status = "verified";
      this.diagnostic = null;
      this.failures = 0;
      if (!this.engines && decoded.moves.length && !summary.result) {
        this.sources.sesse = this.game.binding?.sessePlayers ? "Awaiting matching analysis" : "Round mapping unverified";
        this.sources.leela = "Awaiting matching analysis";
        this.engines = new AbortController();
        const root = this.raw!.id;
        // Previously persisted observations can be cleared by the first fresh response after restart.
        this.engineValues = this.store.analysisAt(root, Number.MAX_SAFE_INTEGER);
        followAnalysis(this.game, decoded, this.engines.signal, this.options,
          (source, value, raw) => this.engine(root, source, value, raw), this.wire);
      }
      const root = this.raw?.id, position = this.raw?.state.position;
      if (root !== undefined && position?.clocks && !position.clockRunning && !summary.result &&
          this.game.binding?.roundClock && this.engines && this.clockProbe?.root !== root) {
        const probe: NonNullable<GameFeed["clockProbe"]> = { root };
        this.clockProbe = probe;
        void fetchThinkTime(this.game, position, this.engines.signal, this.options.request).then(ms => {
          if (this.raw?.id !== root || this.clockProbe !== probe) return;
          if (ms === undefined) this.clockProbe = undefined;
          else probe.startedAt = this.clock() - ms;
        });
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AuthorityHttpError && error.status === 429) retryAfter = 60_000;
      this.status = error instanceof BindingError ? "mismatch" : "unavailable";
      this.diagnostic = error instanceof Error ? error.message : "Authority unavailable";
      this.failures = Math.min(5, this.failures + 1);
      if (!this.raw?.state.interrupted) {
        const now = this.clock();
        this.accept({ position: this.raw?.state.position ?? null, interrupted: true, finishedAt: this.raw?.state.finishedAt },
          this.diagnostic, now, now + this.delay);
      }
    } finally {
      this.pollAt = this.clock() + Math.max(retryAfter, Math.min(120_000, (this.options.pollMs ?? 15_000) * 2 ** this.failures));
    }
  }

  tick(): boolean {
    const now = this.clock();
    if (now >= this.pollAt) void this.poll().catch(error => {
      // A failed journal write cannot be projected. Keep the previous committed output and retry.
      this.status = "unavailable";
      this.diagnostic = String(error);
    });
    if (now < this.releaseAt) return false;
    this.release(now);
    return true;
  }

  stop() {
    this.lifetime.abort();
    this.engines?.abort();
  }
}
