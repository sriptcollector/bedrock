// What to tell the person when the OS won't let the app read the vault folder (macOS privacy
// settings after an update, or plain file permissions). Used by the main-process dialog and the
// renderer's blocking screen.
import { BRAND } from "./brand";

export function vaultAccessMessage(platform: string): string {
  const name = BRAND.displayName;
  if (platform === "darwin") return `${name} can't read your notes folder. Open System Settings › Privacy & Security › Files and Folders and allow ${name} to access Documents, then reopen ${name}.`;
  return `${name} can't read your notes folder. Make sure your account is allowed to open it, then reopen ${name}.`;
}

/** Permission errors (as opposed to "not there"). */
export function isAccessErrorCode(e: any): boolean {
  return e?.code === "EPERM" || e?.code === "EACCES";
}
