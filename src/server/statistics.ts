import type { Panel } from "../shared/types.js";

interface Wdl {
  values: number[];
  scale: number;
  perspective: string;
  scope: string;
  candidateSan?: string;
}
export function outcomes(wdl: Wdl, blackToMove: boolean): [number, number, number] | undefined {
  const { scale, values, perspective, scope } = wdl;
  if ((scope !== "root" && !(scope === "candidate" && wdl.candidateSan)) ||
      !["white", "side-to-move"].includes(perspective) || !Number.isSafeInteger(scale) || scale <= 0 ||
      !Array.isArray(values) || values.length !== 3 || !values.every(v => Number.isSafeInteger(v) && v >= 0) ||
      values.reduce((a,b) => a+b, 0) !== scale) return;
  const ordered = perspective === "side-to-move" && blackToMove ? [...values].reverse() : values;
  // Allocate tenths by largest remainder. Equal remainders retain White/Draw/Black order.
  const raw = ordered.map(v => v * 1000 / scale);
  const tenths = raw.map(Math.floor);
  const order = [0,1,2].sort((a,b) => (raw[b]-tenths[b]) - (raw[a]-tenths[a]));
  for (const i of order.slice(0, 1000 - tenths.reduce((a,b) => a+b))) tenths[i]++;
  return [tenths[0]/10, tenths[1]/10, tenths[2]/10];
}

export interface ClockObservation {
  postMs?: number;
  suppliedMs?: number;
  incrementMs: number;
  bonusMs: number;
  adjustmentMs: number;
}
export function duration(previous: number | undefined, observation: ClockObservation): number | null {
  const { postMs, suppliedMs, incrementMs, bonusMs, adjustmentMs } = observation;
  const ms = suppliedMs ?? ((previous ?? NaN) + incrementMs + bonusMs + adjustmentMs - (postMs ?? NaN));
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

interface Sample { atMs: number; version: number; work: number }
export function workProgress(samples: Sample[]) {
  const advances: Sample[] = [];
  for (const sample of samples) {
    const last = advances.at(-1);
    if (!last || (sample.version > last.version && sample.work > last.work)) advances.push(sample);
  }
  const latest = advances.at(-1);
  const prior = advances.at(-2);
  return {
    ready: advances.length >= 3 && latest!.atMs - advances[0].atMs >= 6000,
    delta: prior && latest ? latest.work - prior.work : undefined,
  };
}

export const ordinaryProfile: readonly [Panel, number][] = [
  ["comparison", 20000], ["outcomes", 18000], ["time", 20000], ["search", 16000], ["history", 20000],
];
export function panelSlot(elapsed: number, eligible: Set<Panel>, profile = ordinaryProfile) {
  if (profile.some(([, ms]) => !Number.isSafeInteger(ms) || ms <= 0))
    throw new Error("Invalid panel duration");
  const slots = profile.filter(([panel]) => eligible.has(panel));
  if (slots.length < 2) return;
  let phase = Math.max(0, elapsed) % slots.reduce((sum, [, ms]) => sum + ms, 0);
  for (const [panel, ms] of slots) {
    if (phase < ms) return { panel, startMs: elapsed - phase, endMs: elapsed - phase + ms };
    phase -= ms;
  }
}
export function selectPanel(elapsed: number, eligible: Set<Panel>, profile = ordinaryProfile): Panel {
  return panelSlot(elapsed, eligible, profile)?.panel ?? "comparison";
}
