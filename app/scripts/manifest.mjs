// Writes ../toolbay.json (the hub install manifest) from brand.json + package.json version.
// CI adds sizes and sha256 for each asset when it publishes a release.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const brand = JSON.parse(fs.readFileSync(path.join(root, "brand.json"), "utf8"));
const { version } = JSON.parse(fs.readFileSync(path.join(here, "../package.json"), "utf8"));
const N = brand.displayName;

const manifest = {
  schema: 1,
  id: brand.slug,
  name: N,
  tagline: "Free notes app that works with your Obsidian vaults, with sync built in.",
  description: `${brand.productTitle}: write in plain Markdown files on your own computer with links, live preview, properties and plugins. Opens existing Obsidian vaults and plugins. Your vault syncs end-to-end encrypted to your other computers through your Toolbay account. No account needed to use it offline, no limits, no telemetry.`,
  version,
  repo: brand.repo,
  identifier: brand.appId,
  license: "MIT",
  homepage: `https://github.com/${brand.repo}`,
  icon: `https://raw.githubusercontent.com/${brand.repo}/main/assets/icon.png`,
  replaces: brand.inspiredBy?.name ?? "",
  inspiredBy: brand.inspiredBy ?? null,
  categories: ["productivity", "notes", "writing"],
  platforms: {
    "windows-x86_64": { asset: `${N}_${version}_x64-setup.exe`, kind: "nsis", silentArgs: ["/S"], exe: `${brand.exeName}.exe`, uninstaller: `Uninstall ${N}.exe` },
    "darwin-aarch64": { asset: `${N}_${version}_arm64.dmg`, kind: "dmg", app: `${N}.app` },
    "darwin-x86_64": { asset: `${N}_${version}_x64.dmg`, kind: "dmg", app: `${N}.app` },
  },
  files: [],
  launch: {
    args: ["--from-toolbay"],
    singleInstance: true,
    control: { show: ["--show"], hide: ["--hide"], quit: ["--quit"] },
    stateFile: "running.json",
  },
};
fs.writeFileSync(path.join(root, "toolbay.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote toolbay.json for", N, version);
