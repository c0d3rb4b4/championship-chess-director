// Run via node --import tsx. Input is a local JSON recording with ordered packets.
import { readFileSync } from "node:fs";
import { decodeGame } from "../src/server/providers/game.ts";
import { LeelaReplay } from "../src/server/providers/leela.ts";
import { SesseFullSnapshotRequired, SesseReplay } from "../src/server/providers/sesse.ts";
import { ProviderCoverage } from "./provider-coverage.mjs";

const [path, mode, ...extra] = process.argv.slice(2);
if (!path || (mode !== undefined && mode !== "--coverage") || extra.length)
  throw Error("Usage: node --import tsx scripts/replay-providers.mjs RECORDING [--coverage]");
const coverage = mode === "--coverage" ? new ProviderCoverage() : undefined;
const recording = JSON.parse(readFileSync(path, "utf8"));
const leela = new LeelaReplay();
let game, sesse, subscription, connection;
const usedConnections = new Set();
let authorityDisconnected = false;
let lastReceipt = -Infinity;
for (const packet of recording.packets) {
  const { source, receivedMs, body } = packet;
  if (!Number.isFinite(receivedMs) || receivedMs < lastReceipt) throw Error("Unordered receipt");
  lastReceipt = receivedMs;
  // During an authority gap only a new bound PGN can establish the root.
  if (authorityDisconnected && source !== "authority") continue;
  let observation;
  switch (source) {
    case "authority": {
      if (packet.event === "disconnect") {
        if (packet.authority !== recording.binding.authority || packet.gameId !== recording.binding.gameId)
          throw Error("Unbound authority disconnect");
        coverage?.disconnect("authority", receivedMs);
        authorityDisconnected = true;
        game = sesse = subscription = connection = undefined;
        leela.disconnect();
        break;
      }
      const next = decodeGame(recording.binding, packet.authority, packet.gameId, body);
      if (!game || JSON.stringify(next.moves) !== JSON.stringify(game.moves)) {
        leela.disconnect();
        connection = subscription = undefined;
        if (sesse) sesse.setGame(next);
        else sesse = new SesseReplay(next);
      }
      authorityDisconnected = false;
      game = observation = next;
      coverage?.authority(next, receivedMs);
      break;
    }
    case "sesse":
      if (!sesse) throw Error("Missing authority");
      if (packet.event === "disconnect") {
        sesse.disconnect();
        coverage?.disconnect("sesse", receivedMs);
      } else {
        if (typeof packet.version !== "string" || !packet.version) throw Error("Missing X-RGLM");
        try {
          observation = sesse.receive(packet.version, packet.base, body, receivedMs);
          coverage?.sesse(packet, observation);
        } catch (error) {
          if (!(error instanceof SesseFullSnapshotRequired)) throw error;
          coverage?.clearEngine("sesse");
          console.error(`Sesse packet at ${receivedMs}: full snapshot required`);
        }
      }
      break;
    case "leela":
      if (!game) throw Error("Missing authority");
      if (packet.event === "subscribe") {
        if (!Number.isSafeInteger(packet.connection) || packet.gameId !== recording.leelaGameId ||
            (packet.ply !== undefined && packet.ply !== game.moves.length))
          throw Error("Unbound subscription");
        if (usedConnections.has(packet.connection)) throw Error("Reused Leela connection generation");
        usedConnections.add(packet.connection);
        coverage?.clearEngine("leela");
        connection = packet.connection;
        subscription = leela.subscribe(packet.gameId, game);
      } else if (subscription && packet.connection === connection) {
        if (packet.event === "disconnect") {
          leela.disconnect();
          connection = subscription = undefined;
          if (packet.reason !== "authority root changed") coverage?.disconnect("leela", receivedMs);
        } else {
          observation = subscription(body);
          coverage?.leela(packet, observation);
        }
      }
      break;
    default: throw Error("Unknown source");
  }
  if (observation && !coverage) console.log(JSON.stringify({ source, receivedMs, observation }));
}

if (coverage) {
  const report = coverage.report();
  console.log(JSON.stringify(report, null, 2));
  if (report.pending.length) process.exitCode = 2;
}
