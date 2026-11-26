import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBroadcastServer } from "../src/server/http.js";
import type { ProgrammeSnapshot } from "../src/shared/types.js";

test("HTTP command → shared programme interruption, idempotency, protection and SQLite recovery", async () => {
  const temp = await mkdtemp(join(tmpdir(), "chess-demo-"));
  let now = 0;
  const dbPath = join(temp, "test.sqlite");
  const launch = async () => {
    const app = createBroadcastServer({
      dbPath,
      publicDir: resolve("dist/public"),
      now: () => now,
    });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    const address = app.server.address();
    assert(address && typeof address !== "string");
    return { app, url: `http://127.0.0.1:${address.port}` };
  };
  let { app, url } = await launch();
  const get = async (): Promise<ProgrammeSnapshot> =>
    (await fetch(url + "/api/programme")).json();
  const command = (body: unknown, origin = url) =>
    fetch(url + "/api/operator/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  try {
    const original = await get();
    const payload = {
      id: "cue-one",
      command: "cue-spotlight",
      epoch: original.game.epoch,
      revision: 1,
    };
    assert.equal((await command(payload)).status, 200);
    const spotlight = await get();
    assert.equal(spotlight.scene.kind, "spotlight");
    assert.equal((await command(payload)).status, 200, "retry is idempotent");
    const diagnostics = await (await fetch(url + "/api/operator")).json();
    assert.equal(diagnostics.journalEntries, 1);
    now = 4000;
    app.tick();
    const mid = await get();
    assert.equal(mid.scene.frameIndex, 2);
    assert.equal(mid.actual.fen, original.actual.fen);
    const streamResponse = await fetch(url + "/api/programme/events");
    const reader = streamResponse.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert(first.includes('"kind":"spotlight"'));
    const release = {
      id: "real-one",
      command: "release-move",
      epoch: original.game.epoch,
      revision: 1,
    };
    const started = performance.now();
    assert.equal((await command(release)).status, 200);
    let events = "";
    while (!events.includes('"kind":"actual-move"'))
      events += new TextDecoder().decode((await reader.read()).value);
    assert(
      performance.now() - started < 500,
      "actual move reaches the programme SSE within 500 ms",
    );
    await reader.cancel();
    const moved = await get();
    assert.equal(moved.game.ply, 19);
    assert.equal(moved.scene.frames, undefined);
    assert.equal(
      (
        await command(
          { ...release, id: "cross-origin" },
          "https://untrusted.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await command({ ...release, id: "old-epoch", epoch: 999 })).status,
      409,
    );
    assert.equal(
      (await command({ ...release, command: "restart" })).status,
      409,
      "ID cannot be reused with a different payload",
    );
    assert.equal(
      (
        await command({
          ...release,
          id: "bad-command",
          command: "make-up-a-move",
        })
      ).status,
      400,
    );
    assert.equal((await command(null)).status, 400);
    const publicState = JSON.stringify(moved);
    assert(
      !publicState.includes("realMove") &&
        !publicState.includes("journalEntries"),
      "programme does not contain operator diagnostics or future actual moves",
    );
    await app.close();
    ({ app, url } = await launch());
    const recovered = await get();
    assert.equal(recovered.actual.fen, moved.actual.fen);
    assert.equal(recovered.scene.kind, "actual-move");
    assert.equal(
      (await command(release)).status,
      200,
      "deduplication survives a server restart",
    );
    now += 20000;
    app.tick();
    assert.equal((await get()).scene.kind, "thinking");
    assert.equal((await get()).actual.fen, moved.actual.fen);
  } finally {
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
