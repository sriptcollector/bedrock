// Popout windows for tabs (obsidian API: WorkspaceWindow / WorkspaceFloating). Like the settings
// window, a popout is an about:blank child window whose DOM is built and driven from the vault
// window's renderer, so every view, plugin and modal works with the same objects and app state.
// workspace.json keeps them under "floating": {type:"floating", children:[{type:"window", ...}]}.
import { EditorView } from "@codemirror/view";
import { PopoutWindow } from "../settings/popout";
import { WorkspaceParent, WorkspaceSplit, type WorkspaceItem } from "./items";
import type { Workspace } from "./workspace";

let popoutSeq = 0;

export interface WindowGeometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximize?: boolean;
}

/** The invisible parent of every popout window (workspace.floatingSplit). */
export class WorkspaceFloating extends WorkspaceParent {
  type = "floating";
  declare children: WorkspaceWindow[];

  constructor(workspace: Workspace) {
    super(workspace);
    this.containerEl = createDiv("workspace-floating");
  }

  protected attachChildEl(): void {
    /* each window has its own document */
  }

  serialize(): any {
    return { id: this.id, type: "floating", children: this.children.map((c) => c.serialize()) };
  }
}

/** The root split of one popout window. */
export class WorkspaceWindow extends WorkspaceSplit {
  type = "window";
  popout: PopoutWindow;
  win!: Window;
  doc!: Document;
  rootEl!: HTMLElement;
  private geometry: WindowGeometry;
  private closingFromApp = false;

  constructor(workspace: Workspace, geometry: WindowGeometry = {}) {
    super(workspace, "vertical");
    this.geometry = geometry;
    this.containerEl.addClass("mod-root");
    const w = Math.round(geometry.width ?? Math.max(600, Math.min(window.outerWidth * 0.8, 1000)));
    const h = Math.round(geometry.height ?? Math.max(400, Math.min(window.outerHeight * 0.8, 800)));
    this.popout = new PopoutWindow({
      name: `workspace-${Date.now().toString(36)}-${++popoutSeq}`,
      width: w,
      height: h,
      x: geometry.x,
      y: geometry.y,
      minWidth: 400,
      minHeight: 300,
      title: workspace.app.brand?.displayName ?? "",
      noTitleBar: true,
      overlayHeight: 39,
      bodyClasses: ["is-popout-workspace"],
      onKeyDown: (e) => (workspace.app as any).onKeyDown?.(e),
      onClose: () => this.onWindowClosed(),
    });
  }

  /** Open the OS window and build the workspace DOM in it. Returns false if it couldn't open. */
  openWindow(): boolean {
    const body = this.popout.open();
    if (!body) return false;
    this.win = this.popout.win!;
    this.doc = this.popout.doc!;
    const app = body.createDiv("app-container");
    const main = app.createDiv("horizontal-main-container");
    this.rootEl = main.createDiv("workspace is-popout-workspace");
    this.rootEl.appendChild(this.containerEl);
    if (this.geometry.maximize) this.popout.control("maximize");
    this.win.addEventListener("resize", () => {
      this.workspace.onResize();
      this.markTopRight();
      this.workspace.requestSaveLayout();
    });
    this.win.addEventListener("focus", () => {
      const leaf = this.workspace.getMostRecentLeaf(this);
      if (leaf && this.workspace.activeLeaf?.getContainer() !== this) this.workspace.setActiveLeaf(leaf, { focus: false });
    });
    // Mouse events (tab drag ends, resize handles) must reach the main document's listeners too.
    for (const t of ["mousemove", "mouseup"]) this.win.addEventListener(t, (e) => document.dispatchEvent(new MouseEvent(t, e as MouseEvent)));
    return true;
  }

  getContainer(): WorkspaceParent {
    return this;
  }

  /** Move CodeMirror editors of the leaves in this window onto its document. */
  adoptEditors(): void {
    if (!this.doc) return;
    for (const el of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".cm-editor"))) {
      const v = EditorView.findFromDOM(el);
      if (v && (v.root as any) !== this.doc) {
        try {
          v.setRoot(this.doc);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  markTopRight(): void {
    if (!this.doc) return;
    const w = this.win.innerWidth;
    for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>(".workspace-tabs.mod-top"))) {
      const r = el.getBoundingClientRect();
      el.toggleClass("mod-top-right-space", r.width > 0 && r.top <= 1 && Math.abs(r.right - w) <= 1);
    }
  }

  cleanupIfEmpty(): void {
    if (this.children.length === 0) this.close();
  }

  /** Close the window; its leaves are detached. */
  close(): void {
    if (this.closingFromApp) return;
    this.closingFromApp = true;
    this.popout.close();
  }

  private onWindowClosed(): void {
    // The user closed the OS window (or close() ran): drop the leaves and this root.
    const ws = this.workspace;
    const leaves: any[] = [];
    ws.iterateLeavesOf(this, (l) => void leaves.push(l));
    for (const l of leaves) {
      l.parent?.removeChild(l, true);
      void l.destroy();
      if (ws.activeLeaf === l) ws.activeLeaf = null;
    }
    this.parent?.removeChild(this, true);
    if (!ws.activeLeaf) {
      const next = ws.getMostRecentLeaf();
      if (next) ws.setActiveLeaf(next, { focus: true });
    }
    ws.trigger("window-close", this, this.win);
    ws.trigger("layout-change");
    ws.requestSaveLayout();
  }

  serialize(): any {
    const o = super.serialize();
    o.type = "window";
    delete o.dimension;
    try {
      if (this.win && !this.win.closed) {
        o.x = this.win.screenX;
        o.y = this.win.screenY;
        o.width = this.win.outerWidth;
        o.height = this.win.outerHeight;
      } else Object.assign(o, this.geometry);
    } catch {
      Object.assign(o, this.geometry);
    }
    if (this.doc?.body.hasClass("is-maximized")) o.maximize = true;
    return o;
  }
}

export function isWorkspaceWindow(item: WorkspaceItem | null | undefined): item is WorkspaceWindow {
  return item instanceof WorkspaceWindow;
}
