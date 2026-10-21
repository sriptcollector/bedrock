// Window chrome: our own title bar buttons on Windows/Linux (frameless window) and the status bar.
import { setIcon } from "../dom/icons";
import { IPC } from "../../shared/ipc";

export class TitleBar {
  containerEl: HTMLElement;
  private maxBtn: HTMLElement | null = null;

  constructor(private native: any, platform: string) {
    this.containerEl = createDiv("titlebar");
    const inner = this.containerEl.createDiv("titlebar-inner");
    inner.createDiv("titlebar-text");
    if (platform === "darwin") return;
    const btns = inner.createDiv("titlebar-button-container mod-right");
    const mk = (cls: string, icon: string, label: string, action: string) => {
      const b = btns.createDiv({ cls: `titlebar-button ${cls}`, attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", () => native.windowControl(action));
      return b;
    };
    mk("mod-minimize", "minus", "Minimize", "minimize");
    this.maxBtn = mk("mod-maximize", "square", "Maximize", "maximize");
    mk("mod-close", "x", "Close", "close");
    native.on(IPC.windowStateChanged, (s: any) => this.setState(s));
    native.invoke(IPC.windowState).then((s: any) => this.setState(s));
  }

  private setState(s: { maximized: boolean; focused: boolean; fullscreen: boolean }): void {
    document.body.toggleClass("is-maximized", !!s.maximized);
    document.body.toggleClass("is-fullscreen", !!s.fullscreen);
    document.body.toggleClass("is-focused", !!s.focused);
    if (this.maxBtn) {
      setIcon(this.maxBtn, s.maximized ? "copy" : "square");
      this.maxBtn.setAttr("aria-label", s.maximized ? "Restore down" : "Maximize");
    }
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
    const words = (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
    const chars = body.length;
    this.countEl.setText(`${words.toLocaleString()} ${words === 1 ? "word" : "words"} ${chars.toLocaleString()} ${chars === 1 ? "character" : "characters"}`);
  }
}
