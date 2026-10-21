// Window chrome: our own title bar buttons on Windows/Linux (frameless window) and the status bar.
import { IPC } from "../../shared/ipc";

export class TitleBar {
  containerEl: HTMLElement;

  constructor(private native: any, platform: string) {
    this.containerEl = createDiv("titlebar");
    const inner = this.containerEl.createDiv("titlebar-inner");
    inner.createDiv("titlebar-text");
    if (platform === "darwin") return;
    // Windows/Linux: the minimize/maximize/close buttons are the system's own (titleBarOverlay in
    // the main process). This container only reserves their space, like the original app.
    inner.createDiv("titlebar-button-container mod-right");
    document.body.addClass("is-frameless", "is-hidden-frameless");
    native.on(IPC.windowStateChanged, (s: any) => this.setState(s));
    native.invoke(IPC.windowState).then((s: any) => this.setState(s));
  }

  /** Give the system caption buttons our theme's colours (call after every theme/CSS change). */
  syncOverlayColors(): void {
    if (document.body.hasClass("mod-macos")) return;
    const cs = getComputedStyle(document.body);
    const bg = (cs.getPropertyValue("--titlebar-background") || cs.getPropertyValue("--background-secondary")).trim();
    const fg = (cs.getPropertyValue("--titlebar-text-color") || cs.getPropertyValue("--text-muted")).trim();
    this.native.invoke(IPC.titleBarOverlay, { color: toHex(bg) ?? "#00000000", symbolColor: toHex(fg) ?? "#888888" });
  }

  /** The tab group in the top-right corner leaves room for the caption buttons (mod-top-right-space). */
  static markTopRight(): void {
    const w = window.innerWidth;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".workspace-tabs.mod-top"))) {
      const r = el.getBoundingClientRect();
      el.toggleClass("mod-top-right-space", r.width > 0 && r.top <= 1 && Math.abs(r.right - w) <= 1);
    }
  }

  private setState(s: { maximized: boolean; focused: boolean; fullscreen: boolean }): void {
    document.body.toggleClass("is-maximized", !!s.maximized);
    document.body.toggleClass("is-fullscreen", !!s.fullscreen);
    document.body.toggleClass("is-focused", !!s.focused);
  }
}

export class StatusBar {
  containerEl: HTMLElement;
  private countEl: HTMLElement;

  constructor(private app: any) {
    this.containerEl = createDiv("status-bar");
    this.countEl = this.containerEl.createDiv("status-bar-item plugin-word-count");
    const update = () => this.updateCount();
    app.workspace.on("active-leaf-change", update);
    app.workspace.on("editor-change", () => {
      clearTimeout((this as any).t);
      (this as any).t = setTimeout(update, 300);
    });
    app.workspace.on("file-open", update);
  }

  updateCount(): void {
    const v = this.app.workspace.activeEditor;
    if (!v?.editor) {
      this.countEl.setText("");
      return;
    }
    const sel = v.editor.getSelection();
    const text: string = sel || v.editor.getValue();
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
    // Runs of text between spaces and Markdown/code punctuation (matches the original's counts on the demo vault).
    const words = (body.match(/[^\s/|[\]()#*=~`>"!,.:;?{}+<]+/gu) ?? []).length;
    const chars = body.length;
    this.countEl.empty();
    this.countEl.createSpan({ cls: "status-bar-item-segment", text: `${words.toLocaleString()} ${words === 1 ? "word" : "words"}` });
    this.countEl.createSpan({ cls: "status-bar-item-segment", text: `${chars.toLocaleString()} ${chars === 1 ? "character" : "characters"}` });
  }
}

/** Any CSS colour -> #rrggbb (the overlay API wants hex). */
function toHex(c: string): string | null {
  if (!c) return null;
  const probe = document.createElement("div");
  probe.style.color = c;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  return "#" + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("");
}
