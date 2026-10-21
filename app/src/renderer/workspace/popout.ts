// Popout windows (workspace "floating" split). Like the original, a popout is a real window the
// main renderer opens with window.open() and drives directly: the same App, vault, metadata
// cache and plugins, so everything stays in sync. Each WorkspaceWindow is a split whose DOM lives
// in the popout's document; layout is saved under "floating" in workspace.json.
import { WorkspaceParent, WorkspaceSplit, WorkspaceTabs, type WorkspaceItem } from "./items";
import type { Workspace } from "./workspace";
import { WorkspaceLeaf } from "./leaf";
import { installDomHelpers } from "../dom/augment";

let counter = 0;

/** Move CodeMirror views to their new document (they cache the document they were created in). */
function rerootEditors(item: WorkspaceItem, doc: Document): void {
  const visit = (x: WorkspaceItem) => {
    if (x instanceof WorkspaceLeaf) {
      const v: any = x.view;
      try {
        v?.cm?.setRoot?.(doc);
      } catch {
        /* ignore */
      }
      return;
    }
    if (x instanceof WorkspaceParent) x.children.forEach(visit);
  };
  visit(item);
}

export class WorkspaceWindow extends WorkspaceSplit {
  type = "window";
  win: Window;
  doc: Document;
  private observer: MutationObserver | null = null;
  private closing = false;
  bounds: { x?: number; y?: number; width: number; height: number } = { width: 800, height: 600 };

  constructor(workspace: Workspace, bounds?: { x?: number; y?: number; width?: number; height?: number }) {
    super(workspace, "vertical");
    this.containerEl.addClass("mod-root");
    if (bounds) this.bounds = { width: bounds.width ?? 800, height: bounds.height ?? 600, x: bounds.x, y: bounds.y };
    const b = this.bounds;
    const features = `width=${Math.round(b.width)},height=${Math.round(b.height)}` + (b.x != null ? `,left=${Math.round(b.x)},top=${Math.round(b.y ?? 0)}` : "");
    const win = window.open("about:blank", `bedrock-popout-${Date.now()}-${++counter}`, features);
    if (!win) throw new Error("Couldn't open a new window.");
    this.win = win;
    this.doc = win.document;
    this.setupDocument();
  }

  private setupDocument(): void {
    const doc = this.doc;
    doc.title = document.title;
    const base = doc.createElement("base");
    base.href = document.baseURI;
    doc.head.appendChild(base);
    const meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    doc.head.appendChild(meta);
    // Same stylesheets as the main window (theme, snippets, KaTeX...), kept in sync.
    const syncStyles = () => {
      doc.head.querySelectorAll("[data-bedrock-copied]").forEach((e) => e.remove());
      document.head.querySelectorAll("link[rel=stylesheet], style").forEach((el) => {
        const c = el.cloneNode(true) as HTMLElement;
        c.setAttribute("data-bedrock-copied", "");
        doc.head.appendChild(c);
      });
      doc.body.className = document.body.className + " is-popout-window";
      doc.body.setAttribute("style", document.body.getAttribute("style") ?? "");
      doc.documentElement.className = document.documentElement.className;
      doc.documentElement.setAttribute("style", document.documentElement.getAttribute("style") ?? "");
    };
    syncStyles();
    this.observer = new MutationObserver(() => syncStyles());
    this.observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    try {
      installDomHelpers(this.win as any);
    } catch {
      /* helpers only matter for nodes the popout document creates itself */
    }
    const app = doc.body.appendChild(doc.createElement("div"));
    app.className = "app-container";
    const main = app.appendChild(doc.createElement("div"));
    main.className = "horizontal-main-container";
    const ws = main.appendChild(doc.createElement("div"));
    ws.className = "workspace is-popout";
    ws.appendChild(this.containerEl);
    // Keys go through the app's keymap/hotkeys like in the main window.
    const appObj: any = this.workspace.app;
    this.win.addEventListener("keydown", (e) => appObj.onKeyDown?.(e), true);
    this.win.addEventListener("resize", () => {
      this.bounds.width = this.win.outerWidth;
      this.bounds.height = this.win.outerHeight;
      this.workspace.onResize();
      this.workspace.requestSaveLayout();
    });
    this.win.addEventListener("focus", () => {
      const leaf = this.workspace.getMostRecentLeaf(this);
      if (leaf && this.workspace.activeLeaf !== leaf) this.workspace.setActiveLeaf(leaf, { focus: false });
    });
    this.win.addEventListener("beforeunload", () => {
      if (!this.closing) this.onWindowClosed();
    });
  }

  protected attachChildEl(index: number, child: WorkspaceItem): void {
    super.attachChildEl(index, child);
    rerootEditors(child, this.doc);
    queueMicrotask(() => rerootEditors(child, this.doc));
  }

  /** The user closed the window: drop its leaves. */
  private onWindowClosed(): void {
    this.closing = true;
    this.observer?.disconnect();
    const leaves: WorkspaceLeaf[] = [];
    const visit = (x: WorkspaceItem) => {
      if (x instanceof WorkspaceLeaf) leaves.push(x);
      else if (x instanceof WorkspaceParent) x.children.forEach(visit);
    };
    this.children.forEach(visit);
    for (const l of leaves) l.detach();
    this.parent?.removeChild(this, true);
    this.workspace.requestSaveLayout();
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.observer?.disconnect();
    const leaves: WorkspaceLeaf[] = [];
    const visit = (x: WorkspaceItem) => {
      if (x instanceof WorkspaceLeaf) leaves.push(x);
      else if (x instanceof WorkspaceParent) x.children.forEach(visit);
    };
    this.children.forEach(visit);
    for (const l of leaves) l.detach();
    this.parent?.removeChild(this, true);
    try {
      this.win.close();
    } catch {
      /* already closed */
    }
    this.workspace.requestSaveLayout();
  }

  cleanupIfEmpty(): void {
    if (this.children.length === 0) this.close();
  }

  serialize(): any {
    const o = super.serialize();
    o.type = "window";
    try {
      o.x = this.win.screenX;
      o.y = this.win.screenY;
      o.width = this.win.outerWidth;
      o.height = this.win.outerHeight;
    } catch {
      Object.assign(o, this.bounds);
    }
    o.maximize = false;
    o.zoom = 0;
    return o;
  }
}

/** Holds the popout windows (workspace.floatingSplit). */
export class WorkspaceFloating extends WorkspaceParent {
  type = "floating";
  declare children: WorkspaceWindow[];
  constructor(workspace: Workspace) {
    super(workspace);
    this.containerEl = createDiv("workspace-floating");
  }
  protected attachChildEl(): void {
    /* windows live in their own documents */
  }
  serialize(): any {
    return { id: this.id, type: "floating", children: this.children.map((c) => c.serialize()) };
  }
  closeAll(): void {
    for (const w of this.children.slice()) w.close();
  }
}

/** A new popout window with one empty tab group; returns its first leaf. */
export function openPopout(ws: Workspace, bounds?: { x?: number; y?: number; width?: number; height?: number }): WorkspaceLeaf {
  const floating: WorkspaceFloating = (ws as any).floatingSplit;
  const win = new WorkspaceWindow(ws, bounds);
  floating.insertChild(floating.children.length, win);
  const tabs = new WorkspaceTabs(ws);
  win.insertChild(0, tabs);
  const leaf = ws.createLeafInTabs(tabs, 0);
  ws.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

/** Move an existing leaf into a new popout window. */
export function moveToPopout(ws: Workspace, leaf: WorkspaceLeaf): WorkspaceLeaf {
  const floating: WorkspaceFloating = (ws as any).floatingSplit;
  const rect = leaf.containerEl.getBoundingClientRect();
  const win = new WorkspaceWindow(ws, { width: Math.max(500, rect.width), height: Math.max(400, rect.height + 40), x: window.screenX + rect.left + 40, y: window.screenY + rect.top + 40 });
  floating.insertChild(floating.children.length, win);
  const tabs = new WorkspaceTabs(ws);
  win.insertChild(0, tabs);
  const old = leaf.parent as WorkspaceTabs | null;
  tabs.insertChild(0, leaf);
  old?.cleanupIfEmpty();
  rerootEditors(leaf, win.doc);
  tabs.updateTabDisplay?.();
  ws.setActiveLeaf(leaf, { focus: true });
  ws.requestSaveLayout();
  return leaf;
}

/** Re-open saved popout windows (layout.floating). */
export function restoreFloating(ws: Workspace, data: any, fill: (dock: WorkspaceSplit, data: any) => void): void {
  const floating: WorkspaceFloating = (ws as any).floatingSplit;
  for (const w of data?.children ?? []) {
    if (w?.type !== "window") continue;
    let win: WorkspaceWindow;
    try {
      win = new WorkspaceWindow(ws, { x: w.x, y: w.y, width: w.width, height: w.height });
    } catch {
      continue;
    }
    if (w.id) win.id = w.id;
    floating.insertChild(floating.children.length, win);
    fill(win, w);
    if (!win.children.length) win.close();
  }
}
