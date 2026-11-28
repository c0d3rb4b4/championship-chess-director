import type { RealProgramme, SelectionControls } from "../shared/types.js";

export const directionControls = `<details id="direction-controls" hidden><summary>Programme direction</summary>
  <p id="direction-mode"></p><div class="selection-actions">
  <button data-direction="hold">Emergency HOLD</button><button data-direction="resume">Resume programme</button>
  <button data-direction="auto">Automatic direction</button><button data-direction="pause-auto">Pause rotation</button>
  <button data-direction="next">Next panel</button><button data-direction="pin">Pin current panel</button>
  <button data-direction="feature">Feature eligible line</button><button data-direction="actual">Return to actual board</button></div>
  <label>Programme delay (seconds) <input id="delay-input" type="number" min="0" max="3600" value="0"></label>
  <button data-direction="delay">Set delay under HOLD</button>
  <label for="profile-input">Cadence profile (JSON)</label><textarea id="profile-input" rows="6"></textarea>
  <div class="selection-actions"><button id="export-profile">Export profile</button><button data-direction="profile">Import profile</button></div>
  </details>`;

export function updateDirection(app: HTMLElement, details: SelectionControls | undefined, s: RealProgramme | undefined, ready: boolean) {
  const section = app.querySelector<HTMLElement>("#direction-controls")!;
  const d = details?.direction;
  section.hidden = !s?.game || !d;
  if (section.hidden || !d) return;
  section.querySelector("#direction-mode")!.textContent = d.held ? "Emergency HOLD" : d.pinned ? "Pinned · " + d.pinned :
    d.automatic ? "Automatic direction" : "Rotation paused";
  for (const b of section.querySelectorAll<HTMLButtonElement>("[data-direction]")) {
    const command = b.dataset.direction;
    b.disabled = !ready || (["resume", "delay"].includes(command!) ? !d.held : d.held) ||
      (!s?.live && ["next","pin","feature","actual","pause-auto"].includes(command!));
  }
}

export function bindDirection(app: HTMLElement, current: () => RealProgramme | undefined, details: () => SelectionControls | undefined,
    status: (message: string) => void, refresh: () => Promise<void>) {
  const profile = app.querySelector<HTMLTextAreaElement>("#profile-input")!;
  app.querySelector("#export-profile")!.addEventListener("click", () => {
    profile.value = JSON.stringify(details()?.direction?.profile, null, 2);
    profile.select();
  });
  app.querySelector("#direction-controls")!.addEventListener("click", async event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-direction]");
    const command = button?.dataset.direction, s = current();
    if (!s || !command || button?.disabled) return;
    button!.disabled = true;
    try {
      const value = command === "profile" ? JSON.parse(profile.value) : command === "pin" ? s.live?.panel :
        command === "delay" ? app.querySelector<HTMLInputElement>("#delay-input")!.valueAsNumber * 1000 : undefined;
      const response = await fetch("/api/operator/command", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), command, value, selectionEpoch: s.selectionEpoch, root: s.live?.rootKey }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      status("Direction command accepted.");
    } catch (error) { status(error instanceof Error ? error.message : "Command rejected"); }
    await refresh();
  });
}
