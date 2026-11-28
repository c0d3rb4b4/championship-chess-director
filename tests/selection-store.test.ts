import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Store } from "../src/server/store.js";

test("a legacy rehearsal checkpoint and command migrate without selecting a real game", () => {
  const dir = mkdtempSync(join(tmpdir(), "chess-migration-"));
  const path = join(dir, "broadcast.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
      CREATE TABLE commands (id TEXT PRIMARY KEY, command TEXT NOT NULL, epoch INTEGER NOT NULL, applied_ms INTEGER NOT NULL);
      INSERT INTO checkpoint VALUES (1, '{"elapsedMs":5200}');
      INSERT INTO commands VALUES ('cue-1', 'cue-spotlight', 1, 5000);
    `);
    legacy.close();
    const store = new Store(path);
    try {
      assert.deepEqual(store.loadSelection(), { mode: "real", gameId: null, epoch: 0 });
      assert.equal(store.load()!.elapsedMs, 5200);
      assert.equal(store.getCommand("cue-1")?.command, "cue-spotlight");
      assert.equal(store.count, 1);
      assert.equal(store.loadCatalogue(), undefined);
      assert.equal(store.selectGame("take-demo", 0, "demo", null), "applied");
    } finally {
      store.close();
    }
    const reopened = new Store(path);
    try {
      assert.deepEqual(reopened.loadSelection(), { mode: "demo", gameId: null, epoch: 1 });
      assert.equal(reopened.load()!.elapsedMs, 5200);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("selection, command deduplication, catalogue and fenced summary survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "chess-selection-"));
  const path = join(dir, "broadcast.sqlite");
  let store = new Store(path);
  try {
    assert.deepEqual(store.loadSelection(), { mode: "real", gameId: null, epoch: 0 });
    const catalogue = { games: ["g3", "g4"] };
    store.saveCatalogue(catalogue);
    assert.equal(store.selectGame("a", 0, "real", "g4"), "applied");
    assert.equal(store.saveSummary(1, "g4", { plies: 0 }), true);
    assert.equal(store.selectGame("b", 1, "real", "g3"), "applied");
    assert.equal(store.selectGame("a", 0, "real", "g4"), "duplicate");
    assert.equal(store.selectGame("a", 0, "real", "g3"), "conflict");
    assert.equal(store.selectGame("a", 2, "real", "g4"), "conflict");
    assert.equal(store.selectGame("c", 1, "real", "g4"), "stale");
    assert.equal(store.loadSummary(2, "g3"), undefined);
    assert.equal(store.saveSummary(1, "g4", { plies: 1 }), false);
    assert.equal(store.saveSummary(2, "g3", { plies: 120 }), true);
    store.close();
    store = new Store(path);
    assert.equal(store.selectGame("b", 1, "real", "g3"), "duplicate");
    assert.deepEqual(store.loadSelection(), { mode: "real", gameId: "g3", epoch: 2 });
    assert.deepEqual(store.loadCatalogue(), catalogue);
    assert.deepEqual(store.loadSummary(2, "g3"), { plies: 120 });
    assert.equal(store.selectGame("c", 2, "real", "g4"), "applied");
    assert.equal(store.saveSummary(1, "g4", { plies: 1 }), false, "old epoch even for same game");
    assert.equal(store.loadSummary(3, "g4"), undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failure recording a take rolls back both the target and its summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "chess-rollback-"));
  const path = join(dir, "broadcast.sqlite");
  const store = new Store(path);
  const db = new DatabaseSync(path);
  try {
    store.selectGame("on-air", 0, "real", "g4");
    store.saveSummary(1, "g4", { plies: 10 });
    db.exec(`
      CREATE TRIGGER fail_insert BEFORE INSERT ON selection_commands BEGIN
        SELECT RAISE(ABORT, 'simulated journal write failure');
      END;
    `);
    assert.throws(() => store.selectGame("take", 1, "real", "g3"), /simulated journal write failure/);
    assert.deepEqual(store.loadSelection(), { mode: "real", gameId: "g4", epoch: 1 });
    assert.deepEqual(store.loadSummary(1, "g4"), { plies: 10 });
    db.exec("DROP TRIGGER fail_insert");
    assert.equal(store.selectGame("take", 1, "real", "g3"), "applied");
  } finally {
    db.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("take IDs and cue IDs cannot collide and old rehearsal sessions cannot write", () => {
  const store = new Store(":memory:");
  const checkpoint = { epoch: 1, elapsedMs: 0, sequence: 0, sceneNumber: 0, spotlightSuppressed: false, lastSignature: "" };
  try {
    store.selectGame("enter-rehearsal", 0, "demo", null);
    assert.throws(() => store.commitCommand("enter-rehearsal", "restart", 1, checkpoint, 1), /already used/);
    assert.equal(store.getCommand("enter-rehearsal")?.command, "select");
    store.commitCommand("cue", "restart", 1, checkpoint, 1);
    assert.deepEqual(store.getCommand("cue"), { command: "restart", epoch: 1, selectionEpoch: 1 });
    assert.equal(store.selectGame("cue", 1, "real", "g4"), "conflict");
    store.selectGame("take-four", 1, "real", "g4");
    store.selectGame("reenter-rehearsal", 2, "demo", null);
    assert.throws(() => store.commitCommand("late-cue", "restart", 1, checkpoint, 1), /Stale/);
    assert.equal(store.getCommand("late-cue"), undefined);
  } finally {
    store.close();
  }
});
