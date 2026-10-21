// The `obsidian` module: what community plugins get from require("obsidian").
// Typed by the MIT `obsidian` package (obsidian.d.ts); the implementation is our own.
import moment from "moment";
import { ipcRenderer } from "electron";
import { showTooltip } from "../ui/tooltip";
export { Events, Component, type EventRef } from "./events";
export { TAbstractFile, TFile, TFolder } from "../vault/files";
export { Vault } from "../vault/vault";
export { FileSystemAdapter } from "../vault/adapter";
export { FileManager } from "../vault/file-manager";
export { MetadataCache, resolveSubpath } from "../metadata/cache";
export { Workspace } from "../workspace/workspace";
export { WorkspaceLeaf } from "../workspace/leaf";
export { WorkspaceItem, WorkspaceParent, WorkspaceSplit, WorkspaceTabs, WorkspaceSidedock, WorkspaceRoot, WorkspaceRibbon } from "../workspace/items";
export { View, ItemView, FileView, EditableFileView, TextFileView } from "../workspace/view";
export { MarkdownView } from "../editor/markdown-view";
export { Editor } from "../editor/editor";
export { editorInfoField, editorViewField, editorEditorField, editorLivePreviewField } from "../editor/fields";
export { MarkdownRenderer, MarkdownRenderChild } from "../markdown/renderer";
export { Plugin, type PluginManifest } from "../plugins/plugin";
export { Modal, SuggestModal, FuzzySuggestModal } from "../ui/modal";
export { Notice } from "../ui/notice";
export { Menu, MenuItem } from "../ui/menu";
export {
  Setting,
  SettingTab,
  PluginSettingTab,
  BaseComponent,
  ValueComponent,
  ButtonComponent,
  ExtraButtonComponent,
  ToggleComponent,
  TextComponent,
  TextAreaComponent,
  SearchComponent,
  DropdownComponent,
  SliderComponent,
  ColorComponent,
  MomentFormatComponent,
  ProgressBarComponent,
  AbstractTextComponent,
} from "../ui/setting";
export { Scope, Keymap, Platform } from "../commands/keymap";
export { SettingGroup, SettingPage } from "../settings/render";
export { SecretStorage, SecretComponent } from "../settings/secret-storage";
export { PopoverSuggest, AbstractInputSuggest } from "./suggest";
// One EditorSuggest system: the editor's manager runs built-in and plugin suggests in order.
export { EditorSuggest } from "../editor/suggest";
export {
  ConfirmationModal,
  ConfirmationButton,
  MenuSeparator,
  TExternalFile,
  CapacitorAdapter,
  WorkspaceContainer,
  WorkspaceWindow,
  WorkspaceFloating,
  WorkspaceMobileDrawer,
  MarkdownPreviewView,
  MarkdownEditView,
  MarkdownPreviewRenderer,
  RenderContext,
  DisplayValueComponent,
  livePreviewState,
  parsePropertyId,
  Value,
  NullValue,
  NotNullValue,
  PrimitiveValue,
  StringValue,
  NumberValue,
  BooleanValue,
  DateValue,
  RelativeDateValue,
  DurationValue,
  RegExpValue,
  UrlValue,
  HTMLValue,
  IconValue,
  ImageValue,
  TagValue,
  LinkValue,
  FileValue,
  ListValue,
  ObjectValue,
  BasesEntry,
  BasesEntryGroup,
  BasesQueryResult,
  BasesViewConfig,
  BasesView,
  QueryController,
} from "./compat";
export { prepareFuzzySearch, prepareSimpleSearch, renderMatches, renderResults, sortSearchResults } from "../ui/search";
export { setIcon, getIcon, addIcon, removeIcon, getIconIds } from "../dom/icons";
export { normalizePath } from "../../core/path";
export { parseLinktext, getLinkpath, stripHeading, stripHeadingForLink } from "../../core/links";
export {
  parseYaml,
  stringifyYaml,
  getFrontMatterInfo,
  getAllTags,
  parseFrontMatterAliases,
  parseFrontMatterTags,
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
} from "../../core/parse";
export { renderMathToString } from "../markdown/parser";
export { loadMermaid } from "../markdown/renderer";
export { moment };

import { renderMathToString } from "../markdown/parser";
import { loadMermaid } from "../markdown/renderer";
import { sanitize } from "../markdown/renderer";
import { BRAND } from "../../shared/brand";

export const apiVersion = "1.8.0";

export function requireApiVersion(version: string): boolean {
  const a = apiVersion.split(".").map(Number);
  const b = version.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

export function getLanguage(): string {
  return navigator.language?.split("-")[0] ?? "en";
}

export function renderMath(source: string, display: boolean): HTMLElement {
  const el = display ? createDiv("math math-block") : createSpan("math math-inline");
  el.innerHTML = renderMathToString(source, display);
  return el;
}
export async function finishRenderMath(): Promise<void> {}
export async function loadMathJax(): Promise<void> {}
export async function loadPrism(): Promise<any> {
  return null;
}
export async function loadPdfJs(): Promise<any> {
  return null;
}
export { loadMermaid as _loadMermaid };
void loadMermaid;

export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | void;
}

export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
  let timer: any = null;
  let lastArgs: T | null = null;
  const fn: any = (...args: T) => {
    lastArgs = args;
    if (timer && !resetTimer) return fn;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      cb(...(lastArgs as T));
    }, timeout);
    return fn;
  };
  fn.cancel = () => {
    clearTimeout(timer);
    timer = null;
    return fn;
  };
  fn.run = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    return cb(...(lastArgs as T));
  };
  return fn;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const b = Buffer.from(b64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
export function arrayBufferToHex(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("hex");
}
export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const b = Buffer.from(hex, "hex");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
export async function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  sanitize(t.content);
  return t.content;
}

/** Very small HTML -> Markdown (paste conversion and plugin use). */
export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string {
  let root: Node;
  if (typeof html === "string") {
    const t = document.createElement("template");
    t.innerHTML = html;
    root = t.content;
  } else root = html;
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/\s+/g, " ");
    if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && n.nodeType !== Node.DOCUMENT_NODE) return "";
    const el = n as HTMLElement;
    const inner = () => Array.from(n.childNodes).map(walk).join("");
    switch (el.tagName?.toLowerCase()) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "\n\n" + "#".repeat(Number(el.tagName[1])) + " " + inner().trim() + "\n\n";
      case "p":
      case "div":
        return "\n\n" + inner().trim() + "\n\n";
      case "br":
        return "\n";
      case "strong":
      case "b":
        return "**" + inner() + "**";
      case "em":
      case "i":
        return "*" + inner() + "*";
      case "code":
        return "`" + inner() + "`";
      case "pre":
        return "\n\n```\n" + (el.textContent ?? "") + "\n```\n\n";
      case "a":
        return `[${inner()}](${el.getAttribute("href") ?? ""})`;
      case "img":
        return `![${el.getAttribute("alt") ?? ""}](${el.getAttribute("src") ?? ""})`;
      case "li":
        return "- " + inner().trim() + "\n";
      case "ul":
      case "ol":
        return "\n" + inner() + "\n";
      case "blockquote":
        return "\n" + inner().trim().split("\n").map((l) => "> " + l).join("\n") + "\n";
      case "hr":
        return "\n---\n";
      case "script":
      case "style":
        return "";
      default:
        return inner();
    }
  };
  return walk(root).replace(/\n{3,}/g, "\n\n").trim();
}

export interface RequestUrlParam {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

/** requestUrl: a fetch without CORS limits (Electron's net module via the renderer's Node fetch). */
export function requestUrl(req: RequestUrlParam | string): Promise<any> & { json: Promise<any>; text: Promise<string>; arrayBuffer: Promise<ArrayBuffer> } {
  const r = typeof req === "string" ? { url: req } : req;
  const p = (async () => {
    const headers: Record<string, string> = { ...(r.headers ?? {}) };
    if (r.contentType) headers["Content-Type"] = r.contentType;
    const res = await (globalThis as any).fetch(r.url, { method: r.method ?? "GET", headers, body: r.body as any });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    const out = { status: res.status, headers: Object.fromEntries(res.headers.entries()), arrayBuffer: buf, text, json };
    if (res.status >= 400 && r.throw !== false) throw Object.assign(new Error(`Request failed, status ${res.status}`), out);
    return out;
  })();
  const anyP: any = p;
  anyP.json = p.then((x) => x.json);
  anyP.text = p.then((x) => x.text);
  anyP.arrayBuffer = p.then((x) => x.arrayBuffer);
  return anyP;
}

export async function request(req: RequestUrlParam | string): Promise<string> {
  return (await requestUrl(req)).text;
}

export function setTooltip(el: HTMLElement, tooltip: string, o?: { placement?: string; delay?: number; classes?: string[]; gap?: number }): void {
  el.setAttribute("aria-label", tooltip);
  if (o?.placement) el.setAttribute("data-tooltip-position", o.placement);
  if (o?.delay !== undefined) el.setAttribute("data-tooltip-delay", String(o.delay));
  if (o?.classes?.length) el.setAttribute("data-tooltip-classes", o.classes.join(" "));
  if (o?.gap !== undefined) el.setAttribute("data-tooltip-gap", String(o.gap));
}
export function displayTooltip(el: HTMLElement, content: string | DocumentFragment, o?: { placement?: string; classes?: string[]; gap?: number }): void {
  showTooltip(el, content, o);
}

export function iterateRefs(refs: any[], cb: (ref: any) => boolean | void): boolean {
  for (const r of refs ?? []) if (cb(r)) return true;
  return false;
}
export function iterateCacheRefs(cache: any, cb: (ref: any) => boolean | void): boolean {
  return iterateRefs([...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])], cb);
}

export const PopoverState = { Showing: 0, Shown: 1, Hiding: 2, Hidden: 3 };

export class HoverPopover {
  hoverEl = createDiv("popover hover-popover");
  state = 3;
  constructor(public parent: any, public targetEl: HTMLElement | null, public waitTime?: number) {}
  hide(): void {
    this.hoverEl.remove();
  }
}

export class Tasks {
  private list: Promise<any>[] = [];
  add(fn: () => Promise<any>): void {
    this.list.push(fn());
  }
  addPromise(p: Promise<any>): void {
    this.list.push(p);
  }
  isEmpty(): boolean {
    return !this.list.length;
  }
  promise(): Promise<any> {
    return Promise.all(this.list);
  }
}

// App class is exported from ../app (circular-safe re-export).
export { App } from "../app";

export const BEDROCK_BRAND = BRAND;
void ipcRenderer;
