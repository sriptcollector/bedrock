// Secret storage for the hub's session token and Bedrock's opened vault key.
//
// - Windows / Linux: the OS keychain (Windows Credential Manager, libsecret) through @napi-rs/keyring.
// - macOS: never the Keychain. Our builds are ad-hoc signed, so every update looks like a new app to
//   the Keychain and macOS asks for the login password. Instead:
//     - the hub's session (service "ai.toolbay.desktop", account "session") is read from the 0600
//       file the hub (0.1.13+) writes: ~/Library/Application Support/ai.toolbay.desktop/session;
//     - Bedrock's own entries are 0600 files in Bedrock's app data (<userData>/keys/, folder 0700).
//   Older Keychain entries (the 0.1.2 vault key) are left alone and never read on macOS.
// - Tests set BEDROCK_KEYCHAIN_DIR so several app instances can run side by side without touching
//   the real store: each entry is then a small file in that folder (every OS).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUB_SERVICE = "ai.toolbay.desktop";
const isMac = process.platform === "darwin";

function testFile(service: string, account: string): string | null {
  const dir = process.env.BEDROCK_KEYCHAIN_DIR;
  if (!dir) return null;
  return path.join(dir, `${service}--${account}`.replace(/[^A-Za-z0-9._-]/g, "_"));
}

/** macOS: where an entry lives as a file (hub session in the hub's folder, ours in our app data). */
function macFile(service: string, account: string): string {
  if (service === HUB_SERVICE) return path.join(os.homedir(), "Library", "Application Support", HUB_SERVICE, account);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require("electron") as typeof import("electron");
  return path.join(app.getPath("userData"), "keys", `${service}--${account}`.replace(/[^A-Za-z0-9._-]/g, "_"));
}

function fileFor(service: string, account: string): string | null {
  return testFile(service, account) ?? (isMac ? macFile(service, account) : null);
}

function readFile(f: string): string | null {
  try {
    const v = fs.readFileSync(f, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function keychainGet(service: string, account: string): string | null {
  const f = fileFor(service, account);
  if (f) return readFile(f);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Entry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    const v = new Entry(service, account).getPassword();
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function keychainSet(service: string, account: string, value: string): void {
  const f = fileFor(service, account);
  if (f) {
    if (service === HUB_SERVICE && !testFile(service, account)) throw new Error("the hub's session is read-only for Bedrock");
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, value, { mode: 0o600 });
    fs.renameSync(tmp, f);
    try {
      fs.chmodSync(f, 0o600);
    } catch {
      /* Windows test folder */
    }
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Entry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
  new Entry(service, account).setPassword(value);
}

export function keychainDelete(service: string, account: string): void {
  const f = fileFor(service, account);
  if (f) {
    if (service !== HUB_SERVICE || testFile(service, account)) fs.rmSync(f, { force: true });
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Entry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    new Entry(service, account).deletePassword();
  } catch {
    /* not there */
  }
}
