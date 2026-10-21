// Result list DOM shared by Search, Backlinks and embedded query blocks:
//   .search-result-container > .search-results-children > .tree-item.search-result
//     > .search-result-file-title (chevron, name, count) + .search-result-file-matches > .search-result-file-match
import { setIcon } from "../../dom/icons";
import type { TFile } from "../../vault/files";
import type { Range } from "./search-query";
import { buildCards, cardParts, extendCard, type MatchCard } from "./snippets";
import { collapseIcon, fileContextMenu, hoverLink, makeFileDraggable, openFileAt, setCollapsed } from "./tree";

export interface ResultEntry {
  file: TFile;
  /** Text the ranges refer to (file content, or canvas card text). */
  text: string;
  ranges: Range[];
  /** Highlighted ranges in the title (file name or path). */
  titleRanges?: Range[];
  /** Show the full path as the title (path: queries). */
  titleIsPath?: boolean;
  /** File the match cards belong to, when it isn't `file` (outgoing unlinked mentions). */
  matchFile?: TFile;
  /** Unlinked mention: show a "Link" button on each card. */
  onLink?: (range: Range) => void;
}

export interface ResultListOptions {
  app: any;
  /** Hover-link source id for page previews. */
  hoverSource: string;
  hoverParent: any;
  collapseAll: () => boolean;
  extraContext: () => boolean;
  /** Called when a file is (un)collapsed by the user. */
  onToggle?: () => void;
  /** Max cards per file before "show more" (search shows all). */
  emptyText?: string;
}

const RENDER_CHUNK = 50;

export class ResultList {
  containerEl: HTMLElement;
  childrenEl: HTMLElement;
  private entries: ResultEntry[] = [];
  private rendered = 0;
  private collapsedFiles = new Set<string>();
  private expandedFiles = new Set<string>();
  private moreEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, private o: ResultListOptions, extraCls = "") {
    this.containerEl = parent.createDiv("search-result-container" + (extraCls ? " " + extraCls : ""));
    this.childrenEl = this.containerEl.createDiv("search-results-children");
    this.childrenEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    // Render more results as the user scrolls near the end.
    const scroller = () => this.containerEl.closest(".view-content, .backlink-pane, .search-result-container, .workspace-leaf-content") as HTMLElement | null;
    setTimeout(() => {
      const sc = scroller();
      sc?.addEventListener("scroll", () => {
        if (this.rendered < this.entries.length && sc.scrollTop + sc.clientHeight > sc.scrollHeight - 600) this.renderMore();
      });
    }, 0);
  }

  get count(): number {
    return this.entries.length;
  }

  totalMatches(): number {
    let n = 0;
    for (const e of this.entries) n += Math.max(1, buildCards(e.text, e.ranges, false).length);
    return n;
  }

  setEntries(entries: ResultEntry[]): void {
    this.entries = entries;
    this.rerender();
  }

  rerender(): void {
    const keep = this.childrenEl.firstElementChild;
    this.childrenEl.empty();
    if (keep) this.childrenEl.appendChild(keep);
    this.rendered = 0;
    this.moreEl = null;
    this.emptyEl = null;
    if (!this.entries.length && this.o.emptyText) {
      this.emptyEl = this.childrenEl.createDiv({ cls: "search-empty-state", text: this.o.emptyText });
      return;
    }
    this.renderMore();
  }

  private renderMore(): void {
    this.moreEl?.remove();
    const end = Math.min(this.entries.length, this.rendered + RENDER_CHUNK);
    for (let i = this.rendered; i < end; i++) this.childrenEl.appendChild(this.renderEntry(this.entries[i]));
    this.rendered = end;
    if (this.rendered < this.entries.length) {
      this.moreEl = this.childrenEl.createDiv({ cls: "search-result-more", text: `Show ${Math.min(RENDER_CHUNK, this.entries.length - this.rendered)} more results` });
      this.moreEl.addEventListener("click", () => this.renderMore());
    }
  }

  isCollapsed(path: string): boolean {
    if (this.o.collapseAll()) return !this.expandedFiles.has(path);
    return this.collapsedFiles.has(path);
  }

  /** Forget per-file collapse choices (Collapse results toggled). */
  resetCollapse(): void {
    this.collapsedFiles.clear();
    this.expandedFiles.clear();
  }

  private renderEntry(entry: ResultEntry): HTMLElement {
    const { app } = this.o;
    const file = entry.file;
    const item = createDiv("tree-item search-result");
    const self = item.createDiv("tree-item-self search-result-file-title is-clickable");
    makeFileDraggable(app, self, file);
    const icon = collapseIcon(self);
    const inner = self.createDiv("tree-item-inner");
    const title = entry.titleIsPath ? file.path : file.extension === "md" ? file.basename : file.name;
    renderHighlighted(inner, title, entry.titleRanges ?? [], entry.titleIsPath || file.extension !== "md" ? 0 : 0);
    const cards = entry.ranges.length ? buildCards(entry.text, entry.ranges, this.o.extraContext()) : [];
    if (cards.length && file.extension !== "canvas") self.createDiv("tree-item-flair-outer").createSpan({ cls: "tree-item-flair", text: String(entry.ranges.length) });
    const matchesEl = item.createDiv("search-result-file-matches");
    if (!cards.length) {
      icon.style.visibility = "hidden";
      matchesEl.style.minHeight = "0px";
    }
    const collapsed = cards.length ? this.isCollapsed(file.path) : false;
    const fill = () => {
      matchesEl.empty();
      matchesEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
      for (const c of cards) matchesEl.appendChild(this.renderCard(entry, c));
    };
    if (!collapsed) fill();
    setCollapsed(item, collapsed);
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = !item.hasClass("is-collapsed");
      if (now) {
        this.collapsedFiles.add(file.path);
        this.expandedFiles.delete(file.path);
        matchesEl.empty();
      } else {
        this.collapsedFiles.delete(file.path);
        this.expandedFiles.add(file.path);
        fill();
      }
      setCollapsed(item, now);
      this.o.onToggle?.();
    });
    self.addEventListener("click", (e) => openFileAt(app, file, e));
    self.addEventListener("contextmenu", (e) => fileContextMenu(app, e, file, this.o.hoverSource));
    self.addEventListener("mouseover", (e) => hoverLink(app, e, this.o.hoverSource, self, file.path, this.o.hoverParent));
    return item;
  }

  private renderCard(entry: ResultEntry, card0: MatchCard): HTMLElement {
    let card = card0;
    const el = createDiv("search-result-file-match tappable");
    const draw = () => {
      el.empty();
      for (const p of cardParts(entry.text, card)) {
        if (p.match) el.createSpan({ cls: "search-result-file-matched-text", text: p.text });
        else el.createSpan({ text: p.text });
      }
      const up = el.createDiv({ cls: "search-result-hover-button mod-top", attr: { "aria-label": "Show more context", "data-tooltip-position": "top" } });
      setIcon(up, "chevron-up");
      const down = el.createDiv({ cls: "search-result-hover-button mod-bottom", attr: { "aria-label": "Show more context" } });
      setIcon(down, "chevron-down");
      up.addEventListener("click", (e) => {
        e.stopPropagation();
        card = extendCard(entry.text, card, "up");
        draw();
      });
      down.addEventListener("click", (e) => {
        e.stopPropagation();
        card = extendCard(entry.text, card, "down");
        draw();
      });
      if (entry.onLink) {
        const btn = el.createEl("button", { cls: "search-result-file-match-replace-button", text: "Link" });
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          entry.onLink!(card.ranges[0]);
        });
      }
    };
    draw();
    el.addEventListener("click", (e) => {
      const r = card.ranges[0];
      const f = entry.matchFile ?? entry.file;
      openFileAt(this.o.app, f, e, f.extension === "md" ? r : undefined, entry.text);
    });
    el.addEventListener("mouseover", (e) => hoverLink(this.o.app, e, this.o.hoverSource, el, entry.file.path, this.o.hoverParent));
    return el;
  }

  /** Plain text of all results ("Copy search results"). */
  toText(): string {
    const out: string[] = [];
    for (const e of this.entries) {
      out.push(`## ${e.file.extension === "md" ? e.file.basename : e.file.name}`);
      for (const c of buildCards(e.text, e.ranges, this.o.extraContext())) out.push(e.text.slice(c.start, c.end));
      out.push("");
    }
    return out.join("\n");
  }
}

export function renderHighlighted(el: HTMLElement, text: string, ranges: Range[], offset = 0): void {
  if (!ranges.length) {
    el.setText(text);
    return;
  }
  let pos = 0;
  for (const [a0, b0] of ranges) {
    const a = a0 - offset;
    const b = b0 - offset;
    if (a < pos || a >= text.length) continue;
    if (a > pos) el.createSpan({ text: text.slice(pos, a) });
    el.createSpan({ cls: "search-result-file-matched-text", text: text.slice(a, b) });
    pos = b;
  }
  if (pos < text.length) el.createSpan({ text: text.slice(pos) });
}
