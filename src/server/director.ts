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
  constructor(checkpoint?: DirectorState) {
    validateFixtures();
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
        this.state.elapsedMs >= demo.realMove.atMs ||
        this.state.spotlightSuppressed
      )
        throw new Error("Restart the demo to cue another spotlight");
      this.state.elapsedMs = Math.max(this.state.elapsedMs, demo.spotlightAtMs);
    } else if (command === "release-move") {
      this.state.elapsedMs = Math.max(this.state.elapsedMs, demo.realMove.atMs);
    } else if (command === "return-live") {
      this.state.spotlightSuppressed = true;
    }
    return this.snapshot();
  }
  private engines(moved: boolean): EngineView[] {
    const pawnValue = providers.sesse.score.value;
    const { values, scale } = providers.leela.wdl;
    const percent = (index: number) => values[index] * 100 / scale;
    const outcomes: [number, number, number] = [percent(0), percent(1), percent(2)];
    return (Object.keys(providers) as EngineId[]).map((id) => {
      const source = providers[id];
      const samples = source.revisions.filter(
        (r) => r.atMs <= this.state.elapsedMs,
      );
      const latest = samples.at(-1)!;
      const ready =
        samples.length >= 3 &&
        latest.atMs - samples[0].atMs >= 6000 &&
        samples.every(
          (r, i) =>
            i === 0 ||
            (r.version > samples[i - 1].version &&
              r.work > samples[i - 1].work),
        );
      return {
        id,
        source: source.provider,
        name: source.engine,
        status: moved
          ? "Updating for this position"
          : ready
            ? "Ready"
            : "Provisional",
        score: moved
          ? "—"
          : id === "sesse"
            ? `${pawnValue > 0 ? "+" : ""}${pawnValue.toFixed(2)}`
            : outcomes.join(" / "),
        scoreLabel:
          id === "sesse"
            ? "Pawns · White perspective"
            : "White / Draw / Black · %",
        depth: moved ? undefined : latest.depth,
        work: moved ? undefined : latest.work,
        candidates: moved
          ? []
          : source.candidates.map((c) => ({
              depth: c.depth,
              moves: [...c.pv],
            })),
        wdl: moved || id !== "leela" ? undefined : outcomes,
      };
    });
  }
  snapshot(): ProgrammeSnapshot {
    const { epoch, elapsedMs } = this.state;
    // Authoritative move is evaluated first, including a tie with a playback deadline.
    const moved = elapsedMs >= demo.realMove.atMs;
    const moves = moved ? [...demo.moves, demo.realMove.san] : [...demo.moves];
    const actualGame = replay(moves);
    const actual = boardFrame(actualGame);
    const key = rootKey(demo.id, epoch, 1, moves);
    const engines = this.engines(moved);
    let scene: Scene = {
      kind:
        moved && elapsedMs < demo.realMove.atMs + 6000
          ? "actual-move"
          : "thinking",
      instance: "",
      title: actualGame.turn() === "w" ? "White to move" : "Black to move",
    };
    if (scene.kind === "actual-move")
      scene.title = actual.moveLabel;
    if (
      !moved &&
      !this.state.spotlightSuppressed &&
      elapsedMs >= demo.spotlightAtMs &&
      elapsedMs < demo.spotlightAtMs + SPOTLIGHT_DURATION_MS &&
      engines[0].status === "Ready"
    ) {
      const frames = variationFrames(
        demo.moves,
        providers.sesse.candidates[0].pv,
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
        whiteMs: moved
          ? demo.realMove.whiteAfterMs
          : Math.max(0, demo.clocks.whiteMs - elapsedMs),
        blackMs: moved
          ? Math.max(0, demo.clocks.blackMs - (elapsedMs - demo.realMove.atMs))
          : demo.clocks.blackMs,
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
      moveAtMs: demo.realMove.atMs,
      completed: this.state.elapsedMs >= demo.realMove.atMs,
      rootVerified: true,
      historyDigest: programme.game.rootKey,
      journalEntries,
      timeControl: demo.timeControl,
      providerContract:
        "synthetic-demo-v1 · hand-authored fixtures; production protocols unverified",
    };
  }
}
