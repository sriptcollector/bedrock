// Local log file (never uploaded): <app data>/logs/main.log, rotated at 1 MB. Records crashes of the
// main process and of windows so "it broke" can be diagnosed on the person's own computer.
import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";

let file = "";

export function logPath(): string {
  if (!file) {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, "main.log");
  }
  return file;
}

export function log(level: "info" | "warn" | "error", ...parts: unknown[]): void {
  try {
    const p = logPath();
    try {
      if (fs.statSync(p).size > 1_000_000) fs.renameSync(p, p + ".1");
    } catch {
      /* no file yet */
    }
    const text = parts.map((x) => (x instanceof Error ? x.stack ?? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    fs.appendFileSync(p, `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`);
  } catch {
    /* logging must never throw */
  }
}

/** Main-process crash handlers + window crash recovery. Call once, after app data is set. */
export function installCrashHandling(): void {
  process.on("uncaughtException", (e) => log("error", "uncaughtException", e));
  process.on("unhandledRejection", (e) => log("error", "unhandledRejection", e as any));
  app.on("child-process-gone", (_e, d) => log("warn", "child-process-gone", d));
  app.on("web-contents-created", (_e, wc) => {
    let crashes = 0;
    wc.on("render-process-gone", (_ev, d) => {
      log("error", "render-process-gone", d);
      if (d.reason === "clean-exit") return;
      const win = BrowserWindow.fromWebContents(wc);
      if (!win || win.isDestroyed()) return;
      crashes++;
      // Reload once quietly; your notes are files on disk, nothing is lost. If it keeps happening, say so.
      if (crashes <= 2) setTimeout(() => !win.isDestroyed() && wc.reload(), 500);
      else
        dialog
          .showMessageBox(win, {
            type: "error",
            message: "Bedrock's window stopped working",
            detail: `Your notes are safe: they are files in your vault folder. Click Reload to try again. If it keeps happening, the log at ${logPath()} says what went wrong.`,
            buttons: ["Reload", "Quit"],
          })
          .then((r) => (r.response === 0 ? (crashes = 0, wc.reload()) : app.quit()));
    });
    wc.on("unresponsive", () => log("warn", "window unresponsive"));
    wc.on("console-message", (details: any) => {
      // Renderer errors (incl. uncaught exceptions) go to the same log.
      const level = details?.level ?? "";
      if (level === "error" || level === 3) log("error", "renderer:", details?.message ?? "", details?.sourceId ?? "", details?.lineNumber ?? "");
    });
  });
}
