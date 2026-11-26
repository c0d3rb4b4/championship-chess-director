import { DatabaseSync } from "node:sqlite";
import type { DirectorState } from "./director.js";
import type { Command } from "../shared/types.js";

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY, command TEXT NOT NULL, epoch INTEGER NOT NULL, applied_ms INTEGER NOT NULL
      );
    `);
  }
  load(): DirectorState | undefined {
    const row = this.db
      .prepare("SELECT payload FROM checkpoint WHERE id = 1")
      .get();
    return row
      ? (JSON.parse(row.payload as string) as DirectorState)
      : undefined;
  }
  save(state: DirectorState): void {
    this.db
      .prepare("INSERT OR REPLACE INTO checkpoint (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(state));
  }
  getCommand(id: string): { command: string; epoch: number } | undefined {
    return this.db
      .prepare("SELECT command, epoch FROM commands WHERE id = ?")
      .get(id) as { command: string; epoch: number } | undefined;
  }
  commitCommand(
    id: string,
    command: Command,
    epoch: number,
    state: DirectorState,
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO commands (id, command, epoch, applied_ms) VALUES (?, ?, ?, ?)",
        )
        .run(id, command, epoch, state.elapsedMs);
      this.save(state);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  get count(): number {
    return Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM commands").get()!.n,
    );
  }
  close(): void {
    this.db.close();
  }
}
