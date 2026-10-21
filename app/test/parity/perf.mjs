// Large-note performance: open a ~1 MB note, then type 40 characters with real key events and
// report the input latency (keydown -> next painted frame) and the open time. Works against
// Bedrock and the reference app: node test/parity/perf.mjs <port> [--mode live|source|preview]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, typeText } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 9734);
const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "live";

function bigNote(targetBytes = 1_000_000) {
  const parts = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const block =
      i % 10 === 0
        ? `## Section ${i}\n\nSome **bold** text, *italic*, a [[Welcome|link]], \`code\` and a #tag here.\n\n`
        : i % 10 === 3
          ? `- item ${i} with ==highlight==\n- [ ] task ${i}\n\t- nested ${i}\n\n`
          : i % 10 === 6
            ? "| a | b |\n| - | - |\n| " + i + " | x |\n\n"
            : `Paragraph ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n`;
    parts.push(block);
    size += block.length;
    i++;
  }
  return parts.join("");
}

const c = await connect(port);
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await c.evaluate(fs.readFileSync(path.join(here, "probe.js"), "utf8"));
const text = bigNote();
await c.evaluate(`(async()=>{let f=app.vault.getAbstractFileByPath('Perf big.md'); if(!f) f=await app.vault.create('Perf big.md', ${JSON.stringify(text)}); else await app.vault.modify(f, ${JSON.stringify(text)}); return true})()`);
// Open (from a small note so the view really loads the big one).
await c.evaluate(`__parity.open('Welcome.md', 'live')`);
await sleep(500);
const openMs = await c.evaluate(`(async()=>{const f=app.vault.getAbstractFileByPath('Perf big.md'); const t0=performance.now(); const leaf=app.workspace.getLeaf(false); await leaf.openFile(f,{active:true, state:{mode:${JSON.stringify(mode === "preview" ? "preview" : "source")}, source:${mode === "source"}}}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return performance.now()-t0})()`);
await sleep(800);
let latencies = [];
if (mode !== "preview") {
  await c.evaluate(`(()=>{const v=app.workspace.activeLeaf.view; v.editor.focus(); v.editor.setCursor({line: Math.floor(v.editor.lineCount()/2), ch: 0}); window.__lat=[]; window.addEventListener('keydown', (e)=>{const t0=performance.now(); requestAnimationFrame(()=>setTimeout(()=>window.__lat.push(performance.now()-t0),0));}, true); return true})()`);
  await sleep(300);
  // One key every 120 ms (a fast typist) so latencies don't include queueing behind earlier keys.
  for (const ch of "The quick brown fox jumps over the lazy dog") {
    await typeText(c, ch);
    await sleep(120);
  }
  await sleep(800);
  latencies = await c.evaluate("window.__lat");
}
const sorted = latencies.slice().sort((a, b) => a - b);
const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(1) : "-");
const docLen = await c.evaluate("app.workspace.activeLeaf.view.editor?.getValue().length ?? 0");
console.log(JSON.stringify({ port, mode, bytes: text.length, docLen, openMs: Math.round(openMs), keys: latencies.length, p50: pct(50), p95: pct(95), max: pct(100) }));
c.close();
