// Entry point used by main/index.ts: one SyncHost for the one vault.
import { SyncHost } from "./host";

let host: SyncHost | null = null;

/**
 * Starts syncing `vaultPath` (the main vault). Smoke tests run without sync unless they point
 * BEDROCK_SYNC_URL at a test server.
 */
export function startSync(o: { vaultPath: string; smokeTest: boolean }): SyncHost {
  if (host) return host;
  const enabled = (!o.smokeTest || !!process.env.BEDROCK_SYNC_URL) && process.env.BEDROCK_SYNC !== "0";
  host = new SyncHost({ vaultPath: o.vaultPath, enabled });
  host.start();
  return host;
}

export async function stopSync(): Promise<void> {
  await host?.stop();
}
