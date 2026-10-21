// Vault paths are always forward-slash, relative to the vault root, no leading/trailing slash.

export function normalizePath(p: string): string {
  p = (p ?? "").replace(/[\\/]+/g, "/").replace(/[  ]/g, " ");
  p = p.replace(/^\/+|\/+$/g, "");
  if (p === "") return "/";
  return p.normalize("NFC");
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1);
}

export function stripExtension(p: string): string {
  const e = extname(p);
  return e ? p.slice(0, p.length - e.length - 1) : p;
}

export function join(...parts: string[]): string {
  return normalizePath(parts.filter((x) => x && x !== "/").join("/"));
}

/** Resolve "./x" and "../x" against a folder. */
export function resolveRelative(folder: string, rel: string): string {
  const out = folder ? folder.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
