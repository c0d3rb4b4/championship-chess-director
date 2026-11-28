import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createBroadcastServer } from "./http.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be 1–65535");
const dbPath = process.env.BROADCAST_DB ?? process.env.DEMO_DB ?? resolve("data/demo.sqlite");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const app = createBroadcastServer({
  dbPath,
  startInDemo: process.env.START_IN_DEMO === "1",
  delayMs: Number(process.env.PROGRAMME_DELAY_SECONDS ?? 0) * 1000,
  cataloguePath: process.env.CHAMPIONSHIP_CATALOGUE,
  publicDir: resolve("dist/public"),
});
app.server.listen(port, "127.0.0.1", () => {
  console.log(`Programme: http://127.0.0.1:${port}/programme`);
  console.log(`Local operator: http://127.0.0.1:${port}/operator`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
