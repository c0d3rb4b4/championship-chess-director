import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { Chess } from "chess.js";
import { rehearsal, type Feeds } from "../support/unattended.js";

// Keep the full-viewport recorder in control of Chromium's screencast resolution.
test.use({ trace: { mode: "retain-on-failure", screenshots: false } });
const directory = "test-results/provider-screenshots/unattended";
const times = [0,3,6,12,26,44,64,75,77,79,95,97,110,115,135,155].map(t => t * 1000);
async function take(operator: Page, base: string, id: string) {
  if (operator.url() !== base + "/operator") await operator.goto(base + "/operator");
  await operator.getByRole("combobox").selectOption(id);
  await operator.getByRole("button", { name: "Take Game 1 to programme" }).click();
  await expect(operator.locator("#command-status")).toHaveText("Selected game on programme.");
}
const key = (surface: Locator) => surface.evaluate(el => [
  el.getAttribute("data-instance"), el.querySelector(".analysis-board:not([data-departing] *)")?.getAttribute("data-frame"),
  el.querySelector('[data-testid="actual-board"]')?.getAttribute("data-fen")]);

for (const feeds of ["pgn","sesse","leela","both"] as Feeds[]) test(`unattended rotation after operator closes with ${feeds}${feeds === "both" ? " and review media" : ""}`,
  { tag: "@review-captures" }, async ({ browser }) => {
  const app = await rehearsal(0, feeds);
  let operator = await browser.newPage();
  const pages = await Promise.all([1080,720].map(h => browser.newPage({viewport:{width:h*16/9,height:h}})));
  const views = pages.map(page => page.getByTestId("programme"));
  const panels = new Set<string>();
  try {
    await Promise.all(pages.map(p => p.goto(app.base + "/programme")));
    await take(operator, app.base, app.game.id);
    await operator.close();
    await app.tick(0); app.score(["e4","e5"]); await app.tick(1000);
    await mkdir(directory, { recursive:true });
    await mkdir(directory + "/../videos", { recursive:true });
    const video = feeds === "both";
    for (const t of times) {
      let s = await app.tick(t + 1000);
      if (t <= 6000) { app.engine(t + 1); s = await app.tick(t + 1000); }
      const {scene, panel} = s.live!;
      await Promise.all(views.map(v => expect(v).toHaveAttribute("data-instance", scene.instance)));
      if (scene.kind === "spotlight") {
        await Promise.all(views.map(v => expect(v.locator(".analysis-board")).toHaveAttribute("data-frame", String(scene.frameIndex))));
        expect(await key(views[0])).toEqual(await key(views[1]));
      } else panels.add(panel);
      if (video && (t === 12000 || t === 79000 || t === 135000)) {
        await pages[1].waitForTimeout(1100);
        await Promise.all(pages.map(p => p.screenshot({ path: `${directory}/${scene.kind === "spotlight" ? "spotlight" : panel}-${p.viewportSize()!.height}.jpg`, quality: 88 })));
      }
      if (video && [12000,64000,79000].includes(t)) {
        const name = t === 12000 ? "rotation" : t === 64000 ? "entrance" : "return";
        await pages[1].screencast.start({ path: `${directory}/../videos/auto-${name}-720p.webm`, size: pages[1].viewportSize()! });
        await pages[1].waitForTimeout(300);
      }
      if (video && [26000,75000,95000].includes(t)) { await pages[1].waitForTimeout(1200); await pages[1].screencast.stop(); }
      if (t === 77000 && feeds !== "pgn") {
        operator = await browser.newPage(); await operator.goto(app.base + "/operator");
        const preview = operator.frameLocator("iframe").getByTestId("programme");
        await expect(preview).toHaveAttribute("data-instance", scene.instance);
        expect(await key(preview)).toEqual(await key(views[0]));
        await operator.close();
        await pages[0].reload();
        await expect(views[0].locator(".analysis-board")).toHaveAttribute("data-frame", String(scene.frameIndex));
      }
    }
    for (const panel of feeds === "pgn" ? ["numbers","notation"] : ["comparison",...(feeds === "sesse" ? [] : ["outcomes"]),"time","search","history","notation","numbers"])
      expect(panels.has(panel), panel).toBe(true);
  } finally { await Promise.all([...pages,operator].map(p => p.close())); await app.close(); }
});

const interruptions = [
  ["emphasis", 1100], ["comparison",12100], ["outcomes",26100], ["time",44100], ["search",64100],
  ["entrance",75100], ["PV step",79000], ["exit",95100], ["history",98100], ["notation",116100], ["numbers",136100],
] as const;
for (const delay of [0,60000]) test(`all released in-play graphics yield on three surfaces at D=${delay/1000}`,
  { tag: "@review-captures" }, async ({ browser, playwright, channel }) => {
  test.setTimeout(180000);
  const app = await rehearsal(delay,"both");
  const browsers = await Promise.all([playwright.chromium.launch({channel}),playwright.chromium.launch({channel})]);
  const pages = await Promise.all(browsers.map((b,i)=>b.newPage({ viewport: { width:i?1280:1920,height:i?720:1080 } })));
  const operator = await browser.newPage();
  const views = [...pages.map(p => p.getByTestId("programme")),operator.frameLocator("iframe").getByTestId("programme")];
  const expected = new Chess(); ["e4","e5","Nf3"].forEach(m => expected.move(m));
  const records = [];
  try {
    await Promise.all(pages.map(p=>p.goto(app.base+"/programme")));
    let start = 0;
    for (const [label, moveAt] of interruptions) {
      const reduced = !!delay && label === "PV step";
      await pages[1].emulateMedia({reducedMotion: reduced ? "reduce" : "no-preference"});
      app.score(["e4"]); await app.tick(start);
      await take(operator,app.base,app.game.id);
      await app.tick(start); app.score(["e4","e5"]); const root = start + 1000;
      await app.tick(root);
      const eligible = moveAt + delay;
      const points = new Set([0,3000,6000,moveAt,eligible-1,...times.filter(t=>t<moveAt).map(t=>t+delay)]);
      const until = [...points].filter(t=> t < eligible).sort((a,b)=>a-b);
      for (const t of until) {
        if (t === moveAt) app.score(["e4","e5","Nf3"]);
        let s = await app.tick(root+t);
        if (t <= 6000 && t < moveAt && [0,3000,6000].includes(t)) { app.engine(t+1); s = await app.tick(root+t); }
        if (s.live && (times.includes(t-delay) || t===eligible-1)) {
          await Promise.all(views.map(v=>expect(v).toHaveAttribute("data-instance",s.live!.scene.instance)));
          if (s.live.scene.kind === "spotlight")
            await Promise.all(views.map(v=>expect(v.locator(".analysis-board")).toHaveAttribute("data-frame",String(s.live!.scene.frameIndex))));
        }
      }
      const prior = (await app.snapshot()).live!;
      const kind = label === "entrance" || label === "PV step" ? "spotlight" : label === "emphasis" ? "actual-move" : "thinking";
      expect(prior.scene.kind, label).toEqual(kind);
      if (kind === "thinking" && label !== "exit") expect(prior.panel).toBe(label);
      for (const v of views) await expect(v.locator(".played-moves b")).toHaveText(["e4","e5"]);
      if (label === "entrance" || label === "exit")
        expect(await views[0].locator(".actual-game").evaluate(el => el.getAnimations().some(a => a.playState === "running")),label).toBe(true);
      const film = !delay && label === "entrance";
      if (film) await pages[1].screencast.start({path:directory + "/../videos/auto-interrupt-720p.webm",size:pages[1].viewportSize()!});
      await Promise.all(views.map(v => v.evaluate((main, fen) => {
        const d = document.documentElement.dataset;
        delete d.firstPaint;
        d.staleFrames = "0";
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-testid="actual-board"]')?.getAttribute("data-fen") !== fen) return;
          observer.disconnect();
          const inspect = () => {
            if (document.querySelector('.spotlight-layer [data-fen], .spotlight-layer .variation-rail li, .sesse tbody tr, .leela tbody tr'))
              d.staleFrames = String(Number(d.staleFrames)+1);
          };
          inspect(); requestAnimationFrame(() => { inspect(); requestAnimationFrame(() => { inspect(); d.firstPaint = String(Date.now()); }); });
        });
        observer.observe(main.parentElement!,{attributes:true,subtree:true,childList:true});
      },expected.fen())));
      if (!delay) app.score(["e4","e5","Nf3"]);
      const release = Date.now(); await app.tick(root+eligible);
      const paints = await Promise.all(views.map(async v => {
        await expect(v.getByTestId("actual-board")).toHaveAttribute("data-fen",expected.fen());
        await expect(v.locator(".played-moves b")).toHaveText(["e4","e5","Nf3"]);
        await expect(v.locator(".event")).toContainText("Black to move");
        await expect.poll(()=>v.evaluate(()=>Number(document.documentElement.dataset.firstPaint))).toBeGreaterThan(0);
        const [paint, stale] = await v.evaluate(()=>[Number(document.documentElement.dataset.firstPaint),Number(document.documentElement.dataset.staleFrames)]);
        expect(stale).toBe(0); return paint-release;
      }));
      expect(Math.min(...paints)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...paints),label).toBeLessThan(500);
      if (reduced) expect(await views[1].evaluate(el => el.getAnimations({subtree:true}).length)).toBe(0);
      for (const surface of views) {
        const actual = surface.getByTestId("actual-board");
        await expect(actual.locator("[data-last-move-square]")).toHaveCount(2);
        await expect(surface.locator('.actual-board-wrap[data-move-highlight-pending]')).toHaveCount(0);
      }
      records.push({ label, delay, paints, reducedMotion720: reduced });
      if (film) { await pages[1].waitForTimeout(1000); await pages[1].screencast.stop(); }
      await app.tick(root+eligible+6000);
      expect((await app.snapshot()).live?.scene.kind).toBe("thinking");
      start = root+eligible+10000;
    }
    await mkdir(directory,{recursive:true});
    await writeFile(`${directory}/interrupt-D${delay/1000}.json`,JSON.stringify(records,null,2));
  } finally { await Promise.all(browsers.map(b=>b.close())); await operator.close(); await app.close(); }
});

test("operator overrides persist and a second take inherits the imported cadence", async ({ page }) => {
  const app = await rehearsal(0, "pgn");
  try {
    await take(page, app.base, app.game.id);
    await app.tick(0);
    await page.locator("#direction-controls summary").click();
    await page.getByRole("button", {name:"Export profile"}).click();
    const editor = page.getByLabel("Cadence profile (JSON)");
    const profile = JSON.parse(await editor.inputValue());
    profile.cooldownMs = 105000;
    await editor.fill(JSON.stringify(profile));
    const importButton = page.getByRole("button", {name:"Import profile"});
    await importButton.click();
    await expect(page.getByRole("status")).toHaveText("Direction command accepted.");
    await page.getByRole("button",{name:"Emergency HOLD"}).click();
    const preview = page.frameLocator("iframe").getByTestId("programme");
    await expect(preview).toHaveAttribute("data-state","hold");
    app.score(["e4","e5"]); await app.tick(1000);
    await expect(preview.getByTestId("actual-board")).toHaveCount(0);
    await page.getByRole("button",{name:"Resume programme"}).click();
    await expect(preview.locator(".played-moves b")).toHaveText(["e4","e5"]);
    await take(page,app.base,app.game.id);
    await page.reload();
    await page.locator("#direction-controls summary").click();
    await page.getByRole("button",{name:"Export profile"}).click();
    expect(JSON.parse(await editor.inputValue()).cooldownMs).toBe(105000);
  } finally { await app.close(); }
});

test("the stats timer and ten-second move cue follow release, refresh and a second interruption", {tag:"@review-captures"}, async ({ browser }) => {
  const app = await rehearsal(60000, "pgn");
  const operator = await browser.newPage();
  const pages = await Promise.all([1080,720].map(h=>browser.newPage({viewport:{width:h*16/9,height:h}})));
  await pages[0].emulateMedia({reducedMotion:"reduce"});
  const views = pages.map(page=>page.getByTestId("programme"));
  const progress = (view:Locator) => view.locator(".panel-timer i").evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);
  try {
    await Promise.all(pages.map(p=>p.goto(app.base+"/programme")));
    await take(operator,app.base,app.game.id); await operator.close();
    await app.tick(0); await app.tick(60000);
    await app.tick(66000); await app.tick(72000);
    const timer = views[0].locator(".panel-timer");
    await expect(timer).toBeVisible();
    expect(await progress(views[0])).toBeGreaterThan(.25);
    for (const view of views) await expect(view).not.toHaveAttribute("data-move-cue","");
    app.score(["e4","e5"]); await app.tick(73000);
    await app.tick(132999);
    await expect(views[0].locator(".played-moves b")).toHaveText(["e4"]);
    await expect(views[0]).not.toHaveAttribute("data-move-cue","");
    await mkdir(directory + "/../videos",{recursive:true});
    await pages[1].screencast.start({path:directory + "/../videos/auto-move-cue-720p.webm",size:pages[1].viewportSize()!});
    await pages[1].waitForTimeout(400);
    const releasedAt = Date.now();
    const advance = async (age:number) => {
      await pages[1].waitForTimeout(Math.max(0,releasedAt + age - Date.now()));
      await app.tick(133000 + age);
    };
    await advance(0);
    for (const view of views) {
      await expect(view).toHaveAttribute("data-move-cue","");
      await expect(view.locator(".played-moves b")).toHaveText(["e4","e5"]);
      expect(await progress(view)).toBeLessThan(.22);
    }
    const pulse = views[1].locator(".move-cue-ring");
    const opacity = () => pulse.evaluate(el=>Number(getComputedStyle(el).opacity));
    await expect(views[0].locator(".move-cue-ring")).toHaveCSS("opacity","0.78");
    await advance(1000); await expect.poll(opacity).toBeLessThan(.4);
    await advance(2000); await expect.poll(opacity).toBeGreaterThan(.7);
    await advance(3000);
    await pages[0].reload();
    await expect(views[0]).toHaveAttribute("data-move-cue","");
    expect(await progress(views[0])).toBeGreaterThan(.45);
    await mkdir(directory,{recursive:true});
    // Save an in-progress cue, with the normal six-second move emphasis still on air.
    await Promise.all(pages.map(p=>p.screenshot({path:`${directory}/move-cue-${p.viewportSize()!.height}.jpg`,quality:90})));
    for (let age=4000; age<=9000; age+=1000) await advance(age);
    await expect(views[0]).toHaveAttribute("data-move-cue","");
    await advance(10000);
    for (const view of views) await expect(view).not.toHaveAttribute("data-move-cue","");
    await pages[1].waitForTimeout(550);
    await pages[1].screencast.stop();
    app.score(["e4","e5","Nf3"]); await app.tick(144000);
    app.score(["e4","e5","Nf3","Nc6"]); await app.tick(147000);
    await app.tick(204000); await app.tick(206000);
    await expect(views[0].locator(".played-moves b")).toHaveText(["e4","e5","Nf3"]);
    expect(await progress(views[0])).toBeGreaterThan(.25);
    await app.tick(207000);
    await expect(views[0].locator(".played-moves b")).toHaveText(["e4","e5","Nf3","Nc6"]);
    expect(await progress(views[0])).toBeLessThan(.22);
    await app.tick(216000); await expect(views[0]).toHaveAttribute("data-move-cue","");
    await app.tick(217000); await expect(views[0]).not.toHaveAttribute("data-move-cue","");
  } finally { await Promise.all([...pages,operator].map(p=>p.close())); await app.close(); }
});
