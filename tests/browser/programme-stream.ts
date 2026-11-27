import type { Page } from "@playwright/test";
import type { ProgrammeSnapshot } from "../../src/shared/types.js";

export async function programmeStream(page: Page) {
  await page.addInitScript(() => {
    class RehearsalStream extends EventTarget {
      constructor() {
        super();
        window.addEventListener("rehearsal", event =>
          this.dispatchEvent(new MessageEvent("snapshot", { data: (event as CustomEvent).detail })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: RehearsalStream });
  });
  return (snapshot: ProgrammeSnapshot) => page.evaluate(detail =>
    window.dispatchEvent(new CustomEvent("rehearsal", { detail })), JSON.stringify(snapshot));
}
