import test from "node:test";
import assert from "node:assert/strict";
import { Director } from "../src/server/director.js";
import { demo, validateFixtures } from "../src/server/fixtures.js";
import { FixtureHistory } from "../src/server/history.js";
import { duration, outcomes, selectPanel, workProgress } from "../src/server/statistics.js";

test("outcomes validate scope and allocate rounding ties deterministically", () => {
  const w = { values:[300,500,200], scale:1000, perspective:"white", scope:"root" };
  assert.deepEqual(outcomes(w,true), [30,50,20]);
  assert.deepEqual(outcomes({...w,perspective:"side-to-move"},true),[20,50,30]);
  assert.deepEqual(outcomes({...w,values:[1,1,1],scale:3},false),[33.4,33.3,33.3]);
  for (const values of [[300,500],[0,500,0],[-1,500,501],[NaN,0,1000]]) {
    assert.equal(outcomes({...w,values},false),undefined);
  }
  assert.equal(outcomes({...w,scope:"candidate"},false),undefined);
  assert.deepEqual(outcomes({...w,scope:"candidate",candidateSan:"d4"},false),[30,50,20]);
});

test("work heartbeats cannot settle a source or poison subsequent advances", () => {
  const samples = [0,1000,3000,6000].map((atMs,i) => ({atMs,work:[10,10,20,30][i],version:i+1}));
  assert.equal(workProgress(samples.slice(0,3)).ready,false);
  assert.deepEqual(workProgress(samples),{ready:true,delta:10});
  assert.deepEqual(new Director().advanceTo(6000).engines[1].visitShares?.map(s => s.percent),[40,20,12,28]);
});

test("same-side post-move observations account for increments, bonuses, gaps and supplied time", () => {
  const org = {postMs:580000, incrementMs:30000, bonusMs:0, adjustmentMs:0};
  assert.equal(duration(600000,org),50000);
  assert.equal(duration(100000,{...org,postMs:1870000,incrementMs:0,bonusMs:1800000}),30000);
  assert.equal(duration(undefined,org),null);
  assert.equal(duration(600000,{...org,adjustmentMs:-5000}),45000);
  assert.equal(duration(undefined,{...org,suppliedMs:0}),0);
  const d = new Director();
  const times = d.advanceTo(110000).moveTimes;
  assert.deepEqual(times.slice(-2).map(m => m.elapsedMs),[83000,27000]);
  assert.deepEqual(d.advanceTo(300000).moveTimes,times);
});

test("history freezes against release time and invalidates a corrected suffix", () => {
  const d = new Director();
  const frozen = d.advanceTo(83000).history[0];
  assert.equal(frozen.leela?.version,3);
  assert.deepEqual(d.advanceTo(92000).history[0],frozen);
  const rows = d.advanceTo(110000).history;
  assert.equal(rows[1].sesse?.pawns,0.18);
  assert.equal(rows[2].leela,undefined);
  const rebuilt = new FixtureHistory().rows([...demo.moves,"h3"],110000,validateFixtures(),1,{fromPly:19,revision:2});
  assert.deepEqual(rebuilt[0],frozen);
  assert.notEqual(rebuilt[1].rootKey,rows[1].rootKey);
  assert.equal(rebuilt[1].revision,2);
  assert.equal(rebuilt[1].sesse,undefined);
  assert.equal(rebuilt[1].leela,undefined);
});

test("ordinary deadlines skip unavailable panels, reject zero and preempt every entrance", () => {
  assert.equal(selectPanel(99999,new Set(["history"])), "comparison");
  assert.equal(selectPanel(20000,new Set(["comparison","history"])), "history");
  assert.throws(() => selectPanel(0,new Set(),[["search",0]]),/duration/);
  for (const [boundary,panel] of [[0,"comparison"],[20000,"outcomes"],[38000,"time"],[58000,"search"],[74000,"history"]] as const) {
    const d = new Director();
    const first = d.advanceTo(boundary);
    assert.equal(first.panel,panel);
    assert.equal(d.advanceTo(boundary+1).scene.instance,first.scene.instance);
    assert.equal(new Director(d.checkpoint()).snapshot().scene.instance,first.scene.instance);
    const move = d.command("release-move");
    assert.equal(move.panel,"comparison");
    assert.equal(move.scene.kind,"actual-move");
    assert.notEqual(move.game.rootKey, first.game.rootKey);
  }
  const d = new Director();
  const intervals = [0,75000,83000,300000];
  const large = intervals.slice(0,-1).reduce((sum,t,i) =>
    sum + (d.advanceTo(t).scene.kind === "spotlight" ? 0 : intervals[i+1]-t),0);
  assert.equal(large,292000);
  assert.equal(d.advanceTo(1200000).game.ply,20);
});
