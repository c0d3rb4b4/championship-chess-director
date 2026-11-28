export type EngineId = "sesse" | "leela";
export type Command =
  | "restart"
  | "cue-spotlight"
  | "release-move"
  | "return-live";
export interface Piece {
  square: string;
  type: string;
  color: "w" | "b";
}
export interface BoardFrame {
  fen: string;
  pieces: Piece[];
  san: string;
  moveLabel: string;
  from?: string;
  to?: string;
}
export interface Candidate {
  depth?: number;
  moves: string[];
}
export interface EngineView {
  id: EngineId;
  source: string;
  name: string;
  status: "Provisional" | "Ready" | "Updating for this position";
  score: string;
  scoreLabel: string;
  pawns?: number;
  depth?: number;
  work?: number;
  workUnit?: "nodes" | "visits";
  workDelta?: number;
  visitShares?: { san: string; percent: number }[];
  conditionalSan?: string;
  candidates: Candidate[];
  wdl?: [number, number, number];
}
export interface Scene {
  kind: "thinking" | "spotlight" | "actual-move";
  instance: string;
  title: string;
  source?: EngineId;
  rootKey?: string;
  frameIndex?: number;
  frames?: BoardFrame[];
}
export interface ProgrammeSnapshot {
  sequence: number;
  presentationMs: number;
  mode: "DEMO";
  connected: boolean;
  game: {
    id: string;
    epoch: number;
    revision: number;
    rootKey: string;
    event: string;
    round: string;
    white: string;
    black: string;
    whiteCountry?: string;
    blackCountry?: string;
    opening: string;
    ply: number;
    turn: "w" | "b";
    moves: string[];
  };
  actual: BoardFrame;
  clocks: { whiteMs: number; blackMs: number };
  engines: EngineView[];
  scene: Scene;
  panel: Panel;
  moveTimes: MoveTime[];
  history: HistoryRow[];
  ticker: string;
}
export interface OperatorSnapshot {
  programme: ProgrammeSnapshot;
  fixtureTimeMs: number;
  spotlightAtMs: number;
  moveAtMs: number;
  completed: boolean;
  rootVerified: boolean;
  historyDigest: string;
  journalEntries: number;
  timeControl: string;
  providerContract: string;
}

export type Panel = "comparison" | "outcomes" | "time" | "search" | "history";
export interface MoveTime {
  ply: number;
  san: string;
  elapsedMs: number | null;
}
export interface HistoryRow {
  ply: number;
  san: string;
  rootKey: string;
  revision: number;
  sesse?: { pawns: number; observedMs: number; version: number };
  leela?: { percentages: [number, number, number]; observedMs: number; version: number };
  cutoffMs: number;
}

import type { Catalogue, CatalogueGame, GameSummary } from "./catalogue.js";

export interface ClockReading { whiteMs?: number; blackMs?: number }

export interface ReleasedPosition {
  actual: BoardFrame;
  moves: string[];
  startFen: string;
  revision: number;
  summary: GameSummary & { observedAt: string };
  opening?: string;
  clocks?: ClockReading;
  clockRunning?: boolean;
  elapsed?: MoveTime[];
}

export interface LiveAnalysis {
  line: string[];
  candidates?: Candidate[];
  work?: number;
  progress?: { firstAt: number; count: number; delta?: number; ready: boolean };
  visitShares?: EngineView["visitShares"];
  historyVerified?: boolean;
  depth?: number;
  whiteScore?: string;
  pawns?: number;
  wdl?: [number, number, number];
}

export type LivePanel = Panel | "notation" | "numbers";
export interface LiveProfile {
  version: 1;
  panels: [LivePanel, number][];
  settleMs: number;
  provisionalMs: number;
  longThinkMs: number;
  cooldownMs: number;
  maxPlies: number;
  plyMs: number;
  pressureMs: number;
}
export interface LiveDirection {
  panel: LivePanel;
  scene: Scene;
  facts: Pick<FinishedRecap, "white" | "black" | "samples" | "opening">;
  clocks?: ClockReading;
  rootKey: string;
}
export type RecapPage = "result" | "numbers" | "time" | "evaluation" | "replay";

export interface RecapSide {
  moves: number;
  captures: number;
  timedMoves: number;
  totalMs: number;
  longest?: { label: string; elapsedMs: number };
}

export interface RecapSample {
  label: string;
  mover?: "w" | "b";
  elapsedMs?: number;
  pawns?: number;
  wdl?: [number, number, number];
}

export interface ReplayFrame {
  gameId: string;
  ply: number;
  frame: BoardFrame;
  mover?: "w" | "b";
}

export interface FinishedRecap {
  page: RecapPage;
  white: RecapSide;
  black: RecapSide;
  samples: RecapSample[];
  opening?: string;
  matchScore?: { white: number; black: number };
  next?: { label: string; start: string };
  replay?: ReplayFrame;
}

type ProgrammeGame = Omit<CatalogueGame, "binding" | "startFen">;

export interface WaitingProgramme {
  remainingSeconds: number | null;
  previous?: {
    game: ProgrammeGame;
    result: NonNullable<GameSummary["result"]>;
    replay?: ReplayFrame;
  };
}

export interface RealProgramme {
  mode: "REAL";
  streamId?: string;
  sequence: number;
  selectionEpoch: number;
  eventName: string;
  timeZone: string;
  game: ProgrammeGame | null;
  state: "hold" | "unselected" | "pending" | "waiting" | "underway" | "finished" | "unavailable" | "buffering";
  position?: ReleasedPosition;
  interrupted?: boolean;
  analysis?: Partial<Record<EngineId, LiveAnalysis>>;
  live?: LiveDirection;
  recap?: FinishedRecap;
  waiting?: WaitingProgramme;
  summary: (GameSummary & { observedAt: string }) | null;
}

export type BroadcastSnapshot = RealProgramme | (ProgrammeSnapshot & { selectionEpoch?: number; streamId?: string });

export interface SelectionControls {
  selectionEpoch: number;
  catalogue: Catalogue;
  direction?: { profile: LiveProfile; held: boolean; automatic: boolean; pinned?: LivePanel };
  feedHealth?: { delayMs: number; lastRead: string | null; sesse: string; leela: string };
  authorityStatus: "idle" | "pending-binding" | "loading" | "verified" | "mismatch" | "unavailable";
  diagnostic: string | null;
}

export type BroadcastOperator = SelectionControls & (OperatorSnapshot | { programme: RealProgramme });
