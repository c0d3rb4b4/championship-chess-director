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
  depth: number;
  moves: string[];
}
export interface EngineView {
  id: EngineId;
  source: string;
  name: string;
  status: "Provisional" | "Ready" | "Updating for this position";
  score: string;
  scoreLabel: string;
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
