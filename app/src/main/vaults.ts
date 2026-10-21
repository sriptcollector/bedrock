// The one vault. Every person has exactly one synced vault, at Documents\<DisplayName> by default,
// created on first run with a short welcome note. No vault picker on normal start.
// Advanced: open any other folder as a vault (its own window, not synced), or import an existing
// vault into the one vault so it becomes the synced vault.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { BRAND, INSPIRED_BY } from "../shared/brand";

interface VaultRegistry {
  main: string;
  others: { path: string; lastOpened: number }[];
}

function registryPath(): string {
  return path.join(app.getPath("userData"), "vaults.json");
}

export function readRegistry(): VaultRegistry {
  try {
    const v = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    if (typeof v.main === "string") return { main: v.main, others: Array.isArray(v.others) ? v.others : [] };
  } catch {
    /* first run */
  }
  return { main: defaultVaultPath(), others: [] };
}

export function writeRegistry(r: VaultRegistry): void {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(r, null, 2));
}

export function defaultVaultPath(): string {
  return path.join(app.getPath("documents"), BRAND.vaultFolderName);
}

export const WELCOME_NOTE = `# Welcome to ${BRAND.displayName}

This is your vault: a folder of plain Markdown files on your computer. Everything you write here is
yours, works offline, and stays readable by any text editor.

A few things to try:

- Make a new note with **Ctrl/Cmd + N**.
- Link notes by typing \`[[\` and picking a note, like [[Welcome]].
- Add tags such as #ideas to group notes.
- Open the command palette with **Ctrl/Cmd + P** to find every action.

When you're signed in to Toolbay, this vault syncs to your other computers automatically.
${INSPIRED_BY ? `\n---\n\n<small>Inspired by ${INSPIRED_BY.name}. ${INSPIRED_BY.notAffiliated}</small>\n` : ""}`;

/** Make sure the main vault exists. Returns its path. */
export function ensureMainVault(): string {
  const reg = readRegistry();
  const dir = reg.main;
  const fresh = !fs.existsSync(dir);
  fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
  if (fresh) {
    fs.writeFileSync(path.join(dir, "Welcome.md"), WELCOME_NOTE);
    fs.writeFileSync(path.join(dir, ".obsidian", "app.json"), "{}\n");
  }
  if (!fs.existsSync(registryPath())) writeRegistry(reg);
  return dir;
}

export function rememberOther(vault: string): void {
  const reg = readRegistry();
  reg.others = [{ path: vault, lastOpened: Date.now() }, ...reg.others.filter((o) => o.path !== vault)].slice(0, 20);
  writeRegistry(reg);
}

const SKIP_DIRS = new Set([".trash", ".git", "node_modules"]);
const SKIP_CONFIG = /^\.obsidian[\\/](workspace.*\.json|cache)$/;

export interface ImportResult {
  copied: number;
  renamed: number;
  skipped: number;
}

/**
 * Copy an existing vault into the one (synced) vault. Notes and attachments keep their relative
 * paths; if a different file already sits at the same path the incoming copy gets " (imported)"
 * added to its name. `.obsidian` settings are copied only where the main vault has none yet, so
 * themes, snippets and plugins come along without overwriting choices already made here.
 */
export function importIntoMain(src: string): ImportResult {
  const dest = ensureMainVault();
  const res: ImportResult = { copied: 0, renamed: 0, skipped: 0 };
  if (path.resolve(src) === path.resolve(dest)) return res;
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, ent.name) : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(r);
        continue;
      }
      if (!ent.isFile() || SKIP_CONFIG.test(r)) {
        res.skipped++;
        continue;
      }
      let target = path.join(dest, r);
      const from = path.join(src, r);
      if (fs.existsSync(target)) {
        const same = fs.statSync(target).size === fs.statSync(from).size && fs.readFileSync(target).equals(fs.readFileSync(from));
        if (same || r.startsWith(".obsidian")) {
          res.skipped++;
          continue;
        }
        const ext = path.extname(target);
        target = target.slice(0, target.length - ext.length) + " (imported)" + ext;
        res.renamed++;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(from, target);
      res.copied++;
    }
  };
  walk("");
  return res;
}

export function isVaultFolder(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
