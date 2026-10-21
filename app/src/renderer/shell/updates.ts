// Update state from the main process: a notice with "Relaunch to update" once a new version has
// been downloaded, and the state Settings › General shows.
import { ipcRenderer } from "electron";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { Notice } from "../ui/notice";

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloaded" | "none" | "error" | "dev";
  version?: string;
}

let current: UpdateState = { status: "idle" };
const listeners = new Set<(s: UpdateState) => void>();

export function getUpdateState(): UpdateState {
  return current;
}

export function onUpdateState(cb: (s: UpdateState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function relaunchToUpdate(): Promise<boolean> {
  return ipcRenderer.invoke(SHELL_IPC.installUpdate);
}

function updateNotice(version?: string): void {
  const frag = document.createDocumentFragment();
  frag.createSpan({ text: `Version ${version ?? "update"} is ready. ` });
  const a = frag.createEl("a", { text: "Relaunch to update", href: "#" });
  a.addEventListener("click", (e) => {
    e.preventDefault();
    void relaunchToUpdate();
  });
  new Notice(frag, 0);
}

export function mountUpdates(): void {
  const apply = (s: UpdateState, announce: boolean) => {
    const was = current.status;
    current = s ?? { status: "idle" };
    for (const cb of listeners) cb(current);
    if (announce && current.status === "downloaded" && was !== "downloaded") updateNotice(current.version);
  };
  ipcRenderer.on(SHELL_IPC.updateState, (_e, s: UpdateState) => apply(s, true));
  void ipcRenderer.invoke(SHELL_IPC.updateState).then((s: UpdateState) => apply(s, true), () => undefined);
}
