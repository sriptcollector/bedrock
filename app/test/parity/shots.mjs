// Side-by-side screenshots of the same note in the reference app and in Bedrock.
// node test/parity/shots.mjs <outDir> <name> <note path> [--doc "<text with ‸>"] [--mode live|source|preview] [--theme light|dark]
// Writes <outDir>/<name>-ref.png and <name>-bedrock.png (editor pane only), then stitches them
// into <name>.png with PowerShell/System.Drawing when available.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connect, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, name, note] = process.argv.slice(2);
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const doc = arg("--doc", null);
const mode = arg("--mode", "live");
const theme = arg("--theme", null);
const blur = process.argv.includes("--blur");
fs.mkdirSync(outDir, { recursive: true });

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms))]);
async function shoot(port, file) {
  const c = await connect(port, (pages) => pages.find((p) => !/devtools/.test(p.url)) ?? pages[0]);
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // A minimised window produces no frames (screenshots hang): restore it when we can.
  await c.evaluate("(()=>{try{const w=require('@electron/remote').getCurrentWindow(); if(w.isMinimized()||!w.isVisible()){w.restore();w.showInactive();}}catch{}})()").catch(() => {});
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await c.evaluate(fs.readFileSync(path.join(here, "probe.js"), "utf8"));
  if (theme) await c.evaluate(`(()=>{document.body.classList.toggle('theme-dark', ${theme === "dark"}); document.body.classList.toggle('theme-light', ${theme !== "dark"});})()`);
  await withTimeout(c.evaluate(`__parity.open(${JSON.stringify(note)}, ${JSON.stringify(mode === "source" ? "source" : "live")})`), 15000, "open");
  if (doc !== null) await c.evaluate(`__parity.setDoc(${JSON.stringify(doc)})`);
  if (mode === "preview") await c.evaluate(`(async()=>{const l=app.workspace.activeLeaf; const s=l.getViewState(); s.state={...s.state, mode:'preview'}; await l.setViewState(s);})()`);
  if (blur) await c.evaluate("__parity.blur()");
  await sleep(900);
  const rect = await c.evaluate(`(()=>{const e=document.querySelector('.workspace-leaf.mod-active .view-content')||document.querySelector('.workspace-leaf.mod-active'); const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`);
  fs.writeFileSync(file, await withTimeout(c.screenshot(rect), 15000, "screenshot " + port));
  await c.send("Emulation.clearDeviceMetricsOverride");
  c.close();
}

const ref = path.join(outDir, `${name}-ref.png`);
const br = path.join(outDir, `${name}-bedrock.png`);
await shoot(Number(arg("--ref-port", 9733)), ref);
await shoot(Number(arg("--bedrock-port", 9734)), br);
const out = path.join(outDir, `${name}.png`);
const ps = `
Add-Type -AssemblyName System.Drawing
$a=[System.Drawing.Image]::FromFile('${ref}'); $b=[System.Drawing.Image]::FromFile('${br}')
$w=$a.Width+$b.Width+24; $h=[Math]::Max($a.Height,$b.Height)+36
$bmp=New-Object System.Drawing.Bitmap $w,$h; $g=[System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(40,40,40))
$f=New-Object System.Drawing.Font 'Segoe UI',11; $br=[System.Drawing.Brushes]::White
$g.DrawString('Original (reference)',$f,$br,8,8); $g.DrawString('Bedrock',$f,$br,$a.Width+32,8)
$g.DrawImage($a,0,30); $g.DrawImage($b,$a.Width+24,30)
$bmp.Save('${out}',[System.Drawing.Imaging.ImageFormat]::Png); $a.Dispose(); $b.Dispose(); $g.Dispose(); $bmp.Dispose()
`;
try {
  execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
  console.log("wrote", out);
} catch {
  console.log("wrote", ref, br);
}
