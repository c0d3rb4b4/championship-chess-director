import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { stat, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { rehearsal } from "../tests/support/unattended.js";

const elapsed = process.argv.includes("--elapsed");
const eightHours = 8 * 3600000;
const step = 2000;
async function run() {
  const started = performance.now();
  const app = await rehearsal(0, "leela", 15000);
  const db = new DatabaseSync(app.dbPath, { readOnly: true });
  const hash = createHash("sha256");
  const scenes: Record<string, number> = {};
  const resources: object[] = [];
  const rolling: boolean[] = [];
  let minimumLargeShare = 1;
  const moves = ["e4","e5","Nf3","Nc6","Bb5","a6","Ba4","Nf6","O-O","Be7","Re1","b5","Bb3","d6",
    "c3","O-O","h3","Nb8","d4","Nbd7","Nbd2","Bb7","Bc2","Re8"];
  const times = [0, 15000, 30000, 45000, ...moves.slice(4).map((_,i) => (i + 1) * 1200000)];
  let plies = 1, worstDriftMs = 0, restarts = 0, outage = false, sawGap = false, sawRecovery = false;
  let result = false, interval = false, peakRows = 0;
  try {
    assert.equal((await app.command({ command: "select-game", selectionEpoch: 0, gameId: app.game.id })).status, 200);
    for (let at = 0; at <= eightHours; at += step) {
      if (elapsed) await sleep(Math.max(0, started + at - performance.now()));
      if (plies < moves.length && at >= times[plies]) app.score(moves.slice(0, ++plies));
      if (at === 3600000) { outage = true; app.outage(); }
      if (at === 3660000) { outage = false; app.score(moves.slice(0, plies)); }
      if (at === 14400000) { await app.restart(); restarts++; }
      if (at === 27000000) { result = true; app.score(moves, "1/2-1/2"); }
      if (at === 27900000) {
        assert.equal((await app.command({ command: "select-game", selectionEpoch: 1, gameId: "game-2" })).status, 200);
        interval = true;
      }
      if (!outage && !result && at % 6000 === 0) app.engine(at + 1);
      const s = await app.tick(at);
      if (s.interrupted) sawGap = true;
      if (sawGap && s.live && !s.interrupted) sawRecovery = true;
      if (s.live?.clocks && s.position?.clockRunning && !s.interrupted) {
        const side = s.position.actual.fen.split(" ")[1] === "w" ? "whiteMs" : "blackMs";
        worstDriftMs = Math.max(worstDriftMs, Math.abs(s.live.clocks[side]! - Math.max(0, 7200000 - (Date.parse(app.game.scheduledStart!) + at - Date.parse(s.position.summary.observedAt)))));
      }
      const scene = s.recap?.page ?? s.live?.scene.kind ?? s.state;
      if (s.live) {
        rolling.push(s.live.scene.kind !== "spotlight");
        if (rolling.length > 300000 / step) rolling.shift();
        if (rolling.length === 300000 / step) minimumLargeShare = Math.min(minimumLargeShare, rolling.filter(Boolean).length / rolling.length);
      }
      if (at < eightHours) scenes[scene] = (scenes[scene] ?? 0) + step;
      hash.update(JSON.stringify([at, scene, s.live?.panel, s.live?.scene.frameIndex, s.position?.actual.fen, s.recap?.replay?.ply,
        s.recap?.white.moves,s.recap?.black.captures]));
      if (at % 600000 === 0) {
        const rows = Number(db.prepare("SELECT count(*) AS n FROM feed_events").get()!.n);
        peakRows = Math.max(rows, peakRows);
        resources.push({ at, rss: process.memoryUsage.rss(), rows, sqliteBytes: (await stat(app.dbPath)).size,
          walBytes: (await stat(app.dbPath + "-wal")).size });
      }
    }
    assert.ok(interval && sawGap && sawRecovery && scenes.spotlight > 0 && scenes.replay > 0 && (scenes.pending ?? 0) + (scenes.waiting ?? 0) > 0);
    assert.ok(worstDriftMs <= 1000, `clock drift ${worstDriftMs} ms`);
    assert.ok(minimumLargeShare >= .7);
    assert.ok(peakRows < 600, `compaction retained ${peakRows} rows`);
    return { timelineMs: eightHours, elapsedMs: Math.round(performance.now()-started), accelerated: !elapsed, restarts,
      socketGenerations: app.generations, minimumLargeShare, worstDriftMs, peakRows, resources, scenes, digest: hash.digest("hex") };
  } finally { db.close(); await app.close(); }
}
const first = await run();
const second = elapsed ? undefined : await run();
if (second) assert.equal(first.digest, second.digest);
const dir = "test-results/provider-screenshots/unattended";
await mkdir(dir, { recursive: true });
await writeFile(dir + "/endurance.json", JSON.stringify({ first, second }, null, 2));
console.log(JSON.stringify({ ...first, resources: first.resources.length, repeatDigest: second?.digest }));
