import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { Director } from "../../src/server/director.js";
import { demo } from "../../src/server/fixtures.js";
import { programmeStream } from "./programme-stream.js";

const viewport = { width: 1280, height: 720 };
const spotlight = demo.spotlightAtMs;
const move = demo.events[0].atMs;
const clips = [
  { name: "01-statistics-rotation", moments: [19_999, 20_000, 38_000, 58_000], holdMs: 1600 },
  { name: "02-evaluation-history", moments: [155_999, 156_000], holdMs: 1600 },
  {
    name: "03-spotlight-entrance-and-return",
    moments: [spotlight - 1, spotlight, spotlight + 2000, spotlight + 4000, spotlight + 6000, "return-live"],
    holdMs: 2000,
  },
  { name: "04-move-interruption", moments: [move - 1, move, 89_000, 90_000, 96_000], holdMs: 2000 },
] as const;

test.use({ viewport, reducedMotion: "no-preference", video: { mode: "on", size: viewport } });

test.describe("720p programme transition clips", { tag: "@review-captures" }, () => {
  for (const { name, moments, holdMs } of clips) {
    test(name, async ({ page }) => {
      const director = new Director();
      const [start, ...cues] = moments;
      const initial = director.advanceTo(start);
      const send = await programmeStream(page, initial);
      await page.route("**/api/programme", route => route.fulfill({ json: initial }));
      await page.goto("/programme");
      const output = page.getByTestId("programme");
      const actual = page.getByTestId("actual-board");
      await expect(output).toHaveAttribute("data-instance", initial.scene.instance);
      await expect(page.locator(".connection-banner")).toBeHidden();
      // Leave time to see each cue settle, including the played-move highlight.
      await page.waitForTimeout(1200);
      for (const cue of cues) {
        const snapshot = typeof cue === "number" ? director.advanceTo(cue) : director.command(cue);
        await send(snapshot);
        await expect(output).toHaveAttribute("data-instance", snapshot.scene.instance);
        await expect(actual).toHaveAttribute("data-fen", snapshot.actual.fen);
        await expect(actual).toBeInViewport({ ratio: .999 });
        if (snapshot.scene.kind === "spotlight") {
          await expect(page.locator(".analysis-board")).toHaveAttribute("data-frame", String(snapshot.scene.frameIndex));
        } else if (snapshot.panel !== "comparison") {
          await expect(page.locator(`[data-panel="${snapshot.panel}"]`)).toBeVisible();
        }
        await page.waitForTimeout(holdMs);
      }
      const video = page.video();
      if (!video) throw Error("Programme video recording is disabled");
      const dir = "test-results/provider-screenshots/videos";
      await mkdir(dir, { recursive: true });
      await page.close();
      await video.saveAs(`${dir}/${name}-720p.webm`);
    });
  }
});
