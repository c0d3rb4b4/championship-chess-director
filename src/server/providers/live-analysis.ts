import { setTimeout as sleep } from "node:timers/promises";
import type { CatalogueGame } from "../../shared/catalogue.js";
import type { EngineId, LiveAnalysis } from "../../shared/types.js";
import type { Game } from "./game.js";
import { LeelaReplay } from "./leela.js";
import { SesseReplay } from "./sesse.js";
import { leelaUrl, listenToLeela, sesseUrl, type CaptureSocket } from "./transport.js";

export interface AnalysisTransport {
  request?: typeof fetch;
  openSocket?: (url: string) => CaptureSocket;
}

// A root owns both sessions. Aborting it fences late HTTP responses and socket callbacks.
export function followAnalysis(selected: CatalogueGame, game: Game, signal: AbortSignal, transport: AnalysisTransport,
    report: (source: EngineId, analysis: LiveAnalysis | null, raw: unknown) => void) {
  const binding = selected.binding!;
  const request = transport.request ?? fetch;
  async function run(source: EngineId, read: () => Promise<void>, retryMs: number) {
    while (!signal.aborted) {
      try { await read(); }
      catch (error) {
        if (!signal.aborted) report(source, null, String(error));
      }
      if (!signal.aborted) await sleep(retryMs, undefined, { signal }).catch(() => {});
    }
  }
  const aliases = binding.sessePlayers;
  if (aliases) void run("sesse", async () => {
    const decoder = new SesseReplay({ ...game, binding: { ...game.binding, sessePlayers: aliases } });
    let base: string | undefined;
    while (!signal.aborted) {
      const url = new URL(sesseUrl);
      if (base !== undefined) url.searchParams.set("ims", base);
      const response = await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]) });
      if (!response.ok) throw Error(`Sesse HTTP ${response.status}`);
      const version = response.headers.get("x-rglm");
      if (!version) throw Error("Missing Sesse version");
      const body = await response.json();
      if (signal.aborted) return;
      const update = decoder.receive(version, base, body, Date.now());
      base = version;
      const p = update?.principal, score = p?.score;
      const whiteScore = score?.unit === "pawns" ? `${score.bound ?? ""}${score.value >= 0 ? "+" : ""}${score.value.toFixed(2)}`
        : score?.unit === "mate" ? `${score.bound ?? ""}M${score.value}` : score?.unit === "tablebase-draw" ? "Tablebase draw" : undefined;
      report("sesse", p ? { line: p.pv, depth: p.depth, whiteScore, pawns: score?.unit === "pawns" && !score.bound ? score.value : undefined } : null, { version, body });
      await sleep(1000, undefined, { signal });
    }
  }, 15_000);
  void run("leela", async () => {
    const socket = (transport.openSocket ?? (url => new WebSocket(url)))(leelaUrl);
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
        receive = new LeelaReplay().subscribe(gameId, game);
        socket.send(JSON.stringify({ gameId, ply: game.moves.length }));
      }
      const update = receive(body);
      const candidate = update?.candidates.find(c => c.evalId === update.evalId);
      report("leela", candidate ? { line: candidate.pv } : null, body);
    });
  }, 5000);
}
