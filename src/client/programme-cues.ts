import type { ProgrammeCues } from "../shared/types.js";
import { reducedMotion } from "./programme-motion.js";

let pending = 0;

// Interpolate only the two visual cues. Every scene change still comes from the server.
export function syncProgrammeCues(main: HTMLElement | null, cues?: ProgrammeCues) {
  clearTimeout(pending);
  if (!main) return;
  const surface = main;
  const track = main.querySelector<HTMLElement>(".panel-timer");
  const fill = track?.firstElementChild as HTMLElement | null;
  const interval = cues?.panel;
  if (track) track.hidden = !interval;
  let ring = main.querySelector<HTMLElement>(".move-cue-ring");
  if (cues?.moveAtMs !== undefined && !ring) {
    const wrap = main.querySelector("[data-testid=actual-board]")?.parentElement;
    if (wrap) {
      ring = document.createElement("i");
      ring.className = "move-cue-ring";
      ring.setAttribute("aria-hidden", "true");
      wrap.append(ring);
    }
  }
  const received = performance.now();
  function paint() {
    const now = (cues?.nowMs ?? 0) + performance.now() - received;
    const progress = interval ? Math.max(0, Math.min(1, (now - interval.startMs) / (interval.endMs - interval.startMs))) : 0;
    if (interval && fill) fill.style.transform = `scaleX(${progress})`;
    const age = now - (cues?.moveAtMs ?? -Infinity);
    const active = age >= 0 && age < 10000;
    surface.toggleAttribute("data-move-cue", active);
    if (active && ring) {
      const opacity = reducedMotion.matches ? 0.78 : (0.56 + 0.3 * Math.cos(Math.PI * age / 1000));
      ring.style.opacity = String(opacity);
    }
    if (active || (interval && progress < 1)) pending = window.setTimeout(paint, 100);
  }
  paint();
}
