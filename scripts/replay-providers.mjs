// Run via node --import tsx. Input is a local JSON recording with ordered packets.
import { readFileSync } from "node:fs";
import { decodeGame } from "../src/server/providers/game.ts";
import { LeelaReplay } from "../src/server/providers/leela.ts";
import { SesseReplay } from "../src/server/providers/sesse.ts";

const recording = JSON.parse(readFileSync(process.argv[2], "utf8"));
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
        authorityDisconnected = true;
        game = sesse = subscription = connection = undefined;
        leela.disconnect();
        break;
      }
      const next = decodeGame(recording.binding, packet.authority, packet.gameId, body);
      if (!game || JSON.stringify(next.moves) !== JSON.stringify(game.moves)) {
        leela.disconnect();
        connection = subscription = undefined;
        sesse = new SesseReplay(next);
      }
      authorityDisconnected = false;
      game = observation = next;
      break;
    }
    case "sesse":
      if (!sesse) throw Error("Missing authority");
      if (packet.event === "disconnect") sesse.disconnect();
      else {
        if (typeof packet.version !== "string" || !packet.version) throw Error("Missing X-RGLM");
        observation = sesse.receive(packet.version, packet.base, body, receivedMs);
      }
      break;
    case "leela":
      if (!game) throw Error("Missing authority");
      if (packet.event === "subscribe") {
        if (!Number.isSafeInteger(packet.connection) || packet.gameId !== recording.leelaGameId)
          throw Error("Unbound subscription");
        if (usedConnections.has(packet.connection)) throw Error("Reused Leela connection generation");
        usedConnections.add(packet.connection);
        connection = packet.connection;
        subscription = leela.subscribe(packet.gameId, game);
      } else if (subscription && packet.connection === connection) {
        if (packet.event === "disconnect") {
          leela.disconnect();
          connection = subscription = undefined;
        } else observation = subscription(body);
      }
      break;
    default: throw Error("Unknown source");
  }
  if (observation) console.log(JSON.stringify({ source, receivedMs, observation }));
}
