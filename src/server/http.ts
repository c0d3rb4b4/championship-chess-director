import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Broadcast, CommandError } from "./broadcast.js";
import { Store } from "./store.js";
import type { Command } from "../shared/types.js";

const commands: Command[] = [
  "restart",
  "cue-spotlight",
  "release-move",
  "return-live",
];
export function createBroadcastServer(options: {
  dbPath: string;
  publicDir: string;
  now?: () => number;
  wallNow?: () => number;
  request?: typeof fetch;
  cataloguePath?: string;
  startInDemo?: boolean;
}) {
  const store = new Store(options.dbPath);
  const clients = new Set<ServerResponse>();
  let output: Broadcast;
  try {
    output = new Broadcast(store, options, broadcast);
  } catch (error) {
    store.close();
    throw error;
  }
  function broadcast() {
    const current = output.current;
    const data = `id: ${current.sequence}\nevent: snapshot\ndata: ${JSON.stringify(current)}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 256 * 1024) {
        client.destroy();
        clients.delete(client);
      } else client.write(data);
    }
  }
  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  }
  function localRequest(req: IncomingMessage): boolean {
    const host = req.headers.host?.split(":")[0];
    return (
      (host === "127.0.0.1" || host === "localhost") &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    );
  }
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
    );
    if (!localRequest(req)) {
      json(res, 403, { error: "This broadcast server is loopback only" });
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (req.method === "GET" && path === "/") {
        res.writeHead(302, { Location: "/operator" });
        res.end();
        return;
      }
      if (req.method === "GET" && path === "/api/programme") {
        json(res, 200, output.current);
        return;
      }
      if (req.method === "GET" && path === "/api/operator") {
        json(res, 200, output.operator());
        return;
      }
      if (req.method === "GET" && path === "/api/programme/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        const current = output.current;
        res.write(
          `retry: 1000\nid: ${current.sequence}\nevent: snapshot\ndata: ${JSON.stringify(current)}\n\n`,
        );
        clients.add(res);
        res.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "POST" && path === "/api/operator/command") {
        const origin = req.headers.origin;
        if (
          (origin && origin !== `http://${req.headers.host}`) ||
          req.headers["sec-fetch-site"] === "cross-site" ||
          req.headers["content-type"]?.split(";")[0] !== "application/json"
        ) {
          json(res, 403, {
            error: "Commands require a same-origin JSON request",
          });
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 4096) {
            json(res, 413, { error: "Command too large" });
            return;
          }
        }
        let input: {
          id?: string;
          command?: Command | "select-game" | "enter-demo" | "clear-selection";
          gameId?: string;
          selectionEpoch?: number;
          epoch?: number;
          revision?: number;
        };
        try {
          input = JSON.parse(body);
        } catch {
          json(res, 400, { error: "Invalid JSON command" });
          return;
        }
        if (
          !input ||
          typeof input.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(input.id) ||
          !Number.isSafeInteger(input.selectionEpoch) || input.selectionEpoch! < 0
        ) {
          json(res, 400, { error: "Invalid command ID or selection epoch" });
          return;
        }
        const { command, id, selectionEpoch } = input;
        let duplicate: boolean;
        if (command === "select-game" || command === "enter-demo" || command === "clear-selection") {
          duplicate = output.select(id, command, selectionEpoch!, input.gameId);
        } else if (command && commands.includes(command)) {
          duplicate = output.cue(id, command, selectionEpoch!, input.epoch, input.revision);
        } else {
          json(res, 400, { error: "Unknown command" });
          return;
        }
        json(res, 200, { duplicate, programme: output.current });
        return;
      }
      const assets: Record<string, [string, string]> = {
        "/programme": ["index.html", "text/html; charset=utf-8"],
        "/operator": ["index.html", "text/html; charset=utf-8"],
        "/app.js": ["app.js", "text/javascript; charset=utf-8"],
        "/styles.css": ["styles.css", "text/css; charset=utf-8"],
      };
      const flag = path.match(/^\/flags\/([a-z]{2})\.svg$/);
      const asset = flag ? [`flags/${flag[1]}.svg`, "image/svg+xml"] : assets[path];
      if (req.method === "GET" && asset) {
        const content = await readFile(resolve(options.publicDir, asset[0])).catch(error => {
          if (flag && error.code === "ENOENT") return;
          throw error;
        });
        if (!content) {
          json(res, 404, { error: "Not found" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": asset[1],
          "Cache-Control": "no-cache",
        });
        res.end(content);
        return;
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof CommandError) {
        json(res, error.status, { error: error.message });
        return;
      }
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
      else res.end();
    }
  });
  let heartbeat = 0;
  const interval = setInterval(() => {
    const previous = output.current;
    output.tick();
    // Keep idle viewers connected without sending ten identical slates a second.
    if (output.current !== previous || ++heartbeat >= 10) {
      heartbeat = 0;
      broadcast();
    }
  }, 100);
  return {
    server,
    tick: () => {
      output.tick();
      broadcast();
      return output.current;
    },
    close: async () => {
      clearInterval(interval);
      output.stop();
      for (const client of clients) client.end();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        // Browsers can still hold speculative connections during navigation or SSE recovery.
        // Stop accepting connections before closing the remaining sockets on shutdown.
        server.closeAllConnections();
      });
      store.close();
    },
  };
}
