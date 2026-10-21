// IPC channels for the app shell: vault manager, window commands, PDF export, debug info and
// URIs (own file so the shared ipc.ts stays small).
export const SHELL_IPC = {
  // renderer -> main (invoke)
  vaults: "bedrock:shell-vaults", // () -> VaultInfo[]
  openVault: "bedrock:shell-open-vault", // (path, {closeSender?}) -> boolean
  createVault: "bedrock:shell-create-vault", // (name, parentDir) -> {path} | {error}
  renameVault: "bedrock:shell-rename-vault", // (path, newName) -> {path} | {error}
  removeVault: "bedrock:shell-remove-vault", // (path) -> void
  moveVault: "bedrock:shell-move-vault", // (path, newParent) -> {path} | {error}
  openSandbox: "bedrock:shell-open-sandbox", // () -> path
  pickFile: "bedrock:shell-pick-file", // (title, filters?) -> path | null
  pickFolder: "bedrock:shell-pick-folder", // (title) -> path | null
  windowAction: "bedrock:shell-window", // ("always-on-top" | "close" | "is-always-on-top") -> state
  printPdf: "bedrock:shell-print-pdf", // (defaultName, options) -> path | null
  debugInfo: "bedrock:shell-debug-info", // () -> {...}
  documentsDir: "bedrock:shell-documents", // () -> default parent folder for new vaults
  clipboard: "bedrock:shell-clipboard", // ("read") -> text | ("write", text)
  updateState: "bedrock:update-state", // invoke () -> UpdateState; main -> renderer (send) on change
  installUpdate: "bedrock:install-update", // () -> boolean (relaunch into the downloaded version)
  // main -> renderer (send)
  uri: "bedrock:shell-uri", // ({action, params})
  showStarter: "bedrock:shell-show-starter", // ()
} as const;

export interface VaultInfo {
  path: string;
  name: string;
  isMain: boolean;
  exists: boolean;
  open: boolean;
  current: boolean;
  lastOpened?: number;
}

export interface PdfOptions {
  pageSize: string; // "Letter" | "A3" | "A4" | "A5" | "Legal" | "Tabloid"
  landscape: boolean;
  margin: string; // "0" default, "1" none, "2" small... (Obsidian's values)
  downscalePercent: number;
}
