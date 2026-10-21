// Web viewer (core plugin "webviewer"), main-process side.
//
// Pages load in Electron <webview> tags inside the vault window. Every webview is forced into a
// locked-down configuration whatever the renderer asks for: its own persistent partition (cookies
// and storage never mix with the app), no Node integration, context isolation and the Chromium
// sandbox on, no preload script, http(s) only. Pop-ups become new web viewer tabs.
//
// Ad blocking: network-level, from filter lists (EasyList format). We use the list's domain rules
// ("||example.com^" with optional options), which cover the bulk of ad and tracker requests;
// cosmetic and exception rules are ignored. Lists are downloaded only when the web viewer is on
// and the blocker is enabled, cached in the app data folder, and refreshed every N days
// (0 = never). Settings shared by all vaults live in <appData>/webviewer.json.
import { app, ipcMain, net, session, shell, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC } from "../shared/ipc";
import { log } from "./log";

export const WEBVIEW_PARTITION = "persist:webviewer";

export interface WebviewerGlobal {
  adblockLists: string[];
  adblockFrequency: number; // days between list updates, 0 = never
}
const DEFAULT_GLOBAL: WebviewerGlobal = {
  adblockLists: ["https://easylist.to/easylist/easylist.txt", "https://easylist.to/easylist/easyprivacy.txt"],
  adblockFrequency: 4,
};

const globalFile = () => path.join(app.getPath("userData"), "webviewer.json");
const cacheFile = () => path.join(app.getPath("userData"), "webviewer-adblock.json");

function readGlobal(): WebviewerGlobal {
  try {
    return { ...DEFAULT_GLOBAL, ...JSON.parse(fs.readFileSync(globalFile(), "utf8")) };
  } catch {
    return { ...DEFAULT_GLOBAL };
  }
}
function writeGlobal(g: WebviewerGlobal): void {
  fs.mkdirSync(path.dirname(globalFile()), { recursive: true });
  fs.writeFileSync(globalFile(), JSON.stringify(g, null, 2));
}

/** Parse filter-list text into blocked host names ("||host^" network rules). */
export function parseFilterList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("||") || line.includes("##") || line.includes("#@#")) continue;
    const m = /^\|\|([a-z0-9.-]+)\^(?:\$(.*))?$/i.exec(line);
    if (!m) continue;
    const opts = (m[2] ?? "").split(",").filter(Boolean);
    // Skip rules limited to specific sites or that only hide things (we block whole requests).
    if (opts.some((o) => o.startsWith("domain=") || o === "popup" || o === "document" || o.startsWith("~"))) continue;
    out.push(m[1].toLowerCase());
  }
  return out;
}

/** True when the host or one of its parent domains is in the set. */
export function isBlockedHost(host: string, blocked: Set<string>): boolean {
  let h = host.toLowerCase();
  for (;;) {
    if (blocked.has(h)) return true;
    const i = h.indexOf(".");
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
}

let blocked = new Set<string>();
let adblockOn = false;
let hooked = false;

function hookSession(): void {
  if (hooked) return;
  hooked = true;
  const ses = session.fromPartition(WEBVIEW_PARTITION);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen" || permission === "clipboard-sanitized-write"));
  // Downloads go to the system Downloads folder (never into the vault silently).
  ses.on("will-download", (_e, item) => item.setSavePath(path.join(app.getPath("downloads"), path.basename(item.getFilename()))));
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (!adblockOn || details.resourceType === "mainFrame" || !blocked.size) return cb({});
    try {
      cb({ cancel: isBlockedHost(new URL(details.url).hostname, blocked) });
    } catch {
      cb({});
    }
  });
}

async function loadLists(force = false): Promise<void> {
  const g = readGlobal();
  let cache: { at: number; lists: string[]; hosts: string[] } | null = null;
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
  } catch {
    cache = null;
  }
  const sameLists = cache && JSON.stringify(cache.lists) === JSON.stringify(g.adblockLists);
  const fresh = cache && sameLists && (g.adblockFrequency === 0 || Date.now() - cache.at < g.adblockFrequency * 86400000);
  if (cache && sameLists && (fresh || !force)) blocked = new Set(cache.hosts);
  if (fresh && !force) return;
  const hosts: string[] = [];
  for (const url of g.adblockLists) {
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const res = await net.fetch(url);
      if (res.ok) hosts.push(...parseFilterList(await res.text()));
    } catch (e) {
      log("warn", `webviewer: couldn't download filter list ${url}: ${(e as Error).message}`);
    }
  }
  if (!hosts.length) return;
  blocked = new Set(hosts);
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify({ at: Date.now(), lists: g.adblockLists, hosts }));
  } catch {
    /* cache is optional */
  }
}

/** Harden every <webview> before it attaches; route pop-ups and downloads. */
export function installWebviewer(): void {
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (event, prefs, params) => {
      delete (prefs as any).preload;
      prefs.nodeIntegration = false;
      prefs.nodeIntegrationInSubFrames = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      prefs.webSecurity = true;
      prefs.allowRunningInsecureContent = false;
      (prefs as any).partition = WEBVIEW_PARTITION;
      params.partition = WEBVIEW_PARTITION;
      delete (params as any).preload;
      if (params.src && !/^(https?:|about:blank)/i.test(params.src)) event.preventDefault();
      hookSession();
    });
    if (contents.getType() === "webview") guardWebview(contents);
  });

  ipcMain.handle(IPC.webviewerCall, async (_e, op: string, arg?: any) => {
    switch (op) {
      case "getGlobal":
        return readGlobal();
      case "setGlobal": {
        const g = { ...readGlobal(), ...(arg ?? {}) };
        writeGlobal(g);
        if (adblockOn) void loadLists(true);
        return g;
      }
      case "setAdblock":
        adblockOn = !!arg;
        hookSession();
        if (adblockOn) void loadLists(false);
        return true;
      case "clearData": {
        const ses = session.fromPartition(WEBVIEW_PARTITION);
        await ses.clearStorageData();
        await ses.clearCache();
        return true;
      }
      case "openInBrowser":
        if (/^https?:/i.test(String(arg))) await shell.openExternal(String(arg));
        return true;
    }
    return null;
  });
}

function guardWebview(contents: WebContents): void {
  // Pop-ups and target=_blank links: a new web viewer tab in the host window.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) contents.hostWebContents?.send(IPC.webviewerOpenUrl, url);
    else if (/^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    if (!/^(https?:|about:blank)/i.test(url)) {
      e.preventDefault();
      if (/^mailto:/i.test(url)) void shell.openExternal(url);
    }
  });
}
