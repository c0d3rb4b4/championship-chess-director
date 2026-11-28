import type { CatalogueGame } from "../shared/catalogue.js";
import type { EngineId, LiveAnalysis, RealProgramme, SelectionControls } from "../shared/types.js";
import { boardFrame, replay } from "./fixtures.js";
import { AuthorityHttpError, BindingError, fetchGameRecord, gameSummary } from "./game-summary.js";
import { followAnalysis, type AnalysisTransport } from "./providers/live-analysis.js";
import type { AuthorityState, Store } from "./store.js";

export interface FeedOptions extends AnalysisTransport {
  wallNow?: () => number;
  delayMs?: number;
  pollMs?: number;
}

export class GameFeed {
  status: SelectionControls["authorityStatus"] = "loading";
  diagnostic: string | null = null;
  lastRead: string | null = null;
  readonly sources = { sesse: "Idle", leela: "Idle" };
  released: Pick<RealProgramme, "position" | "analysis" | "interrupted"> = {};
  readonly delay: number;
  private readonly lifetime = new AbortController();
  private engines?: AbortController;
  private raw: ReturnType<Store["authorityAt"]>;
  private engineValues: Partial<Record<EngineId, LiveAnalysis>> = {};
  private releaseAt: number;
  private pollAt = 0;
  private failures = 0;
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
    this.released = eligible ? {
      position: eligible.state.position ?? undefined,
      interrupted: eligible.state.interrupted,
      analysis: this.store.analysisAt(eligible.id, now),
    } : {};
    this.releaseAt = this.store.nextRelease(this.epoch, this.identity, now);
  }

  private accept(state: AuthorityState, raw: string, now: number, eligible: number) {
    const id = this.store.feedEvent(this.epoch, this.identity, "authority", null, now, eligible, raw, state);
    this.raw = { id, state };
    this.engines?.abort();
    this.engines = undefined;
    this.engineValues = {};
    this.sources.sesse = this.sources.leela = "Idle";
    this.releaseAt = Math.min(this.releaseAt, eligible);
  }

  private engine(root: number, source: EngineId, value: LiveAnalysis | null, raw: unknown) {
    if (root !== this.raw?.id || this.lifetime.signal.aborted) return;
    this.sources[source] = value ? "Matched position" : typeof raw === "string" ? raw : "Awaiting matching analysis";
    if (JSON.stringify(this.engineValues[source] ?? null) === JSON.stringify(value)) return;
    const now = this.clock();
    const eligible = now + this.delay;
    this.store.feedEvent(this.epoch, this.identity, source, root, now, eligible, JSON.stringify(raw), value);
    if (value) this.engineValues[source] = value;
    else delete this.engineValues[source];
    this.releaseAt = Math.min(this.releaseAt, eligible);
  }

  private async poll() {
    this.pollAt = Infinity;
    const signal = this.lifetime.signal;
    let retryAfter = 0;
    try {
      const { decoded, pgn } = await fetchGameRecord(this.game, signal, this.options.request);
      if (signal.aborted) return;
      const now = this.clock();
      const old = this.raw?.state.position;
      const summary = gameSummary(decoded);
      const sameMoves = old && JSON.stringify(old.moves) === JSON.stringify(decoded.moves);
      if (!sameMoves || this.raw?.state.interrupted || old.summary.result !== summary.result) {
        const correction = old && (!old.moves.every((san, i) => decoded.moves[i] === san) ||
          (old.summary.result !== null && old.summary.result !== summary.result));
        const actual = boardFrame(replay(decoded.moves, this.game.startFen));
        const position = { actual, moves: decoded.moves, startFen: this.game.startFen,
          revision: (old?.revision ?? 1) + Number(Boolean(correction)),
          summary: { ...summary, observedAt: new Date(now).toISOString() } };
        let eligible = now + this.delay;
        if (!this.raw && summary.result && this.delay) {
          const cached = this.store.previousFinal(this.identity, this.epoch);
          if (cached && cached.eligible <= now && Date.parse(cached.position.summary.observedAt) + this.delay <= now &&
              cached.position.summary.result === summary.result && JSON.stringify(cached.position.moves) === JSON.stringify(decoded.moves))
            eligible = now;
        }
        this.accept({ position, interrupted: false }, pgn, now, eligible);
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
          (source, value, raw) => this.engine(root, source, value, raw));
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AuthorityHttpError && error.status === 429) retryAfter = 60_000;
      this.status = error instanceof BindingError ? "mismatch" : "unavailable";
      this.diagnostic = error instanceof Error ? error.message : "Authority unavailable";
      this.failures = Math.min(5, this.failures + 1);
      if (!this.raw?.state.interrupted) {
        const now = this.clock();
        this.accept({ position: this.raw?.state.position ?? null, interrupted: true }, this.diagnostic, now, now + this.delay);
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
