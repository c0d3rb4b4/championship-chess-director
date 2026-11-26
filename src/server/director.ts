import {
  boardFrame,
  demo,
  providers,
  replay,
  rootKey,
  validateFixtures,
  variationFrames,
} from "./fixtures.js";
import type {
  Command,
  EngineId,
  EngineView,
  OperatorSnapshot,
  ProgrammeSnapshot,
  Scene,
} from "../shared/types.js";

export interface DirectorState {
  epoch: number;
  elapsedMs: number;
  sequence: number;
  sceneNumber: number;
  spotlightSuppressed: boolean;
  lastSignature: string;
}
export const SPOTLIGHT_DURATION_MS = 22000; // 2 s root + 8 × 2 s plies + 4 s end.

/** One server-owned, deterministic state machine. Clients never schedule PV callbacks. */
export class Director {
  private state: DirectorState;
  private readonly positions = validateFixtures();
  constructor(checkpoint?: DirectorState) {
    this.state = checkpoint
      ? structuredClone(checkpoint)
      : {
          epoch: 1,
          elapsedMs: 0,
          sequence: 0,
          sceneNumber: 0,
          spotlightSuppressed: false,
          lastSignature: "",
        };
    this.snapshot();
  }
  checkpoint(): DirectorState {
    return structuredClone(this.state);
  }
  restore(state: DirectorState): void {
    this.state = structuredClone(state);
  }
  advanceTo(elapsedMs: number): ProgrammeSnapshot {
    if (!Number.isFinite(elapsedMs) || elapsedMs < this.state.elapsedMs)
      throw new Error("Presentation clock must be monotonic");
    this.state.elapsedMs = Math.floor(elapsedMs);
    return this.snapshot();
  }
  command(command: Command): ProgrammeSnapshot {
    if (command === "restart") {
      this.state.epoch++;
      this.state.elapsedMs = 0;
      this.state.spotlightSuppressed = false;
    } else if (command === "cue-spotlight") {
      if (
        this.state.elapsedMs >= demo.events[0].atMs ||
        this.state.spotlightSuppressed
      )
        throw new Error("Restart the demo to cue another spotlight");
      this.state.elapsedMs = Math.max(this.state.elapsedMs, demo.spotlightAtMs);
    } else if (command === "release-move") {
      this.state.elapsedMs = Math.max(this.state.elapsedMs, demo.events[0].atMs);
    } else if (command === "return-live") {
      this.state.spotlightSuppressed = true;
    }
    return this.snapshot();
  }
  private engines(ply: number): EngineView[] {
    return (Object.keys(providers) as EngineId[]).map((id) => {
      const source = providers[id];
      const position = this.positions[id].get(ply);
      const samples = position?.revisions.filter(r => r.atMs <= this.state.elapsedMs) ?? [];
      const latest = samples.at(-1);
      const view: EngineView = {
        id, source: source.provider, name: source.engine,
        status: "Updating for this position", score: "—", candidates: [],
        scoreLabel: id === "sesse" ? "Pawns · White perspective" : "White / Draw / Black · %",
      };
      if (!position || !latest) return view;
      const ready =
        samples.length >= 3 &&
        latest.atMs - samples[0].atMs >= 6000 &&
        samples.every(
          (r, i) =>
            i === 0 ||
            (r.version > samples[i - 1].version &&
              r.work > samples[i - 1].work),
        );
      if ("score" in position) {
        const value = position.score.value;
        view.score = `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
      } else {
        const { values, scale } = position.wdl;
        const pct = (i: number) => values[i] * 100 / scale;
        view.wdl = [pct(0), pct(1), pct(2)];
        view.score = view.wdl.join(" / ");
      }
      return {
        ...view, status: ready ? "Ready" : "Provisional",
        depth: latest.depth, work: latest.work,
        candidates: position.candidates.map(c => ({ depth: c.depth, moves: [...c.pv] })),
      };
    });
  }
  snapshot(): ProgrammeSnapshot {
    const { epoch, elapsedMs } = this.state;
    // Authoritative move is evaluated first, including a tie with a playback deadline.
    const released = demo.events.filter(event => event.atMs <= elapsedMs);
    const lastMove = released.at(-1);
    const moves = [...demo.moves, ...released.map(event => event.san)];
    const actualGame = replay(moves);
    const actual = boardFrame(actualGame);
    const key = rootKey(demo.id, epoch, 1, moves);
    const engines = this.engines(moves.length);
    let scene: Scene = {
      kind:
        lastMove && elapsedMs < lastMove.atMs + 6000
          ? "actual-move"
          : "thinking",
      instance: "",
      title: actualGame.turn() === "w" ? "White to move" : "Black to move",
    };
    if (scene.kind === "actual-move")
      scene.title = actual.moveLabel;
    if (
      !lastMove &&
      !this.state.spotlightSuppressed &&
      elapsedMs >= demo.spotlightAtMs &&
      elapsedMs < demo.spotlightAtMs + SPOTLIGHT_DURATION_MS &&
      engines[0].status === "Ready"
    ) {
      const frames = variationFrames(
        demo.moves,
        engines[0].candidates[0].moves,
      );
      scene = {
        kind: "spotlight",
        instance: "",
        title: providers.sesse.engine + " variation",
        source: "sesse",
        rootKey: key,
        frames,
        frameIndex: Math.min(
          frames.length - 1,
          Math.floor((elapsedMs - demo.spotlightAtMs) / 2000),
        ),
      };
    }
    const signature = `${epoch}:1:${moves.length}:${scene.kind}`;
    if (signature !== this.state.lastSignature) {
      this.state.sceneNumber++;
      this.state.lastSignature = signature;
    }
    scene.instance = `${epoch}:1:${moves.length}:${this.state.sceneNumber}`;
    this.state.sequence++;
    return {
      sequence: this.state.sequence,
      presentationMs: elapsedMs,
      mode: "DEMO",
      connected: true,
      game: {
        id: demo.id,
        epoch,
        revision: 1,
        rootKey: key,
        event: demo.event,
        round: demo.round,
        white: demo.white,
        black: demo.black,
        opening: demo.opening,
        ply: moves.length,
        turn: actualGame.turn(),
        moves,
      },
      actual,
      engines,
      scene,
      clocks: {
        whiteMs: Math.max(0, (lastMove ?? demo.clocks).whiteMs -
          (actualGame.turn() === "w" ? elapsedMs - (lastMove?.atMs ?? 0) : 0)),
        blackMs: Math.max(0, (lastMove ?? demo.clocks).blackMs -
          (actualGame.turn() === "b" ? elapsedMs - (lastMove?.atMs ?? 0) : 0)),
      },
      ticker: actual.moveLabel,
    };
  }
  operator(
    programme: ProgrammeSnapshot,
    journalEntries: number,
  ): OperatorSnapshot {
    return {
      programme,
      fixtureTimeMs: this.state.elapsedMs,
      spotlightAtMs: demo.spotlightAtMs,
      moveAtMs: demo.events[0].atMs,
      completed: this.state.elapsedMs >= demo.events.at(-1)!.atMs,
      rootVerified: true,
      historyDigest: programme.game.rootKey,
      journalEntries,
      timeControl: demo.timeControl,
      providerContract:
        "synthetic-demo-v1 · hand-authored fixtures; production protocols unverified",
    };
  }
}
