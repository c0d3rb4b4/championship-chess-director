import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { rehearsal } from "./support/unattended.js";
import { defaultProfile, validateProfile } from "../src/server/live-director.js";
import { decodeGame, providerFenMatches } from "../src/server/providers/game.js";
import { DEFAULT_POSITION } from "chess.js";

test("protected direction, idempotent commands, delay reconciliation and cadence across takes", async () => {
  const r = await rehearsal(0,"both");
  try {
    const control = async (command: string, value?: unknown, id = crypto.randomUUID()) => {
      const snapshot = await r.snapshot();
      return r.command({ id, selectionEpoch:snapshot.selectionEpoch,root:snapshot.live?.rootKey,command,value });
    };
    assert.equal((await control("select-game")).status,400);
    assert.equal((await r.command({ command:"select-game",gameId:r.game.id,selectionEpoch:0 })).status,200);
    await r.tick(0); r.score(["e4","e5"]); await r.tick(1000);
    const id = crypto.randomUUID();
    assert.equal((await control("pin","numbers",id)).status,200);
    assert.equal((await (await control("pin","numbers",id)).json()).duplicate,true);
    assert.equal((await control("next",undefined,id)).status,409);
    await r.tick(40000); assert.equal((await r.snapshot()).live?.panel,"numbers");
    assert.equal((await r.snapshot()).cues?.panel,undefined);
    r.score(["e4","e5","Nf3"]); await r.tick(41000);
    assert.equal((await r.snapshot()).live?.scene.kind,"actual-move");
    assert.equal((await control("delay",60000)).status,409);
    assert.equal((await control("profile",{...defaultProfile,maxPlies:40})).status,400);
    assert.equal((await control("profile",{...defaultProfile,longThinkMs:85000})).status,200);
    assert.equal((await control("hold")).status,200);
    r.score(["e4","e5","Nf3","Nc6"]); await r.tick(50000);
    assert.equal((await r.snapshot()).position,undefined);
    await r.restart(); assert.equal((await r.snapshot()).state,"hold");
    assert.equal((await control("delay",60000)).status,200);
    assert.equal((await r.snapshot()).state,"hold");
    await r.tick(50000); assert.equal((await control("resume")).status,200);
    await r.tick(109999); assert.equal((await r.snapshot()).state,"buffering");
    await r.tick(110000); assert.equal((await r.snapshot()).position?.actual.san,"Nc6");
    const details = await (await fetch(r.base+"/api/operator")).json();
    assert.equal(details.direction.profile.longThinkMs,85000);
    const currentEpoch = (await r.snapshot()).selectionEpoch;
    assert.equal((await r.command({ command:"select-game",gameId:r.game.id,selectionEpoch:currentEpoch })).status,200);
    assert.equal((await (await fetch(r.base+"/api/operator")).json()).direction.profile.longThinkMs,85000);
    assert.equal((await r.command({ command:"hold",selectionEpoch:currentEpoch })).status,409);
  } finally { await r.close(); }
});

test("an intact delayed journal resumes a frozen PV; a missing buffered row refills the full delay", async () => {
  const r = await rehearsal(60000,"leela");
  try {
    await r.command({command:"select-game",gameId:r.game.id,selectionEpoch:0});
    await r.tick(0); r.score(["e4","e5"]);
    for (const t of [1000,4000,7000]) { await r.tick(t); r.engine(t); await r.tick(t); }
    await r.tick(61000);
    await r.tick(136000);
    await r.tick(140000); const first = (await r.snapshot()).live!;
    assert.equal(first.scene.frameIndex,2);
    await r.restart(); assert.deepEqual((await r.snapshot()).live,first);
    r.score(["e4","e5","Nf3"]); await r.tick(141000);
    const db = new DatabaseSync(r.dbPath);
    db.prepare("DELETE FROM feed_events WHERE id=(SELECT MAX(id) FROM feed_events WHERE source='authority')").run();
    db.close(); await r.restart();
    assert.equal((await r.snapshot()).state,"buffering");
    await r.tick(141000); await r.tick(200999); assert.equal((await r.snapshot()).position,undefined);
    await r.tick(201000); assert.equal((await r.snapshot()).position?.actual.san,"Nf3");
    const epoch = (await r.snapshot()).selectionEpoch;
    await r.gap(290000); assert.ok((await r.snapshot()).selectionEpoch>epoch);
    assert.equal((await r.snapshot()).state,"buffering");
  } finally { await r.close(); }
});

test("time trouble, repeated long thinks, rapid play and source loss respect the actual board", async () => {
  const r=await rehearsal(0,"both");
  try {
    await r.command({command:"select-game",gameId:r.game.id,selectionEpoch:0});await r.tick(0);
    r.score(["e4","e5"]); let lastSource: string|undefined;
    for (const t of [1000,4000,7000]) {await r.tick(t);r.engine(t);await r.tick(t);}
    for (const t of [76000,78000,96000,185999,186000]) {
      const s=await r.tick(t);
      if(t===76000) { assert.equal(s.live?.scene.kind,"spotlight");lastSource=s.live?.scene.source; }
      if(t===185999) assert.equal(s.live?.scene.kind,"thinking");
      if(t===186000) { assert.equal(s.live?.scene.kind,"spotlight");assert.notEqual(s.live?.scene.source,lastSource); }
    }
    r.outage(); const gap=await r.tick(187000);
    assert.ok(gap.interrupted); assert.notEqual(gap.live?.scene.kind,"spotlight");
    assert.deepEqual((await r.tick(188000)).live?.clocks,gap.live?.clocks);
    for (const [i,moves] of [["e4","e5","Nf3"],["e4","e5","Nf3","Nc6"],["e4","e5","Nf3","Nc6","Bb5"]].entries()) {
      r.score(moves,"*",330); await r.tick(190000+i*3000);
    }
    const state = (await (await fetch(r.base+"/api/operator")).json()).programme;
    assert.equal(state.position.actual.san,"Bb5");
    assert.equal((await r.command({command:"feature",selectionEpoch:1,root:state.live.rootKey})).status,409);
    for(const t of [200000,203000,206000]) { await r.tick(t);r.engine(t);await r.tick(t); }
    assert.notEqual((await r.tick(275000)).live?.scene.kind,"spotlight");
    const finalMinute=await r.tick(470000);
    assert.equal(finalMinute.live?.panel,"comparison");
    assert.equal(finalMinute.live?.clocks?.blackMs,56000);
  } finally { await r.close(); }
});

test("field gates preserve staged bonus, increment, missing clocks and exact en-passant rights",()=>{
  assert.throws(()=>validateProfile({...defaultProfile,panels:defaultProfile.panels.slice(1)}));
  const binding={ authority:"a",gameId:"1",event:"Test",round:"1",whiteId:"1",blackId:"2",
    startFen:DEFAULT_POSITION,clockConvention:"post-move" as const,
    timeControl:{startingMs:100000,incrementMs:1000,incrementFromMove:2,bonuses:[{afterMove:1,ms:20000}]} };
  const game=decodeGame(binding,"a","1",'[Event "Test"]\n[Round "1"]\n[WhiteFideId "1"]\n[BlackFideId "2"]\n\n1. e4 {[%clk 0:01:50]} e5 2. Nf3 {[%clk 0:01:40]} Nc6 {[%clk 0:01:39]} *');
  assert.deepEqual(game.elapsed?.map(r=>r.elapsedMs),[10000,null,11000,null]);
  assert.equal(providerFenMatches(game.fen.replace(" - "," a3 "),game.fen,undefined),false);
});

test("the championship profile restores long-think analysis, timed moves and root WDL on a cold take", async () => {
  const app = await rehearsal(0,"both",1,105);
  try {
    app.score(["e4","e5"]);
    await app.command({command:"select-game",gameId:app.game.id,selectionEpoch:0});
    await app.tick(0);
    for (const t of [100,1000,4100,7200,8500]) {
      await app.tick(t);
      app.engine(t);
      await app.tick(t);
    }
    const live = await app.snapshot();
    assert.equal(live.position?.clockRunning,true);
    assert.equal(live.live?.facts.white.timedMoves,1);
    assert.equal(live.live?.facts.black.timedMoves,1);
    assert.deepEqual(live.analysis?.leela?.wdl,[30,50,20]);
    assert.equal(live.analysis?.leela?.visitShares,undefined);
    assert.equal(live.live?.scene.kind,"spotlight");
    assert.equal(live.cues?.moveAtMs,undefined);
    assert.ok(live.cues?.panel);
    app.score(["e4","e5","Nf3"]);
    const moved=await app.tick(9000);
    assert.equal(moved.live?.scene.kind,"actual-move");
    assert.equal(moved.cues?.moveAtMs,moved.cues?.nowMs);
    assert.equal(moved.cues!.panel!.endMs - moved.cues!.panel!.startMs,6000);
  } finally { await app.close(); }
});
