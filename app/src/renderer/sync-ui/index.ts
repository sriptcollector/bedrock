// Sync UI extension point. The lead wires this to packages/sync (which runs in the main process).
// Planned pieces: status bar item (synced / syncing / offline / error), version history modal,
// recycle bin, conflict notices, and a "Sync" settings tab. Everything here is renderer-only and
// talks to the main process over IPC channels the sync host will add (prefix "bedrock:sync-").
import { setIcon } from "../dom/icons";

export interface SyncUiState {
  status: "off" | "idle" | "syncing" | "offline" | "error";
  detail?: string;
}

export class SyncStatusItem {
  el: HTMLElement;
  constructor(statusBarEl: HTMLElement) {
    this.el = statusBarEl.createDiv({ cls: "status-bar-item mod-clickable plugin-sync", attr: { "aria-label": "Sync" } });
    this.set({ status: "off" });
  }
  set(s: SyncUiState): void {
    this.el.empty();
    const icon = this.el.createSpan("status-bar-item-icon");
    const map: Record<SyncUiState["status"], [string, string]> = {
      off: ["cloud-off", "Sync is off"],
      idle: ["cloud", "Synced"],
      syncing: ["refresh-cw", "Syncing…"],
      offline: ["cloud-off", "Offline, changes will sync later"],
      error: ["triangle-alert", "Sync problem"],
    };
    const [i, label] = map[s.status];
    setIcon(icon, i);
    this.el.setAttr("aria-label", s.detail ?? label);
    this.el.toggleClass("mod-error", s.status === "error");
  }
}

/** Called once at startup by App. Returns the status item so the sync host can update it. */
export function mountSyncUi(app: any): SyncStatusItem {
  const item = new SyncStatusItem(app.statusBar.containerEl);
  return item;
}
