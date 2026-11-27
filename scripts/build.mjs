import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
});
await build({
  entryPoints: ["src/client/app.ts"],
  outfile: "dist/public/app.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  sourcemap: true,
});
await copyFile("src/client/index.html", "dist/public/index.html");
await copyFile("src/client/styles.css", "dist/public/styles.css");
await cp("node_modules/flag-icons/flags/4x3", "dist/public/flags", { recursive: true });
await copyFile("node_modules/flag-icons/LICENSE", "dist/public/flags/LICENSE");
