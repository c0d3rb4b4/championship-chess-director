import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Director } from "./director.js";
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
}) {
  const now = options.now ?? (() => performance.now());
  const store = new Store(options.dbPath);
  const director = new Director(store.load());
  let baseMs = director.checkpoint().elapsedMs;
  let anchor = now();
  let current = director.snapshot();
  let lastPersistedSecond = -1;
  const clients = new Set<ServerResponse>();
  function refresh() {
    current = director.advanceTo(baseMs + Math.max(0, now() - anchor));
    // The demo resumes at its persisted presentation time after server downtime.
    const second = Math.floor(current.presentationMs / 1000);
    if (second !== lastPersistedSecond) {
      store.save(director.checkpoint());
      lastPersistedSecond = second;
    }
    return current;
  }
  function broadcast() {
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
      json(res, 403, { error: "This rehearsal server is loopback only" });
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
        json(res, 200, current);
        return;
      }
      if (req.method === "GET" && path === "/api/operator") {
        json(res, 200, director.operator(current, store.count));
        return;
      }
      if (req.method === "GET" && path === "/api/programme/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
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
          command?: Command;
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
          !commands.includes(input.command!)
        ) {
          json(res, 400, { error: "Invalid command or command ID" });
          return;
        }
        const prior = store.getCommand(input.id);
        if (prior) {
          if (prior.command !== input.command || prior.epoch !== input.epoch) {
            json(res, 409, {
              error: "Command ID was already used for another request",
            });
            return;
          }
          json(res, 200, { duplicate: true, programme: current });
          return;
        }
        if (
          input.epoch !== current.game.epoch ||
          input.revision !== current.game.revision
        ) {
          json(res, 409, {
            error: "Game changed; refresh before issuing this command",
          });
          return;
        }
        const previous = director.checkpoint();
        try {
          const next = director.command(input.command!);
          store.commitCommand(
            input.id,
            input.command!,
            input.epoch,
            director.checkpoint(),
          );
          current = next;
        } catch (error) {
          // A failed durable write must never leak a partially applied command on air.
          director.restore(previous);
          json(res, 409, {
            error: error instanceof Error ? error.message : "Command rejected",
          });
          return;
        }
        baseMs = current.presentationMs;
        anchor = now();
        broadcast();
        json(res, 200, { duplicate: false, programme: current });
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
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
      else res.end();
    }
  });
  const interval = setInterval(() => {
    refresh();
    broadcast();
  }, 100);
  return {
    server,
    tick: () => {
      refresh();
      broadcast();
      return current;
    },
    close: async () => {
      clearInterval(interval);
      store.save(director.checkpoint());
      for (const client of clients) client.end();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
    },
  };
}
