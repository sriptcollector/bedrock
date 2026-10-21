// URI parsing for our own scheme (brand.json "protocol", e.g. bedrock://) and obsidian:// payloads.
// Pure (no Electron/DOM): used by the main process and unit tests.

export interface ParsedUri {
  action: string;
  params: Record<string, string>;
}

/** Decode a query string without turning "+" into spaces (file names can contain "+"). */
export function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of q.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = safeDecode(i < 0 ? part : part.slice(0, i));
    const v = i < 0 ? "true" : safeDecode(part.slice(i + 1));
    if (k) out[k] = v;
  }
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Is this command-line argument a URI for one of our schemes? */
export function isAppUri(arg: string, schemes: string[]): boolean {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(arg);
  return !!m && schemes.includes(m[1].toLowerCase());
}

/**
 * Parse `<scheme>://action?k=v&...`, the short forms `<scheme>://vault/<vault>/<file path>` and
 * `<scheme>:///<absolute path>`, into an action and parameters.
 */
export function parseAppUri(raw: string, schemes: string[]): ParsedUri | null {
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(raw.trim());
  if (!m || !schemes.includes(m[1].toLowerCase())) return null;
  let rest = m[2];
  // Windows sometimes appends a slash to the URI it hands to the app ("bedrock://open/?...").
  if (!rest.startsWith("//")) rest = "//" + rest.replace(/^\/*/, "");
  rest = rest.slice(2);
  // Absolute path form: bedrock:///C:/Notes/a.md or bedrock:///Users/me/a.md
  if (rest.startsWith("/")) {
    const { path, query } = splitQuery(rest);
    let p = safeDecode(path);
    if (/^\/[a-zA-Z]:[\\/]/.test(p)) p = p.slice(1); // "/C:/..." -> "C:/..."
    return { action: "open", params: { ...parseQuery(query), path: p } };
  }
  const { path, query } = splitQuery(rest);
  const params = parseQuery(query);
  const segs = path.split("/");
  const action = safeDecode(segs[0] ?? "").toLowerCase();
  if (action === "vault" && segs.length >= 2) {
    const vault = safeDecode(segs[1]);
    const file = segs.slice(2).map(safeDecode).join("/");
    return { action: "open", params: { ...params, vault, ...(file ? { file } : {}) } };
  }
  if (!action) return null;
  return { action, params };
}

function splitQuery(s: string): { path: string; query: string } {
  const h = s.indexOf("#");
  const q = s.indexOf("?");
  if (q < 0) return { path: (h < 0 ? s : s.slice(0, h)).replace(/\/+$/, ""), query: "" };
  return { path: s.slice(0, q).replace(/\/+$/, ""), query: s.slice(q + 1) };
}

/** The URL that opens a file: `<scheme>://open?vault=<name>&file=<path without .md>`. */
export function buildOpenUrl(scheme: string, vaultName: string, filePath: string): string {
  return `${scheme}://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath.replace(/\.md$/i, ""))}`;
}

/** Find the vault (longest matching folder) that contains an absolute path. */
export function vaultForPath(abs: string, vaults: string[]): { vault: string; rel: string } | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const a = norm(abs);
  const ci = /^[a-zA-Z]:\//.test(a); // Windows paths compare case-insensitively
  let best: { vault: string; rel: string } | null = null;
  for (const v of vaults) {
    const nv = norm(v);
    const hit = ci ? a.toLowerCase() === nv.toLowerCase() || a.toLowerCase().startsWith(nv.toLowerCase() + "/") : a === nv || a.startsWith(nv + "/");
    if (hit && (!best || nv.length > norm(best.vault).length)) best = { vault: v, rel: a.slice(nv.length + 1) };
  }
  return best;
}
