// Types shared by the sync host (main process) and the sync UI (renderer).
// IPC: renderer -> main `IPC.syncCall` (invoke, {op, ...args}); main -> renderer `IPC.syncUpdate`
// (SyncSnapshot) and `IPC.syncEvent` (SyncUiEvent).

export type SyncUiStatus =
  | "off" // sync is off on this computer (the default; only the person turns it on)
  | "locked" // sync is on but this computer needs the sync passphrase
  | "signed-out" // no Toolbay sign-in on this computer
  | "paused" // the person paused sync
  | "connecting"
  | "syncing"
  | "synced"
  | "offline" // no connection (or the sync service is down); changes wait on this computer
  | "error" // needs attention (sign in again, vault full, ...)
  | "disabled"; // not the synced vault (another folder opened as a vault), or sync turned off for tests

export interface SyncConfigCategories {
  /** .obsidian/app.json, types.json */
  app: boolean;
  /** .obsidian/appearance.json */
  appearance: boolean;
  /** .obsidian/themes/, .obsidian/snippets/ */
  themes: boolean;
  /** .obsidian/hotkeys.json */
  hotkeys: boolean;
  /** .obsidian/core-plugins.json */
  corePlugins: boolean;
  /** other .obsidian/*.json (graph.json, daily-notes.json, bookmarks.json, ...) */
  corePluginSettings: boolean;
  /** .obsidian/community-plugins.json */
  communityPlugins: boolean;
  /** .obsidian/plugins/ */
  communityPluginData: boolean;
}

export interface SyncSettings {
  /** Sync runs only when the person turned it on (Settings › Sync). Off by default. */
  enabled: boolean;
  paused: boolean;
  /** Shown in the activity log, version history and conflict copy names. Empty = computer name. */
  deviceName: string;
  images: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
  /** Every other file type (notes, canvases and bases always sync). */
  other: boolean;
  /** Vault-relative folders that don't sync on this computer. */
  excludedFolders: string[];
  config: SyncConfigCategories;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  paused: false,
  deviceName: "",
  images: true,
  audio: true,
  video: true,
  pdf: true,
  other: true,
  excludedFolders: [],
  config: {
    app: true,
    appearance: true,
    themes: true,
    hotkeys: true,
    corePlugins: true,
    corePluginSettings: true,
    communityPlugins: false,
    communityPluginData: false,
  },
};

export interface SyncAccount {
  name: string;
  handle: string;
  email?: string;
}

export interface SyncUsage {
  usedBytes: number;
  quotaBytes: number;
  retentionDays: number;
}

export interface SyncSnapshot {
  status: SyncUiStatus;
  /** One plain sentence for the tooltip and the settings tab. */
  message: string;
  errorKind?: string;
  signedIn: boolean;
  /** Is the Toolbay app installed (it owns sign-in)? */
  hubInstalled: boolean;
  account: SyncAccount | null;
  pendingUploads: number;
  pendingDownloads: number;
  lastSyncedAt: number | null;
  deviceName: string;
  computerName: string;
  vaultPath: string;
  usage: SyncUsage | null;
  settings: SyncSettings;
  /**
   * Show the one-time "sync is now off until you choose" message (computers that synced with
   * 0.1.2 or older, where sync turned itself on).
   */
  migrationNotice: boolean;
}

/** What turning sync on needs on this computer (Settings › Sync › Turn on sync). */
export interface SyncKeyInfo {
  /** The Toolbay account already has a sync passphrase (set on this or another computer). */
  accountHasKey: boolean;
  /** This computer already holds the current key: turning sync on needs no passphrase. */
  thisComputerHasKey: boolean;
}

export type SyncTurnOnMode = "create" | "unlock" | "resume" | "reset";

export type SyncLogAction = "upload" | "download" | "delete" | "rename" | "merge" | "kept" | "conflict" | "error" | "info";

export interface SyncLogEntry {
  time: number;
  action: SyncLogAction;
  path: string;
  from?: string;
  message?: string;
}

export interface SyncVersion {
  version: number;
  path: string;
  size: number;
  deleted: boolean;
  createdAt: number | null;
  device: string | null;
  current: boolean;
}

export interface SyncTrashItem {
  fileId: string;
  path: string;
  deletedAt: number | null;
  device: string | null;
  restorable: boolean;
}

export type SyncUiEvent =
  | { type: "conflict"; path: string; conflictPath: string; id?: string }
  | { type: "notice"; message: string; id?: string }
  | { type: "log"; entry: SyncLogEntry };

/** A version's content for the history view: text when it is text, else just the size. */
export interface SyncContent {
  text: string | null;
  size: number;
}
