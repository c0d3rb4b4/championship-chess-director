import { DEFAULT_POSITION } from "chess.js";
import { decodeGame } from "./providers/game.js";
import type { CatalogueGame, GameSummary, RoundBinding } from "../shared/catalogue.js";

export class BindingError extends Error {}
export class AuthorityHttpError extends Error {
  constructor(readonly status: number) { super(`Lichess returned HTTP ${status}`); }
}

function boundChapter(link: string, binding: RoundBinding): boolean {
  const url = URL.parse(link);
  return url?.origin === "https://lichess.org" && url.pathname.startsWith("/broadcast/") &&
    url.pathname.endsWith(`/${binding.roundId}/${binding.chapterId}`);
}

// The Lichess round export can contain several independently tagged games.
function selectChapter(body: string, binding: RoundBinding) {
  const games = body.trim().replace(/\r\n?/g, "\n").split(/\n[ \t]*\n(?=\[)/);
  const matches = games.flatMap(pgn => {
    const divider = pgn.search(/\n[ \t]*\n/);
    if (divider < 0) return [];
    const headerBlock = pgn.slice(0, divider);
    const tags = [...headerBlock.matchAll(/^\[([A-Za-z0-9_]+) "([^"\n]*)"\][ \t]*$/gm)];
    if (!tags.some(([, key, value]) => key === "GameURL" && boundChapter(value, binding))) return [];
    if (tags.length !== headerBlock.split("\n").length) throw new BindingError("Malformed selected PGN headers");
    const headers = new Map(tags.map(([, key, value]) => [key, value]));
    if (headers.size !== tags.length) throw new BindingError("Duplicate PGN headers in selected chapter");
    return [{ pgn, headers, movetext: pgn.slice(divider).trim() }];
  });
  if (matches.length !== 1) throw new BindingError("Expected exactly one matching Lichess round and chapter");
  return matches[0];
}

export function decodeBoundGame(game: CatalogueGame, body: string) {
  const { binding } = game;
  if (!binding) throw new BindingError("Game has no verified Lichess binding");
  const { pgn, headers, movetext } = selectChapter(body, binding);
  const event = headers.get("Event");
  if (!event || !binding.events.includes(event)) throw new BindingError("Unrecognised PGN Event for selected chapter");
  const result = headers.get("Result");
  if (result !== "*" && result !== "1-0" && result !== "0-1" && result !== "1/2-1/2") {
    throw new BindingError("Missing or invalid PGN Result");
  }
  // chess.js otherwise accepts a missing termination and gives movetext precedence over a conflicting tag.
  const mainlineText = movetext.replace(/\{[^}]*\}|;[^\n]*/g, " ").trimEnd();
  const termination = /(?:^|\s)(\*|1-0|0-1|1\/2-1\/2)$/.exec(mainlineText)?.[1];
  if (termination !== result) throw new BindingError("PGN result and movetext termination disagree");
  if ((headers.get("FEN") ?? DEFAULT_POSITION) !== game.startFen ||
      (game.startFen !== DEFAULT_POSITION && headers.get("SetUp") !== "1") ||
      (headers.has("Variant") && headers.get("Variant") !== "Standard")) {
    throw new BindingError("Unverified starting position or variant");
  }

  try {
    return decodeGame({
      authority: "lichess", gameId: binding.chapterId, event, round: binding.pgnRound,
      whiteId: game.white.id, blackId: game.black.id, startFen: game.startFen, clockConvention: "unknown",
    }, "lichess", binding.chapterId, pgn, { verifiedElapsed: binding.elapsedTime === "pgn-emt" });
  } catch {
    throw new BindingError("PGN identity, colours or legal mainline failed verification");
  }
}

export function gameSummary(decoded: ReturnType<typeof decodeBoundGame>): GameSummary {
  return { plies: decoded.moves.length, lastSan: decoded.moves.at(-1) ?? null, fen: decoded.fen,
    result: decoded.result as GameSummary["result"] ?? null };
}

export function decodeGameSummary(game: CatalogueGame, body: string) {
  return gameSummary(decodeBoundGame(game, body));
}

export async function fetchGameRecord(game: CatalogueGame, signal: AbortSignal, request = fetch) {
  if (!game.binding) throw new BindingError("Game has no verified Lichess binding");
  const roundId = game.binding.roundId;
  const comments = game.binding.elapsedTime === "pgn-emt";
  const url = `https://lichess.org/api/broadcast/round/${roundId}.pgn?clocks=true&comments=${comments}`;
  const response = await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new AuthorityHttpError(response.status);
  const pgn = await response.text();
  return { decoded: decodeBoundGame(game, pgn), pgn };
}

export async function fetchGameSummary(game: CatalogueGame, signal: AbortSignal, request = fetch) {
  return gameSummary((await fetchGameRecord(game, signal, request)).decoded);
}
