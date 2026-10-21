// URI actions (bedrock://<action>?..., also obsidian:// payloads): open, new, search,
// hook-get-address, choose-vault, show-plugin, show-theme, debug-info, show-release-notes, plus
// daily / unique (registered by those core plugins) and any action a plugin registers with
// registerObsidianProtocolHandler. x-success / x-error callbacks need "Allow URI callbacks" on.
import { ipcRenderer } from "electron";
import { readClipboard, writeClipboard } from "./clipboard";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { buildOpenUrl } from "../../shared/uri";
import { BRAND } from "../../shared/brand";
import { Notice } from "../ui/notice";
import { TFile } from "../vault/files";
import { parseLinktext } from "../../core/links";
import { getFrontMatterInfo } from "../../core/parse";

export const SCHEME = (BRAND.protocol || BRAND.name).toLowerCase();

type Params = Record<string, string>;

function paneType(p: Params): "tab" | "split" | "window" | boolean {
  const v = p.paneType ?? p.newpane ?? p.newleaf;
  if (v === "tab" || v === "split" || v === "window") return v;
  return v === "true";
}

export function fileUrl(app: any, file: TFile): string {
  return buildOpenUrl(SCHEME, app.vault.getName(), file.path);
}

/** Normalise a vault-relative path from a URI; refuses "..". */
function cleanVaultPath(p: string): string | null {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (parts.some((s) => s === "..")) return null;
  return parts.join("/");
}

function resolveFile(app: any, raw: string): { file: TFile | null; subpath: string } {
  const clean = cleanVaultPath(raw) ?? "";
  const direct = app.vault.getFileByPath(clean) ?? app.vault.getFileByPath(clean + ".md");
  if (direct) return { file: direct, subpath: "" };
  const { path, subpath } = parseLinktext(raw);
  return { file: app.metadataCache.getFirstLinkpathDest(path, "") ?? null, subpath };
}

async function clipboardOrContent(p: Params): Promise<string> {
  if (p.clipboard === "true") return readClipboard();
  return p.content ?? p.data ?? "";
}

function insertAfterFrontmatter(text: string, add: string): string {
  const info = getFrontMatterInfo(text);
  const at = info.exists ? info.contentStart : 0;
  return text.slice(0, at) + add + (add.endsWith("\n") || !text.slice(at) ? "" : "\n") + text.slice(at);
}

async function openFileFromUri(app: any, file: TFile, p: Params, extra: any = {}): Promise<void> {
  const leaf = app.workspace.getLeaf(paneType(p));
  await leaf.openFile(file, { active: true, ...extra });
}

const builtin: Record<string, (app: any, p: Params) => Promise<TFile | void | null> | TFile | void | null> = {
  async open(app, p) {
    if (!p.file) return null; // just bring the vault to the front
    const { file, subpath } = resolveFile(app, p.file);
    if (!file) {
      new Notice(`Unable to find the file "${p.file}".`);
      throw Object.assign(new Error("NotFound"), { code: "NotFound" });
    }
    const eState = subpath ? { subpath } : undefined;
    if (p.append || p.prepend) {
      const add = p.append ?? p.prepend;
      await app.vault.process(file, (t: string) => (p.append ? t + (t && !t.endsWith("\n") ? "\n" : "") + add : insertAfterFrontmatter(t, add)));
    }
    await openFileFromUri(app, file, p, { eState });
    return file;
  },

  async new(app, p) {
    const content = await clipboardOrContent(p);
    let target: string;
    if (p.file) {
      const c = cleanVaultPath(p.file);
      if (c === null || !c) {
        new Notice("That file path isn't allowed.");
        throw Object.assign(new Error("InvalidPath"), { code: "InvalidPath" });
      }
      target = /\.[a-z0-9]+$/i.test(c) ? c : c + ".md";
    } else {
      const name = (p.name ?? "").replace(/[\\/]/g, "").trim() || "Untitled";
      const parent = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "");
      target = parent.getParentPrefix() + (/\.md$/i.test(name) ? name : name + ".md");
    }
    let file: TFile | null = app.vault.getFileByPath(target);
    if (file && (p.overwrite === "true" || p.append === "true" || p.prepend === "true")) {
      if (p.overwrite === "true") await app.vault.modify(file, content);
      else if (p.append === "true") await app.vault.process(file, (t: string) => t + (t && !t.endsWith("\n") && content ? "\n" : "") + content);
      else await app.vault.process(file, (t: string) => insertAfterFrontmatter(t, content));
    } else {
      if (file) target = app.vault.getAvailablePath(target.replace(/\.md$/i, ""), "md");
      const dir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
      if (dir && !app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir).catch(() => null);
      file = await app.vault.create(target, content);
    }
    if (p.silent !== "true") {
      const rename = !p.name && !p.file && !content;
      await openFileFromUri(app, file!, p, { state: { mode: "source" }, eState: rename ? { rename: "all" } : undefined });
    }
    return file;
  },

  async search(app, p) {
    await app.globalSearch?.openGlobalSearch?.(p.query ?? "");
  },

  async "hook-get-address"(app, p) {
    const file = app.workspace.getActiveFile();
    if (!file) throw Object.assign(new Error("NotFound"), { code: "NotFound" });
    if (!p["x-success"]) {
      await writeClipboard(`[${file.basename}](${fileUrl(app, file)})`);
      new Notice("Copied a link to the current note.");
    }
    return file;
  },

  "choose-vault"(app) {
    app.shell?.openVaultManager?.();
  },

  async "show-plugin"(app, p) {
    const { openCommunityBrowser } = await import("../plugins/browser");
    openCommunityBrowser(app, "plugins", p.id);
  },

  async "show-theme"(app, p) {
    const { openCommunityBrowser } = await import("../plugins/browser");
    openCommunityBrowser(app, "themes", p.name);
  },

  "debug-info"(app) {
    app.commands.executeCommandById("app:show-debug-info");
  },

  "show-release-notes"(app) {
    app.commands.executeCommandById("app:show-release-notes");
  },
};

/** Run one URI action in this window. */
export async function dispatchUri(app: any, action: string, params: Params): Promise<void> {
  if (params.vaultNotFound === "true") {
    new Notice(`Vault not found: "${params.vault}". Open it once from "Manage vaults" so links can find it.`);
    return;
  }
  if (params.pathNotFound === "true") {
    new Notice("That file isn't inside a vault you've opened in this app.");
    return;
  }
  const a = action.toLowerCase();
  if (a === "open" && Object.keys(params).filter((k) => k !== "vault").length === 0) return; // bring to front only
  const handler = builtin[a] ?? null;
  const pluginHandler = app.protocolHandlers?.[a] ?? app.protocolHandlers?.[action];
  if (!handler && !pluginHandler) {
    new Notice("Invalid URI action");
    return;
  }
  const callbacks = !!app.vault.getConfig("uriCallbacks");
  try {
    const res = await (pluginHandler && !handler ? pluginHandler({ action, ...params }) : handler!(app, params));
    const ok = params["x-success"];
    if (callbacks && ok && !/^file:/i.test(ok)) {
      const u = new URL(ok);
      if (res instanceof TFile) {
        u.searchParams.set("name", res.basename);
        u.searchParams.set("url", fileUrl(app, res));
        u.searchParams.set("file", app.vault.adapter.getFullPath(res.path));
      }
      app.openExternal(u.toString());
    }
  } catch (e: any) {
    const bad = params["x-error"];
    if (callbacks && bad && !/^file:/i.test(bad)) {
      const u = new URL(bad);
      u.searchParams.set("errorCode", e?.code ?? "Error");
      u.searchParams.set("errorMessage", String(e?.message ?? e));
      app.openExternal(u.toString());
    } else if (!e?.code) console.error(e);
  }
}

/** Listen for URIs from the main process (after the layout is ready). */
export function mountUriHandling(app: any): void {
  ipcRenderer.on(SHELL_IPC.uri, (_e, u: { action: string; params: Params }) => void dispatchUri(app, u.action, u.params));
  app.workspace.onLayoutReady(() => ipcRenderer.send(SHELL_IPC.uri));
}
