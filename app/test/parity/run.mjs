// Editor behaviour-diff harness. Drives Bedrock and the reference app (an isolated instance of
// the original, started separately with --remote-debugging-port) with the SAME key sequences
// on the same note, then compares document text, cursor/selection and what the editor shows
// (rendered text per line, i.e. which markup is hidden, plus HyperMD-* line classes).
//
// Usage:
//   node test/parity/run.mjs [--ref-port 9733] [--bedrock-port 9734] [--filter <substr>] [--write]
//   node test/parity/run.mjs --explore "<doc with ‸>" "type:abc" "key:Enter" ...   (prints both)
// Bedrock is launched automatically on --bedrock-port with a temp copy of --vault (default: the
// reference vault path given by --vault, else test/fixtures/vault) unless it is already running.
// --write regenerates the results table in docs/PARITY-EDITOR.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, waitForPort, press, typeText, sleep, listTargets } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const repoDir = path.resolve(appDir, "..");
const arg = (name, def) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def);
const refPort = Number(arg("--ref-port", 9733));
const brPort = Number(arg("--bedrock-port", 9734));
const filter = arg("--filter", null);
const write = process.argv.includes("--write");
const exploreAt = process.argv.indexOf("--explore");
const only = arg("--only", null); // "ref" | "bedrock"
const NOTE = "Parity test.md";
const { cases } = await import(pathToFileURL(path.resolve(arg("--cases", path.join(here, "cases.mjs")))).href);

async function startBedrock() {
  try {
    const t = await listTargets(brPort);
    if (t.some((x) => x.type === "page")) return null;
  } catch {
    /* not running */
  }
  const src = arg("--vault", path.join(appDir, "test", "fixtures", "vault"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-parity-"));
  const vault = path.join(tmp, "vault");
  fs.cpSync(src, vault, { recursive: true, preserveTimestamps: true });
  const electronPath = (await import("electron")).default;
  const child = spawn(electronPath, [appDir, "--smoke-test", "--vault", vault, `--remote-debugging-port=${brPort}`], {
    env: { ...process.env, BEDROCK_USER_DATA: path.join(tmp, "userdata"), BEDROCK_NO_UPDATE: "1" },
    stdio: "ignore",
    detached: process.argv.includes("--keep"),
  });
  await waitForPort(brPort);
  return child;
}

async function attach(port, reload = false) {
  let c = await connect(port, (pages) => pages.find((p) => !/devtools/.test(p.url)) ?? pages[0]);
  if (reload) {
    await c.evaluate("location.reload(), true").catch(() => {});
    c.close();
    await sleep(1500);
    c = await connect(port, (pages) => pages.find((p) => !/devtools/.test(p.url)) ?? pages[0]);
  }
  for (let i = 0; i < 100; i++) {
    if (await c.evaluate("!!(window.app && app.workspace && app.workspace.layoutReady)").catch(() => false)) break;
    await sleep(200);
  }
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await c.evaluate(fs.readFileSync(path.join(here, "probe.js"), "utf8"));
  return c;
}

async function runCase(c, cs) {
  // Park the mouse in a corner so Ctrl-chords never trigger hover previews over links.
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 400 });
  await c.evaluate(`__parity.open(${JSON.stringify(NOTE)}, ${JSON.stringify(cs.mode ?? "live")})`);
  for (const [k, v] of Object.entries(cs.config ?? {})) await c.evaluate(`__parity.setConfig(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
  await c.evaluate(`__parity.setDoc(${JSON.stringify(cs.doc)})`);
  for (const step of cs.steps ?? []) {
    const i = step.indexOf(":");
    const kind = i < 0 ? step : step.slice(0, i);
    const val = i < 0 ? "" : step.slice(i + 1);
    if (kind === "type") await typeText(c, val);
    else if (kind === "key") for (const k of val.split(" ")) await press(c, k);
    else if (kind === "cmd") await c.evaluate(`__parity.command(${JSON.stringify(val)})`);
    else if (kind === "wait") await sleep(Number(val));
    else if (kind === "blur") await c.evaluate("__parity.blur()");
    else if (kind === "focus") await c.evaluate("__parity.focus()");
    await sleep(40);
  }
  await sleep(cs.settle ?? 250);
  const st = await c.evaluate("__parity.state()");
  for (const [re, rep] of cs.normalize ?? []) {
    st.doc = st.doc.replace(new RegExp(re, "g"), rep);
    for (const l of st.lines) l.text = l.text.replace(new RegExp(re, "g"), rep);
  }
  if (st.suggest.length) await press(c, "Escape");
  for (const [k] of Object.entries(cs.config ?? {})) await c.evaluate(`__parity.setConfig(${JSON.stringify(k)}, undefined)`);
  return st;
}

const fmtLines = (st) => st.lines.map((l) => l.text).join("⏎");
const fmtCls = (st) => st.lines.map((l) => l.cls).join("|");

function compare(cs, ref, br) {
  const checks = cs.compare ?? ["doc", "lines"];
  const diffs = [];
  if (checks.includes("doc") && ref.doc !== br.doc) diffs.push("doc");
  if (checks.includes("lines") && fmtLines(ref) !== fmtLines(br)) diffs.push("lines");
  if (checks.includes("classes") && fmtCls(ref) !== fmtCls(br)) diffs.push("classes");
  if (checks.includes("suggest") && JSON.stringify(ref.suggest.slice(0, cs.suggestTop ?? 5)) !== JSON.stringify(br.suggest.slice(0, cs.suggestTop ?? 5))) diffs.push("suggest");
  return diffs;
}

const show = (label, st) => {
  console.log(`  ${label} doc:   ${JSON.stringify(st.doc)}`);
  console.log(`  ${label} lines: ${JSON.stringify(fmtLines(st))}`);
  console.log(`  ${label} cls:   ${JSON.stringify(fmtCls(st))}`);
  if (st.suggest.length) console.log(`  ${label} suggest: ${JSON.stringify(st.suggest.slice(0, 8))}`);
};

const child = only === "ref" ? null : await startBedrock();
const ref = only === "bedrock" ? null : await attach(refPort);
const br = only === "ref" ? null : await attach(brPort, process.argv.includes("--reload"));
try {
  if (exploreAt >= 0) {
    const doc = process.argv[exploreAt + 1];
    const steps = process.argv.slice(exploreAt + 2).filter((s, i, a) => !s.startsWith("--") && !(i > 0 && a[i - 1].startsWith("--")));
    const cs = { doc, steps, mode: arg("--mode", "live") };
    if (ref) show("REF", await runCase(ref, cs));
    if (br) show("BR ", await runCase(br, cs));
  } else {
    const results = [];
    for (const cs of cases) {
      if (filter && !(cs.id + " " + cs.name + " " + cs.group).toLowerCase().includes(filter.toLowerCase())) continue;
      const r = ref ? await runCase(ref, cs) : null;
      const b = br ? await runCase(br, cs) : null;
      const diffs = r && b ? compare(cs, r, b) : [];
      results.push({ ...cs, ref: r, bedrock: b, match: diffs.length === 0, diffs });
      console.log(`${diffs.length ? "DIFF" : "same"} ${cs.id} ${cs.name}${diffs.length ? "  [" + diffs.join(",") + "]" : ""}`);
      if (diffs.length || process.argv.includes("--verbose")) {
        if (r) show("REF", r);
        if (b) show("BR ", b);
      }
    }
    const n = results.filter((x) => x.match).length;
    console.log(`\n${n}/${results.length} behaviours match`);
    const outDir = path.join(appDir, "test", "out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "parity-editor.json"), JSON.stringify(results, null, 1));
    if (write && !filter) writeDoc(results);
  }
} finally {
  ref?.close();
  br?.close();
  if (child && !process.argv.includes("--keep")) child.kill();
  if (child && process.argv.includes("--keep")) child.unref();
}

function writeDoc(results) {
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "⏎");
  const summary = (st, cs) => {
    if (!st) return "";
    const parts = [];
    const checks = cs.compare ?? ["doc", "lines"];
    if (checks.includes("doc")) parts.push("`" + esc(st.doc) + "`");
    if (checks.includes("lines")) parts.push("shows `" + esc(fmtLines(st)) + "`");
    if (checks.includes("suggest")) parts.push("suggest `" + esc(st.suggest.slice(0, cs.suggestTop ?? 5).join(" / ")) + "`");
    if (checks.includes("classes")) parts.push("classes `" + esc(fmtCls(st)) + "`");
    return parts.join("<br>");
  };
  const n = results.filter((x) => x.match).length;
  const groups = [...new Set(results.map((r) => r.group))];
  let md = `# Editor behaviour parity\n\nGenerated by \`node app/test/parity/run.mjs --write\` (${new Date().toISOString().slice(0, 10)}): the same key\nsequences typed into Bedrock and into an isolated instance of the original app (1.14.4) on the\nsame note, comparing document text (\`‸\` = cursor, \`«»\` = selection) and what each editor shows\nper line (hidden markup removed, \`☐/☑\` checkbox, \`•\` bullet, \`⟦…⟧\` block widget).\n\n**${n} / ${results.length} behaviours match.**\n`;
  for (const g of groups) {
    md += `\n## ${g}\n\n| Behaviour | Start / keys | Original | Bedrock | Match |\n|---|---|---|---|---|\n`;
    for (const r of results.filter((x) => x.group === g)) {
      md += `| ${esc(r.name)} | \`${esc(r.doc)}\`<br>${esc((r.steps ?? []).join(", "))}${r.mode === "source" ? " (source mode)" : ""} | ${summary(r.ref, r)} | ${summary(r.bedrock, r)} | ${r.match ? "yes" : "**no**"} |\n`;
    }
  }
  fs.writeFileSync(path.join(repoDir, "docs", "PARITY-EDITOR.md"), md);
  console.log("wrote docs/PARITY-EDITOR.md");
}
