// OS keychain access (Windows Credential Manager, macOS Keychain, libsecret) through
// @napi-rs/keyring. Tests set BEDROCK_KEYCHAIN_DIR so several app instances can run side by side
// without touching the real keychain: each entry is then a small file in that folder.
import fs from "node:fs";
import path from "node:path";

function testFile(service: string, account: string): string | null {
  const dir = process.env.BEDROCK_KEYCHAIN_DIR;
  if (!dir) return null;
  return path.join(dir, `${service}--${account}`.replace(/[^A-Za-z0-9._-]/g, "_"));
}

export function keychainGet(service: string, account: string): string | null {
  const f = testFile(service, account);
  if (f) {
    try {
      const v = fs.readFileSync(f, "utf8").trim();
      return v || null;
    } catch {
      return null;
    }
  }
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
  const f = testFile(service, account);
  if (f) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, value);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Entry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
  new Entry(service, account).setPassword(value);
}
