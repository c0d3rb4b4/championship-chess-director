import { setTimeout as sleep } from "node:timers/promises";
import type { CatalogueGame } from "../../shared/catalogue.js";
import type { EngineId, LiveAnalysis } from "../../shared/types.js";
import { outcomes } from "../statistics.js";
import { count, providerFenMatches, wirePositions, type Game } from "./game.js";
import { LeelaReplay } from "./leela.js";
import { SesseReplay } from "./sesse.js";
import { leelaUrl, listenToLeela, sesseUrl, type CaptureSocket } from "./transport.js";

export interface SesseSession { decoder?: SesseReplay; base?: string }

export interface AnalysisTransport {
  request?: typeof fetch;
  waitForSessePoll?: (signal: AbortSignal) => Promise<void>;
  openSocket?: (url: string) => CaptureSocket;
}

// A root owns both sessions. Aborting it fences late HTTP responses and socket callbacks.
export function followAnalysis(selected: CatalogueGame, game: Game, signal: AbortSignal, transport: AnalysisTransport,
    report: (source: EngineId, analysis: LiveAnalysis | null, raw: unknown) => void, wire: SesseSession = {}) {
  const binding = selected.binding!;
  const request = transport.request ?? fetch;
  async function run(source: EngineId, read: () => Promise<void>, retryMs: number) {
    while (!signal.aborted) {
      try { await read(); }
      catch (error) {
        if (!signal.aborted) {
          if (source === "sesse") { wire.base = undefined; wire.decoder = undefined; }
          report(source, null, String(error));
        }
      }
      if (!signal.aborted) await sleep(retryMs, undefined, { signal }).catch(() => {});
    }
  }
  const aliases = binding.sessePlayers;
  if (aliases) void run("sesse", async () => {
    const mapped = { ...game, binding: { ...game.binding, sessePlayers: aliases } };
    const decoder = wire.decoder ??= new SesseReplay(mapped);
    decoder.setGame(mapped);
    while (!signal.aborted) {
      const url = new URL(sesseUrl);
      if (wire.base !== undefined) url.searchParams.set("ims", wire.base);
      const response = await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]) });
      if (!response.ok) throw Error(`Sesse HTTP ${response.status}`);
      const version = response.headers.get("x-rglm");
      if (!version) throw Error("Missing Sesse version");
      const body = await response.json();
      if (signal.aborted) return;
      const update = decoder.receive(version, wire.base, body, Date.now());
      wire.base = version;
      const p = update?.principal, score = p?.score;
      const whiteScore = score?.unit === "pawns" ? `${score.bound ?? ""}${score.value >= 0 ? "+" : ""}${score.value.toFixed(2)}`
        : score?.unit === "mate" ? `${score.bound ?? ""}M${score.value}` : score?.unit === "tablebase-draw" ? "Tablebase draw" : undefined;
      report("sesse", p ? { line: p.pv, depth: p.depth, whiteScore, work: update.nodes, historyVerified: true,
        candidates: [p, ...update.alternatives].slice(0, 3).map(c => ({ depth: c.depth, moves: c.pv })), pawns: score?.unit === "pawns" && !score.bound ? score.value : undefined } : null, { version, body });
      if (transport.waitForSessePoll) await transport.waitForSessePoll(signal);
      else await sleep(1000, undefined, { signal });
    }
  }, 15_000);
  void run("leela", async () => {
    const socket = (transport.openSocket ?? (url => new WebSocket(url)))(leelaUrl);
    const expected = [{ fen: game.binding.startFen, doublePush: undefined, uci: undefined }, ...wirePositions(game)];
    const matched = new Set<number>();
    let verifiedWdl: LiveAnalysis["wdl"];
    let total: number | undefined, evalId: number | undefined;
    let selectedId: number | undefined;
    let receive: ReturnType<LeelaReplay["subscribe"]> | undefined;
    await listenToLeela(socket, signal, body => {
      if (signal.aborted) return;
      if (!receive) {
        const matches = (Array.isArray(body.games) ? body.games : []).filter(entry => {
          const url = typeof entry?.feedUrl === "string" && URL.parse(entry.feedUrl);
          return url && url.origin === "https://lichess.org" && url.pathname.endsWith(`/${binding.roundId}/${binding.chapterId}`) &&
            String(entry.player1?.fideId) === selected.white.id && String(entry.player2?.fideId) === selected.black.id;
        });
        if (matches.length !== 1 || !Number.isSafeInteger(matches[0].gameId) || matches[0].gameId < 0) return;
        const gameId = matches[0].gameId;
        selectedId = gameId;
        receive = new LeelaReplay().subscribe(gameId, game);
        socket.send(JSON.stringify({ gameId, ply: game.moves.length }));
      }
      const update = receive(body);
      for (const row of Array.isArray(body.positions) ? body.positions : []) {
        if (row.gameId !== selectedId || !Number.isInteger(row.ply) || row.ply < 0 || row.ply >= expected.length) continue;
        const position = expected[row.ply];
        if (!providerFenMatches(row.fen, position.fen, position.doublePush) ||
            (row.ply && row.moveUci !== undefined && row.moveUci !== position.uci)) {
          matched.clear();
          verifiedWdl = undefined;
          total = undefined;
        } else {
          matched.add(row.ply);
          if (row.ply === game.moves.length && binding.leelaFields?.rootWdl &&
              ["scoreW", "scoreD", "scoreB"].some(k => k in row))
            verifiedWdl = outcomes({ values: [row.scoreW, row.scoreD, row.scoreB], scale: 1000, perspective: "white", scope: "root" }, false);
        }
      }
      if (evalId !== update?.evalId) total = undefined;
      evalId = update?.evalId;
      for (const row of Array.isArray(body.evaluations) ? body.evaluations : []) {
        if (row.gameId === selectedId && row.ply === game.moves.length && row.evalId === evalId && "nodes" in row)
          total = count(row.nodes);
      }
      const candidates = update?.candidates.filter(c => c.evalId === evalId) ?? [];
      const best = candidates.reduce<typeof candidates[number] | undefined>((a, b) =>
        !a || (b.nodes ?? -1) > (a.nodes ?? -1) ? b : a, undefined);
      const fullHistory = game.moves.every((_, index) => matched.has(index + 1));
      const value: LiveAnalysis | null = best || verifiedWdl ? { line: best?.pv ?? [] } : null;
      if (value && fullHistory) value.historyVerified = true;
      if (value && verifiedWdl) value.wdl = verifiedWdl;
      if (value && best) {
        if (candidates.length > 1) value.candidates = [best, ...candidates.filter(c => c !== best)].slice(0, 3).map(c => ({ moves: c.pv }));
        // The binding fixes the initial position. A lone target FEN cannot prove a transposed history.
        if (best.nodes !== undefined) value.work = best.nodes;
        const sum = candidates.reduce((n, c) => n + (c.nodes ?? NaN), 0);
        if (binding.leelaFields?.evaluationVisits && total && sum <= total)
          value.visitShares = [...candidates.map(c => ({ san: c.pv[0], percent: c.nodes! * 100 / total! })),
            { san: "Other", percent: (total - sum) * 100 / total }];
      }
      report("leela", value?.historyVerified ? value : null, body);
    });
  }, 5000);
}
