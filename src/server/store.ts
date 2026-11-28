import { DatabaseSync } from "node:sqlite";
import type { DirectorState } from "./director.js";
import type { Command, EngineId, LiveAnalysis, ReleasedPosition } from "../shared/types.js";

export interface Selection {
  mode: "real" | "demo";
  gameId: string | null;
  epoch: number;
}

type SelectionOutcome = "applied" | "duplicate" | "conflict" | "stale";

export interface AuthorityState {
  position: ReleasedPosition | null;
  interrupted: boolean;
  finishedAt?: number;
}

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL");
      this.transaction(() => {
        const version = this.db.prepare("PRAGMA user_version").get()!.user_version;
        if (version === 3) return;
        if (version === 0) {
          // Version zero is either a fresh install or the original rehearsal-only database.
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS commands (
              id TEXT PRIMARY KEY, command TEXT NOT NULL, epoch INTEGER NOT NULL, applied_ms INTEGER NOT NULL
            );
            ALTER TABLE checkpoint RENAME TO demo_checkpoint;
            ALTER TABLE commands RENAME TO demo_commands;
            ALTER TABLE demo_commands ADD COLUMN selection_epoch INTEGER;
            CREATE TABLE catalogue (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
            CREATE TABLE active_selection (
              id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL CHECK (mode IN ('real','demo')),
              game_id TEXT, epoch INTEGER NOT NULL, summary TEXT,
              CHECK (mode = 'real' OR game_id IS NULL)
            );
            INSERT INTO active_selection (id, mode, epoch) VALUES (1, 'real', 0);
            CREATE TABLE selection_commands (
              id TEXT PRIMARY KEY, expected_epoch INTEGER NOT NULL, mode TEXT NOT NULL, game_id TEXT
            );
            PRAGMA user_version = 1;
          `);
        } else if (version !== 1 && version !== 2) throw new Error(`Unsupported database schema ${version}`);
        if (version < 2) this.db.exec(`
          CREATE TABLE feed_sessions (epoch INTEGER PRIMARY KEY, delay_ms INTEGER NOT NULL);
          CREATE TABLE feed_events (
            id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, identity TEXT NOT NULL, source TEXT NOT NULL,
            root INTEGER, received_ms INTEGER NOT NULL, eligible_ms INTEGER NOT NULL, raw TEXT, payload TEXT NOT NULL
          );
          CREATE INDEX feed_release ON feed_events(epoch, identity, eligible_ms, id);
          CREATE INDEX feed_root ON feed_events(root, eligible_ms);
          CREATE INDEX feed_archive ON feed_events(identity, source, id);
        `);
        this.db.exec(`
          CREATE TABLE schedule_updates (
            id INTEGER PRIMARY KEY, game TEXT NOT NULL, observed_ms INTEGER, start TEXT
          );
          CREATE INDEX schedule_game ON schedule_updates(game, id);
          PRAGMA user_version = 3;
        `);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveCatalogue<T>(catalogue: T, schedule?: { observedAt: number; games: { key: string; start: string | null }[] }): void {
    this.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO catalogue (id, payload) VALUES (1, ?)").run(JSON.stringify(catalogue));
      if (schedule) {
        const latest = this.db.prepare("SELECT start FROM schedule_updates WHERE game = ? ORDER BY id DESC LIMIT 1");
        const insert = this.db.prepare("INSERT INTO schedule_updates (game, observed_ms, start) VALUES (?, ?, ?)");
        for (const { key, start } of schedule.games) {
          const saved = latest.get(key);
          if (!saved || saved.start !== start) insert.run(key, saved ? schedule.observedAt : null, start);
        }
      }
    });
  }

  loadCatalogue<T>(): T | undefined {
    const row = this.db.prepare("SELECT payload FROM catalogue WHERE id = 1").get();
    return row ? JSON.parse(row.payload as string) as T : undefined;
  }

  scheduledStart(game: string, presentationTime: number): string | null {
    const row = this.db.prepare(`SELECT start FROM schedule_updates WHERE game = ?
      AND (observed_ms IS NULL OR observed_ms <= ?) ORDER BY id DESC LIMIT 1`).get(game, presentationTime);
    return typeof row?.start === "string" ? row.start : null;
  }

  loadSelection(): Selection {
    const row = this.db.prepare("SELECT mode, game_id, epoch FROM active_selection WHERE id = 1").get()!;
    return { mode: row.mode as Selection["mode"], gameId: row.game_id as string | null, epoch: Number(row.epoch) };
  }

  selectGame(id: string, expectedEpoch: number, mode: Selection["mode"], gameId: string | null): SelectionOutcome {
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT expected_epoch, mode, game_id FROM selection_commands WHERE id = ?").get(id);
      if (prior) {
        return prior.expected_epoch === expectedEpoch && prior.mode === mode && prior.game_id === gameId
          ? "duplicate" : "conflict";
      }
      if (this.db.prepare("SELECT 1 FROM demo_commands WHERE id = ?").get(id)) return "conflict";
      // Changing the target and invalidating its old summary must be one durable operation.
      const changed = this.db.prepare(`
        UPDATE active_selection SET mode = ?, game_id = ?, epoch = epoch + 1, summary = NULL
        WHERE id = 1 AND epoch = ?
      `).run(mode, gameId, expectedEpoch);
      if (!changed.changes) return "stale";
      this.db.prepare("INSERT INTO selection_commands (id, expected_epoch, mode, game_id) VALUES (?, ?, ?, ?)").run(
        id, expectedEpoch, mode, gameId,
      );
      return "applied";
    });
  }

  saveSummary<T>(epoch: number, gameId: string, summary: T): boolean {
    const result = this.db.prepare(`
      UPDATE active_selection SET summary = ? WHERE id = 1 AND mode = 'real' AND epoch = ? AND game_id = ?
    `).run(JSON.stringify(summary), epoch, gameId);
    return result.changes === 1;
  }

  loadSummary<T>(epoch: number, gameId: string): T | undefined {
    const row = this.db.prepare(`
      SELECT summary FROM active_selection WHERE id = 1 AND mode = 'real' AND epoch = ? AND game_id = ?
    `).get(epoch, gameId);
    return typeof row?.summary === "string" ? JSON.parse(row.summary) as T : undefined;
  }

  sessionDelay(epoch: number, configured: number): number {
    this.db.prepare("INSERT OR IGNORE INTO feed_sessions VALUES (?, ?)").run(epoch, configured);
    return Number(this.db.prepare("SELECT delay_ms FROM feed_sessions WHERE epoch = ?").get(epoch)!.delay_ms);
  }

  feedEvent(epoch: number, identity: string, source: "authority" | "archive" | EngineId, root: number | null,
      received: number, eligible: number, raw: string | null, payload: AuthorityState | LiveAnalysis | null) {
    return Number(this.db.prepare(`INSERT INTO feed_events
      (epoch, identity, source, root, received_ms, eligible_ms, raw, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(epoch, identity, source, root, received, eligible, raw, JSON.stringify(payload)).lastInsertRowid);
  }

  authorityAt(epoch: number, identity: string, cutoff: number) {
    const row = this.db.prepare(`SELECT id, eligible_ms, payload FROM feed_events WHERE epoch = ? AND identity = ?
      AND source = 'authority' AND eligible_ms <= ? ORDER BY id DESC LIMIT 1`).get(epoch, identity, cutoff);
    return row && { id: Number(row.id), eligible: Number(row.eligible_ms), state: JSON.parse(String(row.payload)) as AuthorityState };
  }

  archiveAt(identity: string, now: number, delay: number, beforeEpoch = Number.MAX_SAFE_INTEGER) {
    const row = this.db.prepare(`SELECT id, received_ms, eligible_ms, payload FROM feed_events WHERE identity = ?
      AND source IN ('authority', 'archive') AND epoch < ? AND received_ms <= ? AND eligible_ms <= ?
      AND json_extract(payload, '$.interrupted') = 0
      ORDER BY id DESC LIMIT 1`).get(identity, beforeEpoch, now - delay, now);
    return row && { id: Number(row.id), eligible: Math.max(Number(row.eligible_ms), Number(row.received_ms) + delay),
      ...JSON.parse(String(row.payload)) as AuthorityState };
  }

  releasedFinal(identity: string, now: number, delay: number) {
    return this.archiveAt(identity, now, delay)?.position?.summary.result;
  }

  finalRelease(epoch: number, identity: string, position: ReleasedPosition): number | undefined {
    // Older journals have no finishedAt. Find the earliest release of this
    // exact result and revision, including when the archive bypassed its delay.
    const row = this.db.prepare(`SELECT MIN(eligible_ms) AS due FROM feed_events
      WHERE epoch = ? AND identity = ? AND source = 'authority'
      AND json_extract(payload, '$.position.revision') = ?
      AND json_extract(payload, '$.position.summary.result') = ?
      AND json_extract(payload, '$.position.moves') = ?`).get(epoch, identity, position.revision,
      position.summary.result, JSON.stringify(position.moves));
    return row?.due == null ? undefined : Number(row.due);
  }

  recapJournal(epoch: number, identity: string, finalId: number, finishedAt: number) {
    const roots = this.db.prepare(`SELECT id, payload FROM feed_events WHERE epoch = ? AND identity = ?
      AND source = 'authority' AND id <= ? AND eligible_ms <= ? ORDER BY id DESC`)
      .all(epoch, identity, finalId, finishedAt).map(row => ({ id: Number(row.id),
        ...JSON.parse(String(row.payload)) as AuthorityState }));
    const samples = this.db.prepare(`SELECT e.root, e.source, e.payload FROM feed_events e JOIN feed_events a ON a.id = e.root
      WHERE a.epoch = ? AND a.identity = ? AND a.id <= ? AND e.eligible_ms <= ? AND e.payload != 'null'
      AND e.eligible_ms < COALESCE((SELECT eligible_ms FROM feed_events n WHERE n.epoch = a.epoch
        AND n.identity = a.identity AND n.source = 'authority' AND n.id > a.id ORDER BY n.id LIMIT 1), ?)
      ORDER BY e.id DESC`).all(epoch, identity, finalId, finishedAt, finishedAt + 1).map(row => ({
        root: Number(row.root), source: row.source as EngineId, analysis: JSON.parse(String(row.payload)) as LiveAnalysis,
      }));
    return { roots, samples };
  }

  previousFinal(identity: string, epoch: number) {
    const record = this.archiveAt(identity, Number.MAX_SAFE_INTEGER, 0, epoch);
    if (record?.position?.summary.result) return { position: record.position, eligible: record.eligible };
  }

  analysisAt(root: number, cutoff: number) {
    const rows = this.db.prepare(`SELECT source, payload, MAX(id) FROM feed_events
      WHERE root = ? AND eligible_ms <= ? GROUP BY source`).all(root, cutoff);
    return Object.fromEntries(rows.filter(row => row.payload !== "null").map(row =>
      [row.source, JSON.parse(String(row.payload)) as LiveAnalysis]));
  }

  nextRelease(epoch: number, identity: string, after: number) {
    const row = this.db.prepare(`SELECT MIN(eligible_ms) AS due FROM feed_events
      WHERE epoch = ? AND identity = ? AND eligible_ms > ?`).get(epoch, identity, after);
    return row?.due == null ? Infinity : Number(row.due);
  }

  load(): DirectorState | undefined {
    const row = this.db
      .prepare("SELECT payload FROM demo_checkpoint WHERE id = 1")
      .get();
    return row
      ? (JSON.parse(row.payload as string) as DirectorState)
      : undefined;
  }
  save(state: DirectorState): void {
    this.db
      .prepare("INSERT OR REPLACE INTO demo_checkpoint (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(state));
  }
  getCommand(id: string): { command: string; epoch: number; selectionEpoch?: number } | undefined {
    const row = this.db.prepare("SELECT command, epoch, selection_epoch FROM demo_commands WHERE id = ?").get(id);
    if (row) return {
      command: String(row.command),
      epoch: Number(row.epoch),
      selectionEpoch: row.selection_epoch === null ? undefined : Number(row.selection_epoch),
    };
    const selection = this.db.prepare("SELECT expected_epoch FROM selection_commands WHERE id = ?").get(id);
    return selection ? { command: "select", epoch: Number(selection.expected_epoch) } : undefined;
  }
  commitCommand(
    id: string,
    command: Command,
    epoch: number,
    state: DirectorState,
    selectionEpoch?: number,
  ): void {
    this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM selection_commands WHERE id = ?").get(id)) {
        throw new Error("Command ID already used for a selection");
      }
      if (selectionEpoch !== undefined) {
        const active = this.loadSelection();
        if (active.mode !== "demo" || active.epoch !== selectionEpoch) throw new Error("Stale rehearsal command");
      }
      this.db
        .prepare(
          "INSERT INTO demo_commands (id, command, epoch, applied_ms, selection_epoch) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, command, epoch, state.elapsedMs, selectionEpoch ?? null);
      this.save(state);
    });
  }
  get count(): number {
    return Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM demo_commands").get()!.n,
    );
  }
  close(): void {
    this.db.close();
  }
}
