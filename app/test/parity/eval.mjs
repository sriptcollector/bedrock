// Evaluate an expression in a running app over CDP: node test/parity/eval.mjs <port> "<js>"
// (the parity probe is injected first, so __parity.* is available).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [port, expr] = process.argv.slice(2);
const c = await connect(Number(port), (pages) => pages.find((p) => !/devtools/.test(p.url)) ?? pages[0]);
try {
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await c.evaluate(fs.readFileSync(path.join(here, "probe.js"), "utf8"));
  const v = await c.evaluate(fs.existsSync(expr) ? fs.readFileSync(expr, "utf8") : expr);
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
} finally {
  c.close();
}
