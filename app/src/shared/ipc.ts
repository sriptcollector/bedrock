// IPC channel names shared by main, preload and renderer.
export const IPC = {
  // renderer -> main (invoke)
  bootInfo: "bedrock:boot-info",
  windowControl: "bedrock:window-control", // "minimize" | "maximize" | "close" | "hide"
  windowState: "bedrock:window-state",
  openVaultDialog: "bedrock:open-vault-dialog",
  openVault: "bedrock:open-vault",
  importIntoMainVault: "bedrock:import-into-main-vault",
  revealInFolder: "bedrock:reveal",
  openExternal: "bedrock:open-external",
  trashItem: "bedrock:trash-item",
  getAccount: "bedrock:get-account",
  checkForUpdates: "bedrock:check-updates",
  setTitle: "bedrock:set-title",
  vaultList: "bedrock:vault-list",
  pickFolder: "bedrock:pick-folder",
  syncCall: "bedrock:sync-call", // {op, ...args}: see main/sync/host.ts and shared/sync.ts
  // main -> renderer (send)
  windowStateChanged: "bedrock:window-state-changed",
  openPath: "bedrock:open-path",
  command: "bedrock:command",
  syncUpdate: "bedrock:sync-update", // SyncSnapshot
  syncEvent: "bedrock:sync-event", // SyncUiEvent
} as const;

export interface BootInfo {
  vaultPath: string;
  vaultName: string;
  isMainVault: boolean;
  platform: NodeJS.Platform;
  version: string;
  userData: string;
  resourcesPath: string;
  smokeTest: boolean;
  openFile?: string;
}
