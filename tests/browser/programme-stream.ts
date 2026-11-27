import type { Page } from "@playwright/test";
import type { ProgrammeSnapshot } from "../../src/shared/types.js";

export async function programmeStream(page: Page, initial?: ProgrammeSnapshot) {
  await page.addInitScript(initialJson => {
    class RehearsalStream extends EventTarget {
      constructor() {
        super();
        window.addEventListener("rehearsal", event =>
          this.dispatchEvent(new MessageEvent("snapshot", { data: (event as CustomEvent).detail })));
        if (initialJson !== undefined) {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("snapshot", { data: initialJson })));
        }
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: RehearsalStream });
  }, initial && JSON.stringify(initial));
  return (snapshot: ProgrammeSnapshot) => page.evaluate(detail =>
    window.dispatchEvent(new CustomEvent("rehearsal", { detail })), JSON.stringify(snapshot));
}
