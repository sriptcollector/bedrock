// Popout windows for the settings window and the plugin/theme browsers. Like Obsidian 1.14 the
// window is an about:blank child window whose DOM is built and driven from this (the vault
// window's) renderer, so every setting tab, plugin settings tab and modal keeps working with the
// same objects. Styles, theme classes and CSS variables are mirrored from the main window.
import { ipcRenderer } from "electron";
import { setIcon } from "../dom/icons";
import { installDomHelpers } from "../dom/augment";
import { installTooltips } from "../ui/tooltip";
import { SETTINGS_IPC } from "../../shared/ipc-settings";

export interface PopoutOptions {
  name: string; // unique per kind ("settings", "community-plugins", "community-themes")
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  /** Screen position (tab popouts restore where they were). */
  x?: number;
  y?: number;
  /** Tab popouts have no title bar: the tab row is the drag area. */
  noTitleBar?: boolean;
  /** Height of the native caption buttons (Windows/Linux), default 30. */
  overlayHeight?: number;
  title: string;
  /** Extra body classes for the popout (e.g. is-popout-modal). */
  bodyClasses?: string[];
  onKeyDown?: (e: KeyboardEvent) => void;
  onClose?: () => void;
}

const NEED_OWN_BUTTONS = false;

export function toHex(c: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) return c.trim();
  const r = /rgba?(([^)]+))/.exec(c);
  if (!r) return null;
  const [a, b, d] = r[1].split(",").map((x) => Math.round(parseFloat(x)));
  return "#" + [a, b, d].map((x) => Math.max(0, Math.min(255, x || 0)).toString(16).padStart(2, "0")).join("");
}

const MIRRORED_BODY_PREFIXES = ["theme-", "mod-", "is-frameless", "is-hidden-frameless", "styled-scrollbars", "show-", "is-floating-nav", "auto-full-screen", "is-translucent"];

let mainFocusHooked = false;
function hookMainFocus(): void {
  if (mainFocusHooked) return;
  mainFocusHooked = true;
  window.addEventListener("focus", () => {
    (window as any).activeWindow = window;
    (window as any).activeDocument = document;
  });
}

export class PopoutWindow {
  win: Window | null = null;
  doc: Document | null = null;
  bodyEl!: HTMLElement;
  titleEl!: HTMLElement;
  private observers: MutationObserver[] = [];
  private styleClones = new Map<Node, Node>();
  private offState: (() => void) | null = null;
  private closing = false;
  private frameName: string;

  constructor(private opts: PopoutOptions) {
    this.frameName = "bedrock-popout-" + opts.name;
  }

  get isOpen(): boolean {
    return !!this.win && !this.win.closed;
  }

  /** Opens (or focuses) the window. Returns the body element to render into, or null when the
   * window couldn't be opened (caller falls back to an in-window modal). */
  open(): HTMLElement | null {
    if (this.isOpen) {
      this.focus();
      return this.bodyEl;
    }
    const o = this.opts;
    const bg = getComputedStyle(document.body).getPropertyValue("--background-primary").trim();
    const tb = getComputedStyle(document.body).getPropertyValue("--titlebar-background").trim();
    const fg = getComputedStyle(document.body).getPropertyValue("--icon-color").trim() || getComputedStyle(document.body).getPropertyValue("--text-muted").trim();
    const features = [`popup`, `width=${o.width}`, `height=${o.height}`, `minWidth=${o.minWidth ?? 600}`, `minHeight=${o.minHeight ?? 400}`, toHex(tb || bg) ? `background=${encodeURIComponent(toHex(tb || bg)!)}` : "", toHex(fg) ? `symbol=${encodeURIComponent(toHex(fg)!)}` : "", o.x !== undefined ? `left=${Math.round(o.x)}` : "", o.y !== undefined ? `top=${Math.round(o.y)}` : "", o.overlayHeight ? `overlay=${o.overlayHeight}` : ""].filter(Boolean).join(",");
    let w: Window | null = null;
    try {
      w = window.open("about:blank", this.frameName, features);
    } catch (e) {
      console.error("Popout window failed", e);
    }
    if (!w) return null;
    this.win = w;
    this.closing = false;
    // Standards-mode document (about:blank starts in quirks mode).
    const d = w.document;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>');
    d.close();
    this.doc = d;
    installDomHelpers(w as any);
    installTooltips(d);
    const base = d.createElement("base");
    base.href = location.href;
    d.head.appendChild(base);
    d.title = o.title;
    this.mirrorStyles();
    this.mirrorBody();
    this.bodyEl = d.body;
    if (!o.noTitleBar) this.buildTitleBar();
    this.recolourOverlay();
    hookMainFocus();
    const setActive = () => {
      (window as any).activeWindow = w;
      (window as any).activeDocument = d;
    };
    setActive();
    w.addEventListener("focus", setActive);
    w.addEventListener("keydown", (e) => o.onKeyDown?.(e), true);
    // Drag & drop of files onto the popout must not navigate it.
    w.addEventListener("dragover", (e) => e.preventDefault());
    w.addEventListener("drop", (e) => e.preventDefault());
    w.addEventListener("beforeunload", () => this.handleClosed());
    window.addEventListener("beforeunload", () => this.close());
    const onState = (_e: unknown, name: string, s: any) => name === this.frameName && this.setState(s);
    const onClosed = (_e: unknown, name: string) => name === this.frameName && this.handleClosed();
    ipcRenderer.on(SETTINGS_IPC.popoutState, onState);
    ipcRenderer.on(SETTINGS_IPC.popoutClosed, onClosed);
    this.offState = () => {
      ipcRenderer.removeListener(SETTINGS_IPC.popoutState, onState);
      ipcRenderer.removeListener(SETTINGS_IPC.popoutClosed, onClosed);
    };
    return this.bodyEl;
  }

  setTitle(t: string): void {
    if (!this.doc) return;
    this.doc.title = t;
    this.titleEl?.setText(t);
  }

  focus(): void {
    ipcRenderer.invoke(SETTINGS_IPC.popoutControl, this.frameName, "focus");
  }

  /** "minimize" | "maximize" | "close" | "focus" | "always-on-top" | "devtools". */
  control(action: string): Promise<any> {
    return ipcRenderer.invoke(SETTINGS_IPC.popoutControl, this.frameName, action);
  }

  close(): void {
    if (!this.win || this.closing) return;
    const w = this.win;
    this.handleClosed();
    try {
      w.close();
    } catch {
      /* already gone */
    }
  }

  private handleClosed(): void {
    if (this.closing) return;
    this.closing = true;
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    this.styleClones.clear();
    this.offState?.();
    this.offState = null;
    if ((window as any).activeWindow === this.win) {
      (window as any).activeWindow = window;
      (window as any).activeDocument = document;
    }
    this.win = null;
    this.doc = null;
    this.opts.onClose?.();
  }

  private buildTitleBar(): void {
    const d = this.doc!;
    const bar = d.body.createDiv("titlebar");
    const inner = bar.createDiv("titlebar-inner");
    this.titleEl = inner.createDiv({ cls: "titlebar-text", text: this.opts.title });
    // Windows/Linux: native caption buttons are drawn over this bar (titleBarOverlay, as in the
    // vault window); only recolour them with the theme.
    if (process.platform === "darwin" || !NEED_OWN_BUTTONS) return;
    const btns = inner.createDiv("titlebar-button-container mod-right");
    const mk = (cls: string, icon: string, label: string, action: string) => {
      const b = btns.createDiv({ cls: `titlebar-button ${cls}`, attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", async () => {
        const s = await ipcRenderer.invoke(SETTINGS_IPC.popoutControl, this.frameName, action);
        if (s) this.setState(s);
      });
      return b;
    };
    mk("mod-minimize", "minus", "Minimize", "minimize");
    mk("mod-maximize", "square", "Maximize", "maximize");
    mk("mod-close", "x", "Close window", "close");
  }

  private lastOverlay = "";
  /** Match the native caption buttons to the theme (Windows/Linux). */
  private recolourOverlay(): void {
    if (process.platform === "darwin" || !this.doc) return;
    const bar = (this.doc.querySelector(".titlebar") ?? this.doc.querySelector(".workspace-tab-header-container")) as HTMLElement | null;
    const w = this.doc.defaultView!;
    const bg = toHex(bar ? w.getComputedStyle(bar).backgroundColor : "") ?? "#00000000";
    const fg = toHex(w.getComputedStyle(this.doc.body).getPropertyValue("--icon-color") || w.getComputedStyle(this.doc.body).color) ?? "#888888";
    const key = bg + "|" + fg;
    if (key === this.lastOverlay) return;
    this.lastOverlay = key;
    void ipcRenderer.invoke(SETTINGS_IPC.popoutControl, this.frameName, "overlay:" + key + (this.opts.overlayHeight ? "|" + this.opts.overlayHeight : ""));
  }

  private setState(s: { maximized: boolean; focused: boolean; fullscreen?: boolean }): void {
    const b = this.doc?.body;
    if (!b) return;
    b.toggleClass("is-maximized", !!s.maximized);
    b.toggleClass("is-focused", !!s.focused);
    const max = b.querySelector(".titlebar-button.mod-maximize") as HTMLElement | null;
    if (max) {
      setIcon(max, s.maximized ? "copy" : "square");
      max.setAttr("aria-label", s.maximized ? "Restore down" : "Maximize");
    }
  }

  /** Copy <link rel=stylesheet> and <style> from the main head and keep them in sync. */
  private mirrorStyles(): void {
    const d = this.doc!;
    const sync = () => {
      if (!this.doc) return;
      const wanted = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'));
      const keep = new Set<Node>();
      let prev: Node | null = d.head.querySelector("base");
      for (const src of wanted) {
        let clone = this.styleClones.get(src);
        if (!clone) {
          if (src instanceof HTMLLinkElement) {
            const l = d.createElement("link");
            l.rel = "stylesheet";
            l.href = src.href;
            clone = l;
          } else {
            const s = d.createElement("style");
            for (const a of Array.from((src as HTMLElement).attributes)) s.setAttribute(a.name, a.value);
            clone = s;
          }
          this.styleClones.set(src, clone);
        }
        if (clone instanceof (d.defaultView as any).HTMLStyleElement && clone.textContent !== src.textContent) clone.textContent = src.textContent;
        keep.add(src);
        if (prev && prev.nextSibling !== clone) d.head.insertBefore(clone, prev.nextSibling);
        else if (!prev) d.head.appendChild(clone);
        prev = clone;
      }
      for (const [src, clone] of Array.from(this.styleClones)) {
        if (!keep.has(src)) {
          (clone as ChildNode).remove();
          this.styleClones.delete(src);
        }
      }
    };
    sync();
    let t: any = null;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(sync, 30);
    });
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    this.observers.push(mo);
  }

  private mirrorBody(): void {
    const d = this.doc!;
    const extra = ["is-popout-window", ...(this.opts.bodyClasses ?? [])];
    const sync = () => {
      if (!this.doc) return;
      const keepOwn = Array.from(d.body.classList).filter((c) => ["is-maximized", "is-focused"].includes(c));
      const mirrored = Array.from(document.body.classList).filter((c) => MIRRORED_BODY_PREFIXES.some((p) => c.startsWith(p)));
      d.body.className = [...mirrored, ...extra, ...keepOwn].join(" ");
      d.body.setAttribute("style", document.body.getAttribute("style") ?? "");
      this.recolourOverlay();
    };
    sync();
    d.body.addClass("is-focused");
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    this.observers.push(mo);
  }
}
