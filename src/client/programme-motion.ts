const panelEase = "cubic-bezier(.22,.77,.16,1)";
const travelEase = "cubic-bezier(.42, 0, .58, 1)";
const spotlightDuration = 1050;
const interruptionDuration = 750;
const active = new Set<Animation>();
let departing: { layer: HTMLElement; animation: Animation } | undefined;
let pendingHighlight: HTMLElement | undefined;

type Motion = "cut" | "normal" | "interruption";

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function animate(
  element: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
  startTime?: CSSNumberish | null,
) {
  const animation = element.animate(frames, options);
  if (startTime != null) animation.startTime = startTime;
  active.add(animation);
  const forget = () => active.delete(animation);
  animation.addEventListener("finish", forget, { once: true });
  animation.addEventListener("cancel", forget, { once: true });
  return animation;
}

function showPendingHighlight() {
  const board = pendingHighlight;
  board?.removeAttribute("data-move-highlight-pending");
  pendingHighlight = undefined;
  return board;
}

export function cutProgrammeMotion(keep?: HTMLElement): void {
  for (const animation of active) animation.cancel();
  active.clear();
  if (departing && departing.layer !== keep) departing.layer.remove();
  departing = undefined;
  showPendingHighlight();
}

reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) cutProgrammeMotion();
});

export function revealPanel(panel: HTMLElement, delay = 0): void {
  animate(panel, [
    { opacity: delay ? 0 : .38, transform: "translate(64px, 28px) scale(.965)" },
    { opacity: 1, transform: "translate(0, 0) scale(1)" },
  ], { duration: 760, delay, easing: panelEase, fill: "backwards" });
}

function depart(layer: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions, startTime: CSSNumberish | null): void {
  layer.dataset.departing = "";
  layer.inert = true;
  layer.setAttribute("aria-hidden", "true");
  layer.querySelectorAll("[data-testid]").forEach(node => node.removeAttribute("data-testid"));
  const animation = animate(layer, frames, { ...timing, fill: "forwards" }, startTime);
  departing = { layer, animation };
  animation.addEventListener("finish", () => {
    if (departing?.animation !== animation) return;
    layer.remove();
    departing = undefined;
    const settled = showPendingHighlight();
    settled?.querySelectorAll("[data-last-move-square]").forEach(square => {
      animate(square, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 220,
        easing: panelEase,
        fill: "backwards",
      });
    });
  }, { once: true });
}

function revealPlayedMove(board: HTMLElement, panel: HTMLElement, delay: number): void {
  board.dataset.moveHighlightPending = "";
  pendingHighlight = board;
  revealPanel(panel, delay);
}

function pose(element: HTMLElement): Keyframe {
  const style = getComputedStyle(element);
  return { transform: style.transform, opacity: style.opacity };
}

export function interruptPanel(programme: HTMLElement, markup: string): void {
  const panel = programme.querySelector<HTMLElement>(".comparison-panel:not([data-departing])")!;
  const board = programme.querySelector<HTMLElement>(".actual-board-wrap")!;
  const from = pose(panel);
  cutProgrammeMotion();
  panel.insertAdjacentHTML("beforebegin", markup);
  const next = panel.previousElementSibling as HTMLElement;
  depart(panel, [from, { transform: `translateX(${programme.offsetWidth - panel.offsetLeft}px)`, opacity: 0 }],
    { duration: interruptionDuration, easing: travelEase }, programme.ownerDocument.timeline.currentTime);
  revealPlayedMove(board, next, interruptionDuration);
}

export function switchSpotlight(
  programme: HTMLElement,
  spotlight: boolean,
  incomingMarkup: string,
  motion: Motion,
): void {
  const actual = programme.querySelector<HTMLElement>(".actual-game")!;
  const board = actual.querySelector<HTMLElement>(".actual-board-wrap")!;
  const leaving = programme.querySelector<HTMLElement>(
    spotlight ? ".comparison-panel:not([data-departing])" : ".spotlight-layer",
  )!;
  const from = motion === "cut" ? undefined : board.getBoundingClientRect();
  const leavingStart = pose(leaving);
  cutProgrammeMotion(leaving);

  actual.classList.toggle("large-actual", !spotlight);
  actual.classList.toggle("mini-actual", spotlight);
  board.classList.toggle("mini-board", spotlight);
  const position = actual.querySelector<HTMLElement>(".mini-position")!;
  position.hidden = !spotlight;
  if (!spotlight) programme.querySelector(".comparison-panel:not([data-departing])")?.remove();
  actual.insertAdjacentHTML("afterend", incomingMarkup);
  const incoming = actual.nextElementSibling as HTMLElement;
  if (!from) {
    leaving.remove();
    return;
  }

  // Both board edges interpolate with the same progress. A gap at both
  // endpoints leaves a gap throughout, including when resuming from mid-flight.
  const to = board.getBoundingClientRect();
  const canvasScale = programme.getBoundingClientRect().width / programme.offsetWidth;
  const duration = motion === "interruption" ? interruptionDuration : spotlightDuration;
  const startTime = programme.ownerDocument.timeline.currentTime;
  const travel = { duration, easing: travelEase, fill: "backwards" } as const;
  const line = (spotlight ? incoming : leaving).querySelector<HTMLElement>(".analysis-region")!;
  const offRight = `translateX(${programme.offsetWidth - line.offsetLeft}px)`;
  if (canvasScale > 0 && to.width > 0) {
    const x = (from.left - to.left) / canvasScale;
    const y = (from.top - to.top) / canvasScale;
    animate(actual, [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], travel, startTime);
    animate(board, [{ transform: `scale(${from.width / to.width})` }, { transform: "none" }], travel, startTime);
  }

  // Only the outgoing artwork survives the cut; it can no longer represent a live scene.
  depart(leaving, [
    leavingStart,
    spotlight ? { transform: "translate(80px, -32px) scale(.97)", opacity: 0 }
      : { transform: offRight, opacity: 1 },
  ], {
    duration: spotlight ? 460 : duration,
    easing: spotlight ? panelEase : travelEase,
  }, startTime);

  if (spotlight) {
    animate(incoming, [{ transform: offRight }, { transform: "none" }], travel, startTime);
    animate(position, [{ opacity: 0 }, { opacity: 1 }],
      { duration: 280, delay: duration - 280, easing: panelEase, fill: "backwards" });
  } else if (motion === "interruption") {
    revealPlayedMove(board, incoming, duration);
  } else revealPanel(incoming, 360);
}
