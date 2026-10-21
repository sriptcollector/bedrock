// Help window (F1, 600x680: version, documentation, where to ask, sandbox vault) and the
// "release-notes" view opened by "Show release notes".
import { ipcRenderer } from "electron";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { BRAND, INSPIRED_BY } from "../../shared/brand";
import { PopoutWindow } from "../settings/popout";
import { ItemView } from "../workspace/view";
import type { WorkspaceLeaf } from "../workspace/leaf";

export const HELP_URL = `https://github.com/${BRAND.repo}#readme`;
export const ISSUES_URL = `https://github.com/${BRAND.repo}/issues`;
export const RELEASES_URL = `https://github.com/${BRAND.repo}/releases`;

const CSS = `
.help-window { padding: 40px 32px 24px; color: var(--text-normal); font-size: var(--font-ui-medium); }
.help-window-title { font-size: 1.5em; font-weight: var(--font-bold); }
.help-window-version { color: var(--text-muted); margin-bottom: 20px; }
.help-window .setting-item { padding: 14px 0; }
.help-window-credit { margin-top: 24px; color: var(--text-faint); font-size: var(--font-ui-smaller); }
`;

let helpWin: PopoutWindow | null = null;

export function isHelpOpen(): boolean {
  return !!helpWin?.isOpen;
}

function row(parent: HTMLElement, name: string, desc: string, button: string, cta: boolean, cb: () => any): void {
  const r = parent.createDiv("setting-item");
  const info = r.createDiv("setting-item-info");
  info.createDiv({ cls: "setting-item-name", text: name });
  info.createDiv({ cls: "setting-item-description", text: desc });
  r.createDiv("setting-item-control").createEl("button", { text: button, cls: cta ? "mod-cta" : "" }).addEventListener("click", cb);
}

export function openHelpWindow(app: any): void {
  if (helpWin?.isOpen) {
    helpWin.focus();
    return;
  }
  helpWin = new PopoutWindow({ name: "help", width: 600, height: 680, minWidth: 420, minHeight: 400, title: `${BRAND.displayName} Help`, bodyClasses: ["is-help-window"], onKeyDown: (e) => e.key === "Escape" && helpWin?.close() });
  const body = helpWin.open();
  if (!body) {
    app.openExternal(HELP_URL);
    return;
  }
  helpWin.doc!.head.createEl("style").textContent = CSS;
  const el = body.createDiv("help-window");
  el.createDiv({ cls: "help-window-title", text: `${BRAND.displayName} Help` });
  el.createDiv({ cls: "help-window-version", text: `Version ${app.version}` });
  row(el, "Documentation", "Read how to use the app: notes, links, sync and more.", "Visit", true, () => app.openExternal(HELP_URL));
  row(el, "Ask a question or report a problem", "Open an issue on GitHub. Include what you did and what happened.", "Open", false, () => app.openExternal(ISSUES_URL));
  row(el, "Release notes", "See what changed in each version.", "Open", false, () => {
    helpWin?.close();
    app.commands.executeCommandById("app:show-release-notes");
  });
  row(el, "Sandbox vault", "Try things out in a separate vault without touching your notes.", "Open", false, () => ipcRenderer.invoke(SHELL_IPC.openSandbox));
  if (INSPIRED_BY) el.createDiv({ cls: "help-window-credit", text: `Inspired by ${INSPIRED_BY.name}. ${INSPIRED_BY.notAffiliated}` });
}

export const RELEASE_NOTES_VIEW = "release-notes";

export class ReleaseNotesView extends ItemView {
  icon = "book-up";
  version = "";
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }
  getViewType(): string {
    return RELEASE_NOTES_VIEW;
  }
  getDisplayText(): string {
    return `Release Notes ${this.version || this.app.version}`;
  }
  getState(): Record<string, any> {
    return { currentVersion: this.version || this.app.version };
  }
  async setState(state: any): Promise<void> {
    this.version = state?.currentVersion || this.app.version;
    this.render();
    this.leaf.updateHeader();
  }
  protected async onOpen(): Promise<void> {
    this.render();
  }
  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("markdown-preview-view", "markdown-rendered", "is-readable-line-width");
    const s = c.createDiv("markdown-preview-sizer markdown-preview-section");
    s.createEl("h1", { text: `${BRAND.displayName} ${this.version || this.app.version}` });
    const callout = s.createDiv({ cls: "callout", attr: { "data-callout": "info" } });
    callout.createDiv("callout-title").createDiv({ cls: "callout-title-inner", text: `What's new in ${this.version || this.app.version}` });
    const content = callout.createDiv("callout-content");
    content.createEl("p", { text: "The full notes for every version, with what changed and what was fixed, are published with each release on GitHub." });
    const p = content.createEl("p");
    const a = p.createEl("a", { cls: "external-link", text: "Read the release notes", href: `${RELEASES_URL}/tag/v${this.version || this.app.version}` });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.openExternal(a.href);
    });
    const other = s.createEl("p");
    const all = other.createEl("a", { cls: "external-link", text: "Other versions", href: RELEASES_URL });
    all.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.openExternal(RELEASES_URL);
    });
  }
}
