// Sync UI (renderer). The engine runs in the main process (main/sync/host.ts); this module shows
// it: the status bar icon with its menu, Settings › Sync, version history, deleted files, the
// activity log, conflict and first-sync notices, the commands and the file menu item.
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { Notice } from "../ui/notice";
import { SyncClient } from "./client";
import { ActivityLogModal, DeletedFilesModal, VersionHistoryModal } from "./modals";
import { SyncSettingTab, statusLine } from "./settings-tab";
import { injectSyncCss } from "./styles";
import { SyncMigrationModal, TurnOnSyncModal } from "./turn-on";
import type { SyncSnapshot, SyncUiEvent, SyncUiStatus } from "../../shared/sync";

export interface SyncUiState {
  status: SyncUiStatus;
  detail?: string;
}

const LOOK: Record<SyncUiStatus, [icon: string, mod: string, label: string]> = {
  off: ["refresh-cw-off", "mod-muted", "Sync is off"],
  locked: ["lock", "mod-error", "Sync needs your passphrase"],
  synced: ["refresh-cw", "mod-success", "Synced"],
  syncing: ["refresh-cw", "mod-working", "Syncing"],
  connecting: ["refresh-cw", "mod-working", "Connecting"],
  offline: ["cloud-off", "mod-muted", "Offline"],
  paused: ["circle-pause", "mod-muted", "Paused"],
  error: ["refresh-cw-off", "mod-error", "Sync problem"],
  "signed-out": ["refresh-cw-off", "mod-muted", "Not signed in"],
  disabled: ["refresh-cw-off", "mod-muted", "Not synced"],
};

export class SyncStatusItem {
  el: HTMLElement;
  private iconEl: HTMLElement;
  status: SyncUiStatus = "signed-out";

  constructor(statusBarEl: HTMLElement) {
    this.el = statusBarEl.createDiv({ cls: "status-bar-item mod-clickable plugin-sync", attr: { "aria-label": "Sync", "data-tooltip-position": "top" } });
    this.iconEl = this.el.createSpan("status-bar-item-icon sync-status-icon");
    this.set({ status: "signed-out" });
  }

  set(s: SyncUiState): void {
    const [icon, mod, label] = LOOK[s.status];
    if (this.status !== s.status || !this.iconEl.firstChild) {
      this.iconEl.empty();
      setIcon(this.iconEl, icon);
    }
    this.status = s.status;
    this.iconEl.className = `status-bar-item-icon sync-status-icon ${mod}`;
    this.el.setAttr("aria-label", s.detail ? `${label}: ${s.detail}` : label);
    this.el.setAttr("data-sync-status", s.status);
    this.el.toggleClass("mod-error", s.status === "error");
  }
}

/** Called once at startup by App. Returns the status item. */
export function mountSyncUi(app: any): SyncStatusItem {
  injectSyncCss();
  const item = new SyncStatusItem(app.statusBar.containerEl);
  const isMain = app.boot?.isMainVault !== false;
  const client = new SyncClient();
  (app as any).sync = client; // used by tests and plugins that want to read the status

  let migrationShown = false;
  client.onChange((s) => {
    if (!isMain) return item.set({ status: "disabled", detail: "This folder is opened as a separate vault and doesn't sync." });
    item.set({ status: s.status, detail: tooltip(s) });
    if (s.migrationNotice && !migrationShown) {
      migrationShown = true;
      new SyncMigrationModal(app, client).open();
    }
  });

  item.el.addEventListener("click", (e) => showMenu(app, client, e));

  if (isMain) {
    app.setting.addSettingTab(new SyncSettingTab(app, client), "core");
    registerCommands(app, client);
    app.workspace.on("file-menu", (menu: Menu, file: any) => {
      if (!file || file.children !== undefined || !file.extension) return; // files only
      menu.addItem((i) =>
        i
          .setTitle("Open version history")
          .setIcon("history")
          .setSection("view.linked")
          .onClick(() => new VersionHistoryModal(app, client, file.path).open()),
      );
    });
    const seen = new Set<string>();
    const show = (ev: SyncUiEvent) => {
      if (ev.type === "log" || (ev.id && seen.has(ev.id))) return;
      if (ev.id) seen.add(ev.id);
      if (ev.type === "conflict") conflictNotice(app, ev.path, ev.conflictPath);
      else new Notice(ev.message, 12000);
    };
    client.onEvent(show);
    // anything that happened while this window was still loading (e.g. the first-sync notice)
    void client.call<SyncUiEvent[]>("recentEvents").then((evs) => evs.forEach(show), () => {});
  }
  return item;
}

function tooltip(s: SyncSnapshot): string {
  let t = statusLine(s);
  if (s.status === "syncing" && (s.pendingUploads || s.pendingDownloads)) {
    const parts: string[] = [];
    if (s.pendingUploads) parts.push(`${s.pendingUploads} to upload`);
    if (s.pendingDownloads) parts.push(`${s.pendingDownloads} to download`);
    t = `Syncing (${parts.join(", ")})`;
  }
  return t;
}

function showMenu(app: any, client: SyncClient, e: MouseEvent): void {
  const s = client.snapshot;
  const m = new Menu();
  const isMain = app.boot?.isMainVault !== false;
  m.addItem((i) => {
    i.setTitle(!isMain ? "This folder doesn't sync. Only your main vault syncs." : s ? tooltip(s) : "Loading…").setIsLabel(true);
    i.dom.addClass("sync-menu-status");
  });
  if (!isMain || !s) return void m.showAtMouseEvent(e);
  m.addSeparator();
  if (!s.settings.enabled) {
    m.addItem((i) =>
      i
        .setTitle("Turn on sync…")
        .setIcon("refresh-cw")
        .onClick(() => (s.signedIn ? new TurnOnSyncModal(app, client).open() : app.setting.openTabById("sync"))),
    );
  } else if (!s.signedIn) {
    m.addItem((i) =>
      i
        .setTitle(s.hubInstalled ? "Sign in to Toolbay to sync" : "Get the Toolbay app to sync")
        .setIcon("log-in")
        .onClick(() => void client.signIn()),
    );
  } else {
    if (s.status === "locked")
      m.addItem((i) =>
        i
          .setTitle("Enter sync passphrase…")
          .setIcon("lock")
          .onClick(() => new TurnOnSyncModal(app, client).open()),
      );
    if (!s.settings.paused)
      m.addItem((i) =>
        i
          .setTitle("Sync now")
          .setIcon("refresh-cw")
          .onClick(() => void client.syncNow().catch((err) => new Notice(err.message))),
      );
    m.addItem((i) =>
      i
        .setTitle(s.settings.paused ? "Resume syncing" : "Pause syncing")
        .setIcon(s.settings.paused ? "play" : "pause")
        .onClick(() => void (s.settings.paused ? client.resume() : client.pause())),
    );
    m.addSeparator();
    const f = app.workspace.getActiveFile?.();
    if (f)
      m.addItem((i) =>
        i
          .setTitle("Version history of this file")
          .setIcon("history")
          .onClick(() => new VersionHistoryModal(app, client, f.path).open()),
      );
    m.addItem((i) =>
      i
        .setTitle("Deleted files")
        .setIcon("trash-2")
        .onClick(() => new DeletedFilesModal(app, client).open()),
    );
    m.addItem((i) =>
      i
        .setTitle("Activity log")
        .setIcon("list")
        .onClick(() => new ActivityLogModal(app, client).open()),
    );
  }
  m.addSeparator();
  m.addItem((i) =>
    i
      .setTitle("Sync settings")
      .setIcon("settings")
      .onClick(() => app.setting.openTabById("sync")),
  );
  const r = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  if (r) m.showAtPosition({ x: r.right, y: r.top, left: true });
  else m.showAtMouseEvent(e);
}

function registerCommands(app: any, client: SyncClient): void {
  const add = (c: any) => app.commands.addCommand(c);
  add({
    id: "sync:view-version-history",
    name: "Sync: Open version history for the current file",
    icon: "history",
    checkCallback: (checking: boolean) => {
      const f = app.workspace.getActiveFile?.();
      if (!f) return false;
      if (!checking) new VersionHistoryModal(app, client, f.path).open();
      return true;
    },
  });
  add({ id: "sync:open-sync-log", name: "Sync: Open activity log", icon: "list", callback: () => new ActivityLogModal(app, client).open() });
  add({ id: "sync:open-sync-view", name: "Sync: Show Sync history", icon: "history", callback: () => new ActivityLogModal(app, client).open() });
  add({ id: "sync:open-deleted-files", name: "Sync: Open deleted files", icon: "trash-2", callback: () => new DeletedFilesModal(app, client).open() });
  add({ id: "sync:setup", name: "Sync: Set up Sync", icon: "refresh-cw", callback: () => app.setting.openTabById("sync") });
  add({
    id: "sync:sync-now",
    name: "Sync: Sync now",
    icon: "refresh-cw",
    checkCallback: (checking: boolean) => {
      const s = client.snapshot;
      if (!s?.signedIn || !s.settings.enabled || s.settings.paused) return false;
      if (!checking) void client.syncNow().catch((e) => new Notice(e.message));
      return true;
    },
  });
  add({
    id: "sync:toggle-pause",
    name: "Sync: Pause or resume syncing",
    icon: "pause",
    checkCallback: (checking: boolean) => {
      const s = client.snapshot;
      if (!s?.signedIn || !s.settings.enabled) return false;
      if (!checking) void (s.settings.paused ? client.resume() : client.pause());
      return true;
    },
  });
}

function conflictNotice(app: any, path: string, conflictPath: string): void {
  const frag = document.createDocumentFragment();
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  frag.createDiv({
    text: `“${name(path)}” was changed on two computers at the same time and the changes overlap. Both versions are kept: the other one is saved as “${name(conflictPath)}”.`,
  });
  const actions = frag.createDiv("sync-notice-actions");
  const open = actions.createEl("button", { cls: "mod-cta", text: "Open both" });
  const n = new Notice(frag, 20000);
  n.noticeEl.addClass("mod-sync-conflict");
  open.addEventListener("click", async (e) => {
    e.stopPropagation();
    n.hide();
    const a = app.vault.getFileByPath(path);
    const b = app.vault.getFileByPath(conflictPath);
    if (a) await app.workspace.getLeaf(false).openFile(a);
    if (b) await app.workspace.getLeaf("split", "vertical").openFile(b);
  });
}
