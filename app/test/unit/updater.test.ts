// "Downloading version X" only for a version newer than the one running.
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getVersion: () => "0.1.5", getPath: () => "" }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {}, removeListener() {} }, safeStorage: {}, screen: {}, shell: {} }));

import { isNewerVersion } from "../../src/main/updater";

describe("isNewerVersion", () => {
  it("compares by semver, not by string", () => {
    expect(isNewerVersion("0.1.5", "0.1.4")).toBe(true);
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.1.4", "0.1.5")).toBe(false);
    expect(isNewerVersion("0.1.5", "0.1.5")).toBe(false);
  });
  it("orders pre-releases below their release", () => {
    expect(isNewerVersion("0.1.5", "0.1.5-beta.2")).toBe(true);
    expect(isNewerVersion("0.1.5-beta.2", "0.1.5")).toBe(false);
    expect(isNewerVersion("0.1.5-beta.10", "0.1.5-beta.9")).toBe(true);
    expect(isNewerVersion("0.1.6-beta.1", "0.1.5")).toBe(true);
  });
});
