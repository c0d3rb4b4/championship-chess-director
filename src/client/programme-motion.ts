const ease = "cubic-bezier(.22,.77,.16,1)";
const offRight = "translateX(1344px)";
const active = new Set<Animation>();
let departing: HTMLElement | undefined;

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function animate(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
  const animation = element.animate(frames, options);
  active.add(animation);
  const forget = () => active.delete(animation);
  animation.addEventListener("finish", forget, { once: true });
  animation.addEventListener("cancel", forget, { once: true });
  return animation;
}

export function cutProgrammeMotion(): void {
  for (const animation of active) animation.cancel();
  active.clear();
  departing?.remove();
  departing = undefined;
}

reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) cutProgrammeMotion();
});

export function revealPanel(panel: HTMLElement, delay = 0): void {
  animate(panel, [
    { opacity: delay ? 0 : .38, transform: "translate(64px, 28px) scale(.965)" },
    { opacity: 1, transform: "translate(0, 0) scale(1)" },
  ], { duration: 760, delay, easing: ease, fill: "backwards" });
}

export function switchSpotlight(
  programme: HTMLElement,
  spotlight: boolean,
  incomingMarkup: string,
  motion: boolean,
): void {
  const actual = programme.querySelector<HTMLElement>(".actual-game")!;
  const board = actual.querySelector<HTMLElement>(".actual-board-wrap")!;
  const leaving = programme.querySelector<HTMLElement>(
    spotlight ? ".comparison-panel:not([data-departing])" : ".spotlight-layer:not([data-departing])",
  )!;
  const from = motion ? board.getBoundingClientRect() : undefined;
  const leavingStyle = getComputedStyle(leaving);
  const leavingStart = { transform: leavingStyle.transform, opacity: leavingStyle.opacity };
  cutProgrammeMotion();

  actual.classList.toggle("large-actual", !spotlight);
  actual.classList.toggle("mini-actual", spotlight);
  board.classList.toggle("mini-board", spotlight);
  const position = actual.querySelector<HTMLElement>(".mini-position")!;
  position.hidden = !spotlight;
  actual.insertAdjacentHTML("afterend", incomingMarkup);
  const incoming = actual.nextElementSibling as HTMLElement;
  if (!from) {
    leaving.remove();
    return;
  }

  // Measure in canvas pixels so the same trajectory works at 720p and 1080p.
  const to = board.getBoundingClientRect();
  const canvasScale = programme.getBoundingClientRect().width / programme.offsetWidth;
  const travel = { duration: 1050, easing: ease, fill: "backwards" } as const;
  if (canvasScale > 0 && to.width > 0) {
    const x = (from.left - to.left) / canvasScale;
    const y = (from.top - to.top) / canvasScale;
    animate(actual, [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], travel);
    animate(board, [{ transform: `scale(${from.width / to.width})` }, { transform: "none" }], travel);
  }

  // Only the outgoing artwork survives the cut; it can no longer represent a live scene.
  departing = leaving;
  leaving.dataset.departing = "";
  leaving.inert = true;
  leaving.setAttribute("aria-hidden", "true");
  leaving.querySelectorAll("[data-testid]").forEach(node => node.removeAttribute("data-testid"));
  const departure = animate(leaving, [
    leavingStart,
    spotlight ? { transform: "translate(80px, -32px) scale(.97)", opacity: 0 }
      : { transform: offRight, opacity: 1 },
  ], {
    duration: spotlight ? 460 : 950,
    easing: spotlight ? ease : "cubic-bezier(.45,.05,.75,.45)",
    fill: "forwards",
  });
  departure.addEventListener("finish", () => {
    leaving.remove();
    if (departing === leaving) departing = undefined;
  }, { once: true });

  if (spotlight) {
    animate(incoming, [
      { transform: offRight },
      { transform: "translateX(-16px)", offset: .82 },
      { transform: "none" },
    ], { duration: 980, delay: 100, easing: ease, fill: "backwards" });
    animate(position, [{ opacity: 0 }, { opacity: 1 }],
      { duration: 280, delay: 770, easing: ease, fill: "backwards" });
  } else {
    revealPanel(incoming, 360);
  }
}
