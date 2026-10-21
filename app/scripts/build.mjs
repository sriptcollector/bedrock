// Bundles main, preload, renderer and the index worker with esbuild, and copies static assets.
// Usage: node scripts/build.mjs [--watch] [--prod]
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const root = path.resolve(app, "..");
const out = path.join(app, "dist");
const watch = process.argv.includes("--watch");
const prod = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const nm = (p) => path.join(root, "node_modules", p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "renderer", "vendor"), { recursive: true });

const brand = JSON.parse(fs.readFileSync(path.join(root, "brand.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
const define = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __DEV__: JSON.stringify(!prod),
};

const common = {
  bundle: true,
  sourcemap: prod ? false : "linked",
  minify: prod,
  logLevel: "info",
  define,
  loader: { ".svg": "text" },
};

const builds = [
  {
    ...common,
    entryPoints: { main: path.join(app, "src/main/index.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "@napi-rs/keyring", "electron-updater"],
  },
  {
    ...common,
    entryPoints: { preload: path.join(app, "src/preload/index.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  },
  {
    // The `bedrock` command line and stdio MCP server (run by the installed shim in Node mode).
    ...common,
    entryPoints: { cli: path.join(app, "src/cli/entry.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...common,
    entryPoints: { "index-worker": path.join(app, "src/core/index-worker.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
  },
  {
    // The renderer runs with nodeIntegration (like Obsidian) so it is a node-platform CJS bundle
    // loaded by a <script> tag; Node builtins and electron stay external `require`s.
    ...common,
    entryPoints: { app: path.join(app, "src/renderer/main.ts") },
    outdir: path.join(out, "renderer"),
    platform: "node",
    // IIFE so top-level names don't collide with window globals (window.top etc.); `require` is
    // the renderer's global Node require.
    format: "iife",
    target: "chrome140",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: { app: path.join(app, "src/renderer/theme/app.css") },
    outdir: path.join(out, "renderer"),
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  },
];

function copyStatic() {
  fs.copyFileSync(path.join(app, "src/renderer/index.html"), path.join(out, "renderer/index.html"));
  fs.copyFileSync(path.join(root, "brand.json"), path.join(out, "brand.json"));
  // KaTeX css + fonts, mermaid UMD bundle (loaded on demand).
  const kdir = path.join(out, "renderer/vendor/katex");
  fs.mkdirSync(kdir, { recursive: true });
  fs.copyFileSync(nm("katex/dist/katex.min.css"), path.join(kdir, "katex.min.css"));
  fs.cpSync(nm("katex/dist/fonts"), path.join(kdir, "fonts"), { recursive: true });
  fs.copyFileSync(nm("mermaid/dist/mermaid.min.js"), path.join(out, "renderer/vendor/mermaid.min.js"));
  // App icons for the window and tray.
  const icons = path.join(app, "build-res");
  for (const f of ["icon.png", "tray.png", "tray@2x.png", "trayTemplate.png", "trayTemplate@2x.png", "icon.ico"]) {
    if (fs.existsSync(path.join(icons, f))) fs.copyFileSync(path.join(icons, f), path.join(out, f));
  }
  // Command-line shims shipped next to the executable (electron-builder extraFiles -> <install>/bin).
  const bin = path.join(out, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const exe = brand.exeName + ".exe";
  fs.writeFileSync(
    path.join(bin, brand.exeName + ".cmd"),
    ["@echo off", "setlocal", "set ELECTRON_RUN_AS_NODE=1", `"%~dp0..\\${exe}" "%~dp0..\\resources\\app.asar\\dist\\cli.js" %*`, "exit /b %ERRORLEVEL%", ""].join("\r\n"),
  );
  const credit = path.join(root, brand.inspiredBy?.logoUrl ?? "-");
  if (brand.inspiredBy?.logoUrl && fs.existsSync(credit)) {
    fs.copyFileSync(credit, path.join(out, "renderer", "inspired-by" + path.extname(credit)));
  }
}

const t0 = Date.now();
if (watch) {
  copyStatic();
  for (const b of builds) (await esbuild.context(b)).watch();
  console.log("watching...");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
  console.log(`built ${brand.displayName} ${pkg.version} in ${Date.now() - t0} ms`);
}
