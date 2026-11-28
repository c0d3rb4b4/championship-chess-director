import type { CatalogueGame } from "../shared/catalogue.js";
import type { WaitingProgramme } from "../shared/types.js";
import { AuthorityHttpError, fetchGameRecord, gamePosition } from "./game-summary.js";
import { GameReplay } from "./recap.js";
import type { Store } from "./store.js";

export function programmeGame({ id, label, order, white, black }: CatalogueGame, scheduledStart: string | null) {
  return { id, label, order, white, black, scheduledStart };
}

/** Serial authority reads within a take. The archived round uses a shorter deadline between live polls. */
export function serialAuthority(wallNow: () => number) {
  let last: Promise<unknown> = Promise.resolve();
  let rateLimitedUntil = 0;
  const read: typeof fetchGameRecord = (game, signal, request) => {
    const next = last.then(async () => {
      signal.throwIfAborted();
      if (wallNow() < rateLimitedUntil) throw new AuthorityHttpError(429);
      try {
        return await fetchGameRecord(game, signal, request);
      } catch (error) {
        if (error instanceof AuthorityHttpError && error.status === 429)
          rateLimitedUntil = wallNow() + 60_000;
        throw error;
      }
    });
    last = next.catch(() => {});
    return next;
  };
  return read;
}

export class PreviousGame {
  private readonly lifetime = new AbortController();
  private readonly candidates: { game: CatalogueGame; identity: string; checkAt: number }[];
  private cache?: { id: number; replay: GameReplay };
  private reading = false;
  private retryAt = 0;
  private scanUntil: number;
  diagnostic: string | null = null;

  constructor(private readonly store: Store, private readonly epoch: number, private readonly delay: number,
      candidates: { game: CatalogueGame; identity: string }[], private readonly wallNow: () => number,
      private readonly readAuthority: typeof fetchGameRecord, private readonly request?: typeof fetch) {
    this.candidates = candidates.map(candidate => ({ ...candidate, checkAt: 0 }));
    this.scanUntil = candidates.length;
  }

  private async load(now: number) {
    if (this.reading || now < this.retryAt) return;
    const index = this.candidates.findIndex((candidate, index) => index < this.scanUntil && now >= candidate.checkAt);
    if (index < 0) return;
    const next = this.candidates[index];
    const { game, identity } = next;
    next.checkAt = now + 60_000;
    this.reading = true;
    const signal = this.lifetime.signal;
    try {
      if (this.store.previousFinal(identity, this.epoch + 1)) {
        this.scanUntil = index;
        return;
      }
      const { decoded, pgn } = await this.readAuthority(game, AbortSignal.any([signal, AbortSignal.timeout(5_000)]), this.request);
      if (signal.aborted) return;
      this.diagnostic = null;
      if (!decoded.result) return;
      const received = this.wallNow();
      const position = gamePosition(game, decoded, received);
      this.store.feedEvent(this.epoch, identity, "archive", null, received, received + this.delay, pgn,
        { position, interrupted: false });
      this.scanUntil = index;
    } catch (error) {
      if (signal.aborted) return;
      this.diagnostic = `${game.label} archive · ${error instanceof Error ? error.message : "Authority unavailable"}`;
      if (error instanceof AuthorityHttpError && error.status === 429) this.retryAt = this.wallNow() + 60_000;
    } finally {
      this.reading = false;
    }
  }

  at(now: number, allowRead: boolean): WaitingProgramme["previous"] {
    if (allowRead) void this.load(now);
    for (const { game, identity } of this.candidates) {
      const record = this.store.archiveAt(identity, now, this.delay);
      const result = record?.position?.summary.result;
      if (!record?.position || !result) continue;
      const detail = { game: programmeGame(game, null), result };
      if (!record.position.moves.length) return detail;
      if (this.cache?.id !== record.id)
        this.cache = { id: record.id, replay: new GameReplay(game.id, record.position) };
      const { replay } = this.cache;
      return { ...detail, replay: replay.at((now - record.eligible) % replay.durationMs) };
    }
  }

  stop() { this.lifetime.abort(); }
}
