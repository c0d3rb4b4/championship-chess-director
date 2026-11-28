import { Chess } from "chess.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";
import { loadCatalogue } from "../../src/server/catalogue.js";
import { createBroadcastServer } from "../../src/server/http.js";
import type { RealProgramme } from "../../src/shared/types.js";

export type Feeds = "pgn" | "sesse" | "leela" | "both";
class Socket extends EventTarget {
  subscribed = false;
  send() { this.subscribed = true; }
  close() {}
  packet(body: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(body) })); }
}

// Only the upstream transports and wall clock are replaced. Every output passes through the
// normal decoder, journal, selector, director, HTTP server and SSE fanout.
export async function rehearsal(delay: number, feeds: Feeds, pollMs = 1) {
  const directory = await mkdtemp(join(tmpdir(), "unattended-"));
  const catalogue = loadCatalogue(), game = catalogue.games[0], binding = game.binding!;
  catalogue.games = [game, { ...catalogue.games[1], binding: null }];
  if (feeds !== "pgn") {
    binding.elapsedTime = "pgn-emt"; binding.clockConvention = "post-move";
    binding.leelaFields = { rootWdl: true, evaluationVisits: true };
  }
  if (feeds === "both" || feeds === "sesse") binding.sessePlayers = { white: "White", black: "Black" };
  const cataloguePath = join(directory, "rounds.json");
  const dbPath = join(directory, "game.sqlite");
  await writeFile(cataloguePath, JSON.stringify(catalogue));
  const origin = Date.parse(game.scheduledStart!);
  let now = origin, socket: Socket | undefined, generations = 0, port = 0;
  let body = "", status = 200, sesseVersion = 0, sesseNodes = 0;
  let wake: (() => void) | undefined;
  const chapter = `https://lichess.org/broadcast/fixture/game/${binding.roundId}/${binding.chapterId}`;
  const board = new Chess();
  function score(moves: string[], result = "*", seconds = 7200) {
    board.reset();
    for (const san of moves) {
      board.move(san);
      const clock = [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,"0")).join(":");
      board.setComment(`[%clk ${clock}] [%emt 0:00:14]`);
    }
    Object.entries({ Event: binding.events[0], Round: binding.pgnRound, White: "White", Black: "Black",
      WhiteFideId: game.white.id, BlackFideId: game.black.id, GameURL: chapter, Result: result }).forEach(([k,v])=>board.setHeader(k,v));
    body = board.pgn();
    status = 200;
  }
  score(["e4"]);
  const launch = () => createBroadcastServer({ dbPath, cataloguePath, delayMs: delay, pollMs, publicDir: resolve("dist/public"),
    wallNow: () => now,
    request: async input => {
      const url = new URL(String(input));
      if (url.pathname.includes("/round/")) return new Response(body, { status });
      const copy = new Chess(board.fen());
      const line = ["Nf3","Nc6","Bb5","a6","Ba4","Nf6","O-O","Be7"];
      const legal: string[] = [];
      for (const san of line) { try { legal.push(copy.move(san).san); } catch { break; } }
      if (!legal.length) legal.push(copy.moves()[0]);
      const full = { position: { player_w: "White", player_b: "Black", fen: board.fen(), history: board.history() },
        pv: legal, depth: 24, score: ["cp", 23], nodes: sesseNodes };
      // A root replacement is also a legal JSON-delta stanza.
      return Response.json(url.searchParams.has("ims") ? [[[],full]] : full, { headers: { "x-rglm": String(++sesseVersion) } });
    },
    waitForSessePoll: signal => new Promise<void>(resolve => {
      const done = () => { signal.removeEventListener("abort", done); if (wake === done) wake = undefined; resolve(); };
      wake = done;
      signal.addEventListener("abort", done, { once: true });
    }),
    openSocket() { generations++; return socket = new Socket(); },
  });
  let app = launch();
  const listen = async () => {
    await new Promise<void>(ok => app.server.listen(port, "127.0.0.1", ok));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw Error("Missing listener");
    port = addr.port;
    return `http://127.0.0.1:${port}`;
  };
  const base = await listen();
  const tick = async (offset: number) => {
    now = origin + offset;
    app.tick();
    await setImmediate();
    return app.tick() as RealProgramme;
  };
  function engine(work: number) {
    sesseNodes = work;
    wake?.();
    if (feeds === "pgn" || feeds === "sesse" || !socket) return;
    if (!socket.subscribed) socket.packet({ games: [{ gameId: 7, feedUrl: chapter, player1: { fideId: game.white.id }, player2: { fideId: game.black.id } }] });
    const history = board.history({ verbose: true });
    const copy = new Chess(board.fen());
    const line: string[] = [];
    for (const san of ["Bc4","Nf6","d3","Bc5","Nf3","d6","O-O","O-O"]) {
      try { line.push(copy.move(san).lan); } catch { break; }
    }
    while (line.length < 4) {
      const next = copy.moves({ verbose: true })[0];
      if (!next) break;
      line.push(copy.move(next.san).lan);
    }
    socket.packet({ positions: history.map((m, i) => ({ gameId: 7, ply: i + 1, fen: m.after, moveUci: m.lan,
      scoreW: 300, scoreD: 500, scoreB: 200 })),
      evaluations: [{ gameId: 7, ply: history.length, evalId: 1, nodes: work + 10,
        variations: [{ pvUci: line.join(" "), nodes: work }] }] });
  }
  return { base, game, dbPath, board, score, tick, engine, get generations() { return generations; },
    snapshot: async (): Promise<RealProgramme> => (await fetch(base + "/api/programme", { headers: { Connection: "close" } })).json(),
    command: (data: object) => fetch(base + "/api/operator/command", { method: "POST", headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ id: crypto.randomUUID(), ...data }) }),
    outage() { status = 503; },
    restart: async () => { await app.close(); app = launch(); await listen(); },
    // Simulate an unobserved wall-time interval while the process is stopped.
    gap: async (offset: number) => { await app.close(); now = origin + offset; app = launch(); await listen(); },
    close: async () => { await app.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
