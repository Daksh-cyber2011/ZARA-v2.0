/**
 * MYRAA server bundle builder.
 * Bundles server/server.ts → dist/server.cjs with esbuild so the packaged
 * Electron app can run the backend with its own Node runtime
 * (ELECTRON_RUN_AS_NODE=1), exactly like the reference build.
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "dist");

fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "server", "server.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(outDir, "server.cjs"),
  sourcemap: true,
  external: ["vite", "lightningcss", "esbuild"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

console.log("[build-server] wrote dist/server.cjs");
