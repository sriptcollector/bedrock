// Outgoing links ("outgoing-link" view): the links in the active note (resolved, unresolved and
// heading/block links) and unlinked mentions of other notes' names in it.
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { TFile } from "../../vault/files";
import { setIcon } from "../../dom/icons";
import { Notice } from "../../ui/notice";
import { parseLinktext, getLinkpath } from "../../../core/links";
import { parseFrontMatterAliases } from "../../../core/parse";
import { getSearchIndex } from "./search-index";
import { findUnlinkedMentions, mentionToLink } from "./mentions";
import { ResultList, type ResultEntry } from "./results";
import { sortEntries } from "./search-engine";
import type { Range } from "./search-query";
import { hoverLink, makeFileDraggable, openFileAt, sectionHeader } from "./tree";
import { showFileMenu } from "./file-menu";
import { Keymap } from "../../commands/keymap";

export const OUTGOING_VIEW = "outgoing-link";

export interface OutgoingItem {
  linktext: string;
  path: string;
  subpath: string;
  target: TFile | null;
}

/** Unique outgoing links of a note in document order (links, embeds, frontmatter links). */
export function outgoingItems(app: any, file: TFile): OutgoingItem[] {
  const meta = app.metadataCache.getFileCache(file);
  const refs = [...(meta?.links ?? []), ...(meta?.embeds ?? [])].sort((a: any, b: any) => a.position.start.offset - b.position.start.offset);
  const all = [...((meta as any)?.frontmatterLinks ?? []), ...refs];
  const seen = new Set<string>();
  const out: OutgoingItem[] = [];
  for (const r of all) {
    const { path, subpath } = parseLinktext(r.link);
    const target = path ? app.metadataCache.getFirstLinkpathDest(getLinkpath(path), file.path) : file;
    const key = (target?.path ?? path.toLowerCase()) + "#" + subpath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ linktext: r.link, path, subpath, target });
  }
  return out;
}

export class OutgoingLinkView extends ItemView {
  icon = "links-going-out";
  file: TFile | null = null;
  private fixedFile: string | null = null;
  linksCollapsed = false;
  unlinkedCollapsed = true;
  private paneEl: HTMLElement;
  private linksHeader: { el: HTMLElement; flair: HTMLElement };
  private linksEl: HTMLElement;
  private unlinkedHeader: { el: HTMLElement; flair: HTMLElement };
  private unlinked: ResultList;
  private timer: any = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.paneEl = this.contentEl.createDiv("outgoing-link-pane node-insert-event");
    this.linksHeader = sectionHeader(this.paneEl, "Links", () => this.setCollapsed("links", !this.linksCollapsed));
    this.linksEl = this.paneEl.createDiv("search-result-container");
    this.unlinkedHeader = sectionHeader(this.paneEl, "Unlinked mentions", () => this.setCollapsed("unlinked", !this.unlinkedCollapsed));
    this.unlinked = new ResultList(this.paneEl, {
      app: this.app,
      hoverSource: "outgoing-link",
      hoverParent: this,
      collapseAll: () => false,
      extraContext: () => false,
    });
  }

  getViewType(): string {
    return OUTGOING_VIEW;
  }
  getDisplayText(): string {
    return this.fixedFile && this.file ? `Outgoing links from ${this.file.basename}` : "Outgoing links";
  }
  getIcon(): string {
    return "links-going-out";
  }
  getState(): any {
    return { file: this.file?.path, linksCollapsed: this.linksCollapsed, unlinkedCollapsed: this.unlinkedCollapsed };
  }
  async setState(s: any): Promise<void> {
    if (typeof s?.linksCollapsed === "boolean") this.linksCollapsed = s.linksCollapsed;
    if (typeof s?.unlinkedCollapsed === "boolean") this.unlinkedCollapsed = s.unlinkedCollapsed;
    if (s?.fixed && typeof s.file === "string") this.fixedFile = s.file;
    if (this.fixedFile) this.file = this.app.vault.getFileByPath(this.fixedFile);
    this.applyCollapse();
    this.update();
  }

  private setCollapsed(which: "links" | "unlinked", v: boolean): void {
    if (which === "links") this.linksCollapsed = v;
    else this.unlinkedCollapsed = v;
    this.applyCollapse();
    this.app.workspace.requestSaveLayout();
  }

  private applyCollapse(): void {
    for (const [h, el, c] of [
      [this.linksHeader, this.linksEl, this.linksCollapsed],
      [this.unlinkedHeader, this.unlinked.containerEl, this.unlinkedCollapsed],
    ] as const) {
      h.el.toggleClass("is-collapsed", c);
      h.el.setAttr("aria-label", c ? "Click to expand" : "Click to collapse");
      el.toggleClass("is-collapsed", c);
    }
  }

  protected async onOpen(): Promise<void> {
    const follow = () => {
      if (this.fixedFile) return;
      const f = this.app.workspace.getActiveFile();
      if (f !== this.file) {
        this.file = f;
        this.update();
      }
    };
    this.registerEvent(this.app.workspace.on("file-open", follow));
    this.registerEvent(this.app.workspace.on("active-leaf-change", follow));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.schedule()));
    this.registerEvent(this.app.metadataCache.on("changed", (f: TFile) => f === this.file && this.schedule()));
    this.applyCollapse();
    follow();
    this.update();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 250);
  }

  async update(): Promise<void> {
    const file = this.file;
    this.linksEl.empty();
    this.linksEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    if (!file || file.extension !== "md") {
      this.linksHeader.flair.setText("0");
      this.unlinked.setEntries([]);
      this.unlinkedHeader.flair.setText("0");
      return;
    }
    const items = outgoingItems(this.app, file);
    this.linksHeader.flair.setText(String(items.length));
    if (!items.length) this.linksEl.createDiv({ cls: "search-empty-state", text: "No links found." });
    for (const it of items) this.linksEl.appendChild(this.renderItem(file, it));
    const idx = getSearchIndex(this.app);
    await idx.ensureLoaded();
    if (file !== this.file) return;
    const entries = this.computeUnlinked(file, new Set(items.map((i) => i.target?.path).filter(Boolean) as string[]));
    this.unlinked.setEntries(sortEntries(entries, "alphabetical"));
    this.unlinkedHeader.flair.setText(String(entries.length));
  }

  private renderItem(file: TFile, it: OutgoingItem): HTMLElement {
    const el = createDiv("tree-item-self is-clickable outgoing-link-item");
    const icon = el.createSpan("tree-item-icon");
    const inner = el.createDiv("tree-item-inner");
    const sub = it.subpath.replace(/^#/, "");
    if (!it.target) {
      setIcon(icon, "file-plus");
      inner.createDiv({ cls: "tree-item-inner-text", text: it.path });
      el.setAttr("aria-label", "Not created yet");
      el.addClass("is-unresolved");
    } else if (sub) {
      setIcon(icon, sub.startsWith("^") ? "box" : "heading-glyph");
      inner.createDiv({ cls: "tree-item-inner-text", text: sub.startsWith("^") ? sub : sub.split("#").pop()! });
      inner.createDiv({ cls: "tree-item-inner-subtext", text: it.path || file.basename });
      makeFileDraggable(this.app, el, it.target);
    } else {
      setIcon(icon, "link");
      inner.createDiv({ cls: "tree-item-inner-text", text: it.path });
      const parent = it.target.parent;
      if (parent && !parent.isRoot()) inner.createDiv({ cls: "tree-item-inner-subtext", text: parent.path });
      makeFileDraggable(this.app, el, it.target);
    }
    el.addEventListener("click", (e) => this.app.workspace.openLinkText(it.linktext.split("|")[0], file.path, Keymap.isModEvent(e)));
    el.addEventListener("mouseover", (e) => hoverLink(this.app, e, "outgoing-link", el, it.linktext.split("|")[0], this));
    el.addEventListener("contextmenu", (e) => it.target && showFileMenu(this.app, e, it.target, "outgoing-link", this.leaf));
    return el;
  }

  private computeUnlinked(file: TFile, linked: Set<string>): ResultEntry[] {
    const idx = getSearchIndex(this.app);
    const d = idx.get(file.path);
    if (!d) return [];
    const out: ResultEntry[] = [];
    for (const target of this.app.vault.getMarkdownFiles() as TFile[]) {
      if (target === file || linked.has(target.path)) continue;
      const names = [target.basename, ...(parseFrontMatterAliases(this.app.metadataCache.getFileCache(target)?.frontmatter) ?? [])];
      if (!names.some((n) => n && d.lower.includes(n.toLowerCase()))) continue;
      const ranges = findUnlinkedMentions(d.content, d.meta, names);
      if (!ranges.length) continue;
      out.push({ file: target, matchFile: file, text: d.content, ranges, onLink: (r) => this.linkMention(file, target, r, d.content.slice(r[0], r[1])) });
    }
    return out;
  }

  private async linkMention(src: TFile, target: TFile, range: Range, mention: string): Promise<void> {
    const linktext = this.app.metadataCache.fileToLinktext(target, src.path, true);
    let done = false;
    await this.app.vault.process(src, (text: string) => {
      if (text.slice(range[0], range[1]) !== mention) return text;
      done = true;
      return text.slice(0, range[0]) + mentionToLink(mention, linktext) + text.slice(range[1]);
    });
    if (!done) new Notice("That text changed since the list was made. Try again.");
  }
}

export { openFileAt };
