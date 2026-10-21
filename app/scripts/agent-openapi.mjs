// Writes the OpenAPI description of the local REST API (built from src/main/agents) into
// docs/AGENT-API.md between the openapi markers. Usage: node app/scripts/agent-openapi.mjs
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = path.join(app, "..", "docs", "AGENT-API.md");
const r = await esbuild.build({ entryPoints: [path.join(app, "src/main/agents/openapi.ts")], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "error" });
const mod = { exports: {} };
new Function("module", "exports", "require", r.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const json = JSON.stringify(mod.exports.buildOpenApi(), null, 2);
const start = "<!-- openapi:start -->";
const end = "<!-- openapi:end -->";
const text = fs.readFileSync(doc, "utf8");
const i = text.indexOf(start);
const j = text.indexOf(end);
if (i < 0 || j < i) throw new Error("docs/AGENT-API.md has no openapi markers");
fs.writeFileSync(doc, text.slice(0, i + start.length) + "\n```json\n" + json + "\n```\n" + text.slice(j));
console.log(`wrote ${json.length} bytes of OpenAPI into ${path.relative(process.cwd(), doc)}`);
