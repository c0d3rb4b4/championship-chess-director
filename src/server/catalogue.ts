import { readFileSync } from "node:fs";
import { validateFen } from "chess.js";
import type { Catalogue, CatalogueGame, CataloguePlayer, TimeControl, RoundBinding } from "../shared/catalogue.js";

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`Invalid catalogue ${field}`);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || (pattern && !pattern.test(value))) {
    throw Error(`Invalid catalogue ${field}`);
  }
  return value;
}

function player(value: unknown): CataloguePlayer {
  const p = record(value, "player");
  return { id: string(p.id, "FIDE player ID", /^[1-9]\d*$/), name: string(p.name, "player name"),
    ...(p.country !== undefined && { country: string(p.country, "country code", /^[A-Z]{2}$/) }) };
}

function binding(value: unknown): RoundBinding | null {
  if (value === null) return null;
  const b = record(value, "binding");
  if (!Array.isArray(b.events) || !b.events.length) throw Error("Missing verified PGN Event headers");
  const aliases = b.sessePlayers === undefined ? undefined : record(b.sessePlayers, "Sesse mapping");
  if (b.elapsedTime !== undefined && b.elapsedTime !== "pgn-emt") throw Error("Invalid elapsed-time convention");
  if (b.clockConvention !== undefined && b.clockConvention !== "post-move") throw Error("Invalid clock convention");
  const fields = b.leelaFields === undefined ? undefined : record(b.leelaFields, "Leela field contracts");
  if (fields && Object.entries(fields).some(([k, v]) => !["rootWdl", "evaluationVisits"].includes(k) || v !== true))
    throw Error("Invalid Leela field contract");
  const timeControl = b.timeControl as TimeControl | undefined;
  const integer = (n: unknown, min: number) => Number.isSafeInteger(n) && Number(n) >= min;
  if (timeControl !== undefined && (!timeControl || b.clockConvention !== "post-move" || !integer(timeControl.startingMs, 1) ||
      !integer(timeControl.incrementMs, 0) || !integer(timeControl.incrementFromMove, 1) || !Array.isArray(timeControl.bonuses) ||
      timeControl.bonuses.some(v => !v || !integer(v.afterMove,1) || !integer(v.ms,0)) ||
      new Set(timeControl.bonuses.map(v => v.afterMove)).size !== timeControl.bonuses.length)) throw Error("Invalid verified time control");
  return {
    ...(timeControl && { timeControl }),
    ...(b.clockConvention && { clockConvention: b.clockConvention }),
    ...(fields && { leelaFields: fields }),
    ...(aliases && { sessePlayers: { white: string(aliases.white, "Sesse White"), black: string(aliases.black, "Sesse Black") } }),
    roundId: string(b.roundId, "Lichess round ID", /^[A-Za-z0-9]{8}$/),
    chapterId: string(b.chapterId, "Lichess chapter ID", /^[A-Za-z0-9]{8}$/),
    pgnRound: string(b.pgnRound, "PGN Round"),
    events: b.events.map(event => string(event, "PGN Event")),
    ...(b.elapsedTime && { elapsedTime: b.elapsedTime }),
  };
}

const stableId = /^[a-z0-9][a-z0-9_-]*$/i;

function game(value: unknown): CatalogueGame {
  const g = record(value, "game");
  if (typeof g.order !== "number" || !Number.isSafeInteger(g.order) || g.order < 1) throw Error("Invalid round order");
  const startFen = string(g.startFen, "start FEN");
  if (!validateFen(startFen).ok) throw Error("Invalid starting position");
  const scheduledStart = g.scheduledStart === null ? null : string(g.scheduledStart, "scheduled start");
  if (scheduledStart !== null) {
    // The config stores instants in UTC. Reject local dates and dates normalised by Date (e.g. 31 February).
    const instant = Date.parse(scheduledStart);
    const canonical = Number.isFinite(instant) ? new Date(instant).toISOString() : "";
    if (!canonical || (canonical !== scheduledStart && canonical.replace(".000Z", "Z") !== scheduledStart)) {
      throw Error("Invalid scheduled UTC instant");
    }
  }
  const white = player(g.white), black = player(g.black);
  if (white.id === black.id) throw Error("The two player IDs must be distinct");
  return {
    id: string(g.id, "game ID", stableId), label: string(g.label, "game label"),
    order: g.order, startFen, scheduledStart, white, black, binding: binding(g.binding),
  };
}

export function parseCatalogue(value: unknown): Catalogue {
  const c = record(value, "event");
  const timeZone = string(c.timeZone, "time zone");
  new Intl.DateTimeFormat("en", { timeZone });
  const scheduleSource = string(c.scheduleSource, "schedule source");
  if (URL.parse(scheduleSource)?.protocol !== "https:") throw Error("Invalid schedule source URL");
  if (!Array.isArray(c.games) || !c.games.length) throw Error("Missing published games");
  const games = c.games.map(game).sort((a, b) => a.order - b.order);
  const ids = games.map(g => g.id);
  const orders = games.map(g => g.order);
  const chapters = games.flatMap(g => g.binding ? [g.binding.chapterId] : []);
  for (const keys of [ids, orders, chapters]) {
    if (new Set<string | number>(keys).size !== keys.length) throw Error("Duplicate game ID, order or bound chapter");
  }
  return {
    eventId: string(c.eventId, "event ID", stableId), eventName: string(c.eventName, "event name"),
    timeZone, scheduleSource, games,
  };
}

export function loadCatalogue(path = "config/championship.json"): Catalogue {
  return parseCatalogue(JSON.parse(readFileSync(path, "utf8")));
}
