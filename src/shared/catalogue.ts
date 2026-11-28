export interface CataloguePlayer {
  id: string;
  name: string;
  country?: string;
}

export interface TimeControl {
  startingMs: number;
  incrementMs: number;
  incrementFromMove: number;
  bonuses: { afterMove: number; ms: number }[];
}

export interface RoundBinding {
  roundId: string;
  chapterId: string;
  pgnRound: string;
  events: string[];
  sessePlayers?: { white: string; black: string };
  timeControl?: TimeControl;
  clockConvention?: "post-move";
  roundClock?: true;
  leelaFields?: { rootWdl?: true; evaluationVisits?: true };
  elapsedTime?: "pgn-emt";
}

export interface CatalogueGame {
  id: string;
  label: string;
  order: number;
  scheduledStart: string | null;
  startFen: string;
  white: CataloguePlayer;
  black: CataloguePlayer;
  binding: RoundBinding | null;
}

export interface Catalogue {
  eventId: string;
  eventName: string;
  timeZone: string;
  scheduleSource: string;
  games: CatalogueGame[];
}

export interface GameSummary {
  plies: number;
  lastSan: string | null;
  fen: string;
  result: "1-0" | "0-1" | "1/2-1/2" | null;
}
