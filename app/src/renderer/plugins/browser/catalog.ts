// Community plugin and theme catalogue, read at runtime from the public obsidianmd/obsidian-releases
// repository on GitHub, plus each plugin's / theme's own GitHub repository (manifest, README,
// release files). Nothing else is contacted: no download counters, no proxies, no analytics.
//
// Install = the same files Obsidian installs: plugins get manifest.json, main.js and styles.css from
// the GitHub release whose tag is the manifest version, written to .obsidian/plugins/<id>/;
// themes get manifest.json and theme.css into .obsidian/themes/<name>/.
import { Notice } from "../../ui/notice";

const LISTS = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/";
const ALLOWED_HOSTS = /^(raw\.githubusercontent\.com|github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|codeload\.github\.com|user-images\.githubusercontent\.com|private-user-images\.githubusercontent\.com|camo\.githubusercontent\.com|avatars\.githubusercontent\.com)$/;

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export interface CommunityPlugin {
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
  downloads: number;
  updated: number; // ms epoch (0 when unknown)
  /** Highest version seen in the stats (may lag the repo). */
  latestVersion: string | null;
  deprecatedVersions?: string[];
}
export interface CommunityTheme {
  name: string;
  author: string;
  repo: string;
  screenshot: string;
  modes: string[];
  legacy?: boolean;
  branch?: string;
}
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  fundingUrl?: string | Record<string, string>;
  helpUrl?: string;
  isDesktopOnly?: boolean;
  dir?: string;
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
let fetcher: Fetcher = (url) => (globalThis as any).fetch(url, { cache: "no-store" });
/** Tests replace the network. */
export function setFetcher(f: Fetcher): void {
  fetcher = f;
}

async function get(url: string): Promise<{ status: number; text: string; buf: ArrayBuffer }> {
  if (!isAllowedUrl(url)) throw new Error(`Blocked request to ${url}: only GitHub is contacted.`);
  const r = await fetcher(url);
  const buf = await r.arrayBuffer();
  return { status: r.status, text: new TextDecoder().decode(buf), buf };
}
async function getJson<T>(url: string): Promise<T> {
  const r = await get(url);
  if (r.status !== 200) throw new Error(`GitHub answered ${r.status} for ${url}`);
  return JSON.parse(r.text) as T;
}

// ---------------------------------------------------------------- lists (cached 5 minutes)
const cache = new Map<string, { at: number; value: any; pending?: Promise<any> }>();
async function cached<T>(key: string, fn: () => Promise<T>, ttl = 5 * 60 * 1000): Promise<T> {
  const c = cache.get(key);
  if (c && c.value !== undefined && Date.now() - c.at < ttl) return c.value;
  if (c?.pending) return c.pending;
  const pending = fn()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((e) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, { at: 0, value: undefined, pending });
  return pending;
}
export function clearCatalogCache(): void {
  cache.clear();
}

export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[.-]/);
  const pb = String(b).split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = parseInt(x, 10),
      ny = parseInt(y, 10);
    if (!isNaN(nx) && !isNaN(ny) && nx !== ny) return nx - ny;
    if (isNaN(nx) || isNaN(ny)) {
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return 0;
}

export async function getPlugins(): Promise<CommunityPlugin[]> {
  return cached("plugins", async () => {
    const [list, stats, deprecations] = await Promise.all([
      getJson<any[]>(LISTS + "community-plugins.json"),
      getJson<Record<string, any>>(LISTS + "community-plugin-stats.json").catch(() => ({}) as Record<string, any>),
      getJson<Record<string, string[]>>(LISTS + "community-plugin-deprecation.json").catch(() => ({}) as Record<string, string[]>),
    ]);
    return list
      .filter((p) => p && p.id && p.repo)
      .map((p) => {
        const s = (stats as any)[p.id] ?? {};
        const versions = Object.keys(s).filter((k) => /^\d/.test(k));
        versions.sort(compareVersions);
        return {
          id: p.id,
          name: p.name ?? p.id,
          author: p.author ?? "",
          description: p.description ?? "",
          repo: p.repo,
          downloads: Number(s.downloads) || 0,
          updated: Number(s.updated) || 0,
          latestVersion: versions.length ? versions[versions.length - 1] : null,
          deprecatedVersions: (deprecations as any)[p.id],
        } as CommunityPlugin;
      });
  });
}

export async function getThemes(): Promise<CommunityTheme[]> {
  return cached("themes", async () => (await getJson<any[]>(LISTS + "community-css-themes.json")).filter((t) => t && t.name && t.repo));
}

export function themeScreenshotUrl(t: CommunityTheme): string {
  return `https://raw.githubusercontent.com/${t.repo}/${t.branch ?? "HEAD"}/${t.screenshot}`;
}

export async function getRepoManifest(repo: string, branch = "HEAD"): Promise<PluginManifest> {
  return cached(`manifest:${repo}`, () => getJson<PluginManifest>(`https://raw.githubusercontent.com/${repo}/${branch}/manifest.json`), 60 * 1000);
}

export async function getReadme(repo: string, branch = "HEAD"): Promise<string> {
  return cached(`readme:${repo}`, async () => {
    for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
      const r = await get(`https://raw.githubusercontent.com/${repo}/${branch}/${name}`).catch(() => null);
      if (r && r.status === 200) return r.text;
    }
    return "";
  });
}

// ---------------------------------------------------------------- plugins: install / update
/** Version to install: the repo manifest's version, or an older one from versions.json when the
 * newest needs a newer app than ours. */
export async function resolveInstallVersion(repo: string, appVersion: string): Promise<{ manifest: PluginManifest; version: string; note?: string }> {
  const manifest = await getRepoManifest(repo);
  if (!manifest.minAppVersion || compareVersions(manifest.minAppVersion, appVersion) <= 0) return { manifest, version: manifest.version };
  try {
    const versions = await getJson<Record<string, string>>(`https://raw.githubusercontent.com/${repo}/HEAD/versions.json`);
    const ok = Object.entries(versions)
      .filter(([, min]) => compareVersions(min, appVersion) <= 0)
      .map(([v]) => v)
      .sort(compareVersions);
    if (ok.length) return { manifest, version: ok[ok.length - 1], note: `Installed version ${ok[ok.length - 1]}, the newest that works with this app.` };
  } catch {
    /* no versions.json */
  }
  return { manifest, version: manifest.version, note: `This plugin asks for app version ${manifest.minAppVersion} or newer; it may not work fully.` };
}

/** Download a plugin release into .obsidian/plugins/<id>/ and (re)load it if it's turned on. */
export async function installPlugin(app: any, repo: string, version: string, expected?: { id: string }): Promise<PluginManifest> {
  const rel = `https://github.com/${repo}/releases/download/${version}/`;
  const mRes = await get(rel + "manifest.json");
  if (mRes.status !== 200) throw new Error(`The release ${version} has no manifest.json (GitHub answered ${mRes.status}).`);
  const manifest = JSON.parse(mRes.text) as PluginManifest;
  if (expected && manifest.id !== expected.id) throw new Error(`The release is for “${manifest.id}”, not “${expected.id}”.`);
  if (!manifest.id || /[\\/]|\.\./.test(manifest.id)) throw new Error("The plugin's manifest has an invalid id.");
  const main = await get(rel + "main.js");
  if (main.status !== 200) throw new Error(`The release ${version} has no main.js (GitHub answered ${main.status}).`);
  const styles = await get(rel + "styles.css").catch(() => null);
  const pm = app.plugins;
  const dir = `${pm.dir}/${manifest.id}`;
  const a = app.vault.adapter;
  await a.mkdir(dir).catch(() => undefined);
  const wasLoaded = !!pm.plugins?.[manifest.id];
  if (wasLoaded) await pm.unloadPlugin(manifest.id);
  await a.write(`${dir}/main.js`, main.text);
  await a.write(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  if (styles && styles.status === 200) await a.write(`${dir}/styles.css`, styles.text);
  else await a.remove(`${dir}/styles.css`).catch(() => undefined);
  await pm.loadManifests();
  if (wasLoaded || (pm.isEnabled() && pm.enabledPlugins.has(manifest.id))) await pm.loadPlugin(manifest.id);
  return manifest;
}

/** id -> {version, repo} for installed plugins with a newer version on GitHub. */
export async function checkPluginUpdates(app: any): Promise<Record<string, { version: string; repo: string }>> {
  const list = await getPlugins();
  const byId = new Map(list.map((p) => [p.id, p]));
  const out: Record<string, { version: string; repo: string }> = {};
  const pm = app.plugins;
  await Promise.all(
    Object.values(pm.manifests as Record<string, PluginManifest>).map(async (m) => {
      const entry = byId.get(m.id);
      if (!entry) return;
      try {
        const r = await getRepoManifest(entry.repo);
        if (compareVersions(r.version, m.version) > 0) out[m.id] = { version: r.version, repo: entry.repo };
      } catch {
        /* repo unreachable: skip */
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- themes
export async function installTheme(app: any, t: CommunityTheme): Promise<void> {
  const base = `https://raw.githubusercontent.com/${t.repo}/${t.branch ?? "HEAD"}/`;
  const latest = `https://github.com/${t.repo}/releases/latest/download/`;
  let css: string | null = null;
  let manifestText: string | null = null;
  // Release assets first (like Obsidian), then the repository files.
  for (const url of [latest + "theme.css", base + "theme.css", base + "obsidian.css"]) {
    const r = await get(url).catch(() => null);
    if (r && r.status === 200 && r.text.trim()) {
      css = r.text;
      break;
    }
  }
  if (css === null) throw new Error("The theme's CSS file couldn't be found on GitHub.");
  for (const url of [latest + "manifest.json", base + "manifest.json"]) {
    const r = await get(url).catch(() => null);
    if (r && r.status === 200) {
      try {
        JSON.parse(r.text);
        manifestText = r.text;
        break;
      } catch {
        /* not json */
      }
    }
  }
  const dir = `${app.customCss.themesDir}/${t.name}`;
  const a = app.vault.adapter;
  await a.mkdir(dir).catch(() => undefined);
  await a.write(`${dir}/theme.css`, css);
  await a.write(`${dir}/manifest.json`, manifestText ?? JSON.stringify({ name: t.name, version: "0.0.0", author: t.author }, null, 2));
  await app.customCss.reloadThemes();
}

export async function uninstallTheme(app: any, name: string): Promise<void> {
  const css = app.customCss;
  if (css.theme === name) await css.setTheme("");
  await app.vault.adapter.rmdir(`${css.themesDir}/${name}`, true).catch(() => undefined);
  await app.vault.adapter.remove(`${css.themesDir}/${name}.css`).catch(() => undefined);
  await css.reloadThemes();
}

/** name -> newer version, for installed themes. */
export async function checkThemeUpdates(app: any, quiet = false): Promise<Record<string, string>> {
  const css = app.customCss;
  const out: Record<string, string> = {};
  try {
    const list = await getThemes();
    await Promise.all(
      css.themes.map(async (name: string) => {
        const t = list.find((x) => x.name === name);
        const mine = css.themeManifests[name]?.version;
        if (!t || !mine) return;
        const r = await getJson<any>(`https://raw.githubusercontent.com/${t.repo}/${t.branch ?? "HEAD"}/manifest.json`).catch(() => null);
        if (r?.version && compareVersions(r.version, mine) > 0) out[name] = r.version;
      }),
    );
  } catch (e: any) {
    if (!quiet) new Notice(`Couldn't check theme updates: ${e?.message ?? e}`);
    return out;
  }
  if (!quiet) {
    const n = Object.keys(out).length;
    new Notice(n ? `Updates available for: ${Object.keys(out).join(", ")}. Open Manage to update.` : "All themes are up to date.");
  }
  return out;
}

/** 5,176,995 -> "5.1M", 745,812 -> "745k" (rounded down, like the original's cards). */
export function formatCount(n: number): string {
  if (n >= 1e6) return (Math.floor(n / 1e5) / 10).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return Math.floor(n / 1e3) + "k";
  return String(n);
}
