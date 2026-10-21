// Small pieces of window chrome: the indexing progress item in the status bar while a vault is
// being read, and the right sidebar toggle at the top right of the tab bar.
import { ipcRenderer } from "electron";
import { setIcon } from "../dom/icons";

export function mountIndexingStatus(app: any): void {
  const bar: HTMLElement = app.statusBar.containerEl;
  const el = createDiv({ cls: "status-bar-item mod-indexing", attr: { "aria-label": "Reading the files in your vault", "data-tooltip-position": "top" } });
  el.createSpan("status-bar-item-icon bedrock-spinner");
  const text = el.createSpan({ cls: "status-bar-item-segment", text: "Indexing..." });
  bar.prepend(el);
  let shownAt = 0;
  app.onIndexProgress = (done: number, total: number) => {
    if (!shownAt) shownAt = Date.now();
    text.setText(`Indexing ${done.toLocaleString()} of ${total.toLocaleString()} files`);
  };
  const finish = () => {
    if (!app.indexStats) return false;
    el.remove();
    return true;
  };
  if (!finish()) {
    const t = setInterval(() => finish() && clearInterval(t), 200);
  }
}

/** The right sidebar toggle sits at the right end of the top-right tab bar (before the window buttons). */
export function mountRightSidebarToggle(app: any): void {
  const ws = app.workspace;
  const btn = createDiv("sidebar-toggle-button mod-right");
  const icon = btn.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Toggle right sidebar", "data-tooltip-position": "bottom" } });
  setIcon(icon, "panel-right");
  icon.addEventListener("click", () => ws.rightSplit.toggle());
  const place = () => {
    const tabs = ws.rootSplit.containerEl.ownerDocument.querySelector(".workspace-tabs.is-top-right, .workspace-tabs.mod-top-right-space") as HTMLElement | null;
    const header = tabs?.querySelector(":scope > .workspace-tab-header-container") as HTMLElement | null;
    if (header && btn.parentElement !== header) header.appendChild(btn);
    btn.toggleClass("is-collapsed", ws.rightSplit.collapsed);
  };
  ws.on("layout-change", () => requestAnimationFrame(place));
  ws.on("resize", () => requestAnimationFrame(place));
  ws.onLayoutReady(() => requestAnimationFrame(place));
}

/** Window frame style (Settings › Interface, applies after relaunch): hidden (default), app frame, native frame. */
export async function applyFrameStyle(app: any): Promise<void> {
  if (process.platform === "darwin") return;
  const s = await ipcRenderer.invoke("bedrock:app-settings-get").catch(() => ({}));
  const frame = s?.frame ?? "hidden";
  const b = document.body;
  b.setAttribute("data-frame", frame);
  if (frame === "native") b.removeClass("is-frameless", "is-hidden-frameless");
  else if (frame === "custom") {
    b.removeClass("is-hidden-frameless");
    const text = document.querySelector(".titlebar .titlebar-text") as HTMLElement | null;
    const sync = () => text?.setText(document.title);
    sync();
    new MutationObserver(sync).observe(document.querySelector("title") ?? document.head, { childList: true, subtree: true, characterData: true });
  }
  app.workspace.trigger("resize");
}
