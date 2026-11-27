import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { decodeGame, type Binding, type Game } from "../src/server/providers/game.js";
import { SesseReplay } from "../src/server/providers/sesse.js";

interface CaptureConfig {
  roundId: string;
  binding: Binding;
}

type Source = "authority" | "sesse" | "leela";

interface Packet {
  source: Source;
  [field: string]: unknown;
}

class OperatorReconnect extends Error {
  constructor() { super("operator requested reconnect"); }
}

function disconnectReason(error: unknown) {
  return error instanceof OperatorReconnect
    ? { reason: error.message, initiatedBy: "operator" }
    : { reason: String(error) };
}

type CaptureSocket = Pick<WebSocket, "addEventListener" | "send" | "close">;
const sesseUrl = "https://analysis.sesse.net/analysis.pl";
const leelaUrl = "wss://live.lczero.org/api/ws";
const wait = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal });

function matchesChapter(value: unknown, config: CaptureConfig) {
  const url = typeof value === "string" && URL.parse(value);
  return !!url && url.origin === "https://lichess.org" &&
    url.pathname.endsWith(`/${config.roundId}/${config.binding.gameId}`);
}

function listenToLeela(
  socket: CaptureSocket,
  signal: AbortSignal,
  onFrame: (body: Record<string, unknown>) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const listeners = new AbortController();
    const finish = (error?: unknown) => {
      clearTimeout(idle);
      signal.removeEventListener("abort", stop);
      listeners.abort();
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    const stop = () => finish();
    const startIdleTimer = () => setTimeout(() => finish(Error("Leela socket idle")), 75_000);
    let idle = startIdleTimer();
    const options = { signal: listeners.signal };
    socket.addEventListener("close", () => finish(Error("Leela socket closed")), options);
    socket.addEventListener("error", () => finish(Error("Leela socket error")), options);
    socket.addEventListener("message", event => {
      clearTimeout(idle);
      idle = startIdleTimer();
      try {
        onFrame(JSON.parse(event.data));
      } catch (error) {
        finish(error);
      }
    }, options);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

export async function captureProviders(
  config: CaptureConfig,
  writePacket: (packet: Packet) => void,
  stop: AbortSignal,
  {
    request = fetch, openSocket = (url: string): CaptureSocket => new WebSocket(url), pause = wait,
    reconnects = new Set<Source>(),
  } = {},
) {
  const { binding, roundId } = config;
  const authorityIdentity = { authority: binding.authority, gameId: binding.gameId };
  const authorityUrl = `https://lichess.org/api/broadcast/round/${roundId}.pgn?clocks=true&comments=false`;
  const failed = new AbortController();
  const signal = AbortSignal.any([stop, failed.signal]);
  const diagnose = (source: string, error: unknown) => console.error(`${source}: ${String(error)}`);
  const record = (packet: Packet) => {
    try {
      writePacket(packet);
    } catch (error) {
      failed.abort(error);
      throw error;
    }
  };
  let leelaGameId: number | undefined;
  let generation = 0;
  let active: {
    game: Game;
    lifetime: AbortController;
    root: AbortController;
    sesse: SesseReplay;
    base?: string;
  } | undefined;

  async function authorityLoop() {
    while (!signal.aborted) {
      let retryMs = 15_000;
      let body: string;
      let game: Game;
      let response: Response;
      try {
        if (active && reconnects.delete("authority")) throw new OperatorReconnect();
        response = await request(authorityUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
        if (response.status === 429) retryMs = 60_000;
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        body = await response.text();
        const links = [...body.matchAll(/^\[GameURL "([^"]+)"\]\r?$/gm)];
        if (links.length !== 1 || !matchesChapter(links[0][1], config)) throw Error("Unbound Lichess chapter");
        game = decodeGame(binding, binding.authority, binding.gameId, body);
      } catch (error) {
        if (signal.aborted) return;
        diagnose("Lichess", error);
        if (active) {
          record({ source: "authority", ...authorityIdentity, event: "disconnect", ...disconnectReason(error) });
          active.lifetime.abort();
          active = undefined;
        }
        await pause(retryMs, signal);
        continue;
      }

      if (signal.aborted) return;
      record({ source: "authority", ...authorityIdentity, body, serverDate: response.headers.get("date") });
      if (!active) {
        active = { game, lifetime: new AbortController(), root: new AbortController(), sesse: new SesseReplay(game) };
      } else if (JSON.stringify(game.moves) !== JSON.stringify(active.game.moves)) {
        active.root.abort();
        active.root = new AbortController();
        active.game = game;
        active.sesse.setGame(game);
      }
      await pause(retryMs, signal);
    }
  }

  async function sesseLoop() {
    while (!signal.aborted) {
      const session = active;
      if (!session) {
        await pause(1_000, signal);
        continue;
      }
      const url = new URL(sesseUrl);
      const base = session.base;
      if (base !== undefined) url.searchParams.set("ims", base);
      let retryMs = 1_000;
      let received: Packet | undefined;
      let packet: Packet;
      try {
        if (base !== undefined && reconnects.delete("sesse")) throw new OperatorReconnect();
        const response = await request(url, {
          signal: AbortSignal.any([signal, session.lifetime.signal, AbortSignal.timeout(50_000)]),
        });
        if (response.status === 429) retryMs = 60_000;
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const version = response.headers.get("x-rglm");
        if (!version) throw Error("Missing X-RGLM");
        const body = await response.json();
        if (active !== session || signal.aborted) continue;
        received = { source: "sesse", base, version, body, serverDate: response.headers.get("date") };
        session.sesse.receive(version, base, body, Date.now());
        session.base = version;
        packet = received;
      } catch (error) {
        if (active !== session || signal.aborted) continue;
        diagnose("Sesse", error);
        if (base === undefined) retryMs = Math.max(retryMs, 15_000);
        session.sesse.disconnect();
        session.base = undefined;
        packet = { source: "sesse", event: "disconnect", base, ...disconnectReason(error), discarded: received };
      }
      record(packet);
      await pause(retryMs, signal);
    }
  }

  async function leelaLoop() {
    while (!signal.aborted) {
      const session = active;
      if (!session) {
        await pause(1_000, signal);
        continue;
      }
      const root = AbortSignal.any([signal, session.lifetime.signal, session.root.signal]);
      let connection: number | undefined;
      let requestedReconnect: OperatorReconnect | undefined;
      const ply = session.game.moves.length;
      try {
        const socket = openSocket(leelaUrl);
        await listenToLeela(socket, root, body => {
          if (connection !== undefined && reconnects.delete("leela")) throw new OperatorReconnect();
          if (connection === undefined) {
            const games = Array.isArray(body.games) ? body.games : [];
            const matches = games.filter(game => matchesChapter(game?.feedUrl, config) &&
              String(game.player1?.fideId) === binding.whiteId && String(game.player2?.fideId) === binding.blackId);
            if (matches.length !== 1) return;
            const gameId = matches[0].gameId;
            if (!Number.isSafeInteger(gameId) || gameId < 0 ||
                (leelaGameId !== undefined && leelaGameId !== gameId)) throw Error("Unbound Leela game ID");
            leelaGameId = gameId;
            const subscription = { gameId, ply };
            socket.send(JSON.stringify(subscription));
            connection = ++generation;
            record({ source: "leela", event: "subscribe", connection, ...subscription });
          }
          record({ source: "leela", connection, body });
        });
      } catch (error) {
        if (error instanceof OperatorReconnect) requestedReconnect = error;
        diagnose("Leela", error);
      }
      if (connection !== undefined && !signal.aborted) {
        const detail = requestedReconnect ? disconnectReason(requestedReconnect) : {
          reason: root.aborted ? "authority root changed" : "socket closed",
        };
        record({ source: "leela", connection, event: "disconnect", ...detail });
      }
      if (!root.aborted) await pause(5_000, signal);
    }
  }

  const tasks = [authorityLoop(), sesseLoop(), leelaLoop()].map(async task => {
    try {
      await task;
    } catch (error) {
      if (signal.aborted && error instanceof Error && error.name === "AbortError") return;
      failed.abort(error);
      throw error;
    }
  });
  await Promise.allSettled(tasks);
  if (failed.signal.aborted) throw failed.signal.reason;
  return leelaGameId;
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { interactive: { type: "boolean" } } });
  const [configPath, output, duration = "2700", ...extra] = positionals;
  const seconds = Number(duration);
  if (!configPath || !output || extra.length || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 28_800)
    throw Error("Usage: node --import tsx scripts/capture-providers.ts CONFIG OUTPUT [SECONDS: 1–28800] [--interactive]");
  const config: CaptureConfig = JSON.parse(readFileSync(configPath, "utf8"));
  if (!/^[a-zA-Z0-9]{8}$/.test(config.roundId) || !/^[a-zA-Z0-9]{8}$/.test(config.binding?.gameId))
    throw Error("Provide the eight-character Lichess roundId and binding.gameId (chapter ID)");
  const { binding, roundId } = config;
  const descriptor = openSync(output, "wx", 0o600);
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const reconnects = new Set<Source>();
  const input = values.interactive ? createInterface({ input: process.stdin, terminal: false }) : undefined;
  if (input) {
    const commands = "Commands: reconnect authority | reconnect sesse | reconnect leela";
    console.error(commands);
    input.on("line", line => {
      const [command, source, ...extra] = line.trim().split(/\s+/);
      if (command === "reconnect" && !extra.length && (source === "authority" || source === "sesse" || source === "leela")) {
        reconnects.add(source);
        console.error(`Queued ${source} reconnect`);
      } else if (command) console.error(commands);
    });
  }
  const started = new Date().toISOString();
  let count = 0;
  let leelaGameId: number | undefined;
  try {
    const metadata = { binding, roundId, started, endpoints: { authority: "https://lichess.org", sesse: sesseUrl, leela: leelaUrl } };
    writeFileSync(descriptor, JSON.stringify(metadata).slice(0, -1) + ',\n"packets":[\n');
    leelaGameId = await captureProviders(config, packet => {
      const receivedMs = Math.floor(performance.timeOrigin + performance.now());
      writeFileSync(descriptor, (count++ ? ",\n" : "") + JSON.stringify({ ...packet, receivedMs }));
    }, AbortSignal.any([stop.signal, AbortSignal.timeout(seconds * 1_000)]), { reconnects });
  } finally {
    try {
      writeFileSync(descriptor, `\n],"leelaGameId":${leelaGameId ?? "null"},"ended":"${new Date().toISOString()}"}\n`);
    } finally {
      closeSync(descriptor);
      input?.close();
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
  console.log(`Saved ${count} packets to ${output}`);
  if (count === 0) throw Error("No bound Lichess snapshots were captured");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
