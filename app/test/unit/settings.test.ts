// @vitest-environment happy-dom
// Settings persistence (only non-default values, Obsidian's key names and file split), core plugin
// state, hotkeys, template / daily-note / unique-note formatting, file recovery helpers.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import moment from "moment";

vi.mock("electron", () => ({ ipcRenderer: { invoke: async () => null, on() {}, removeListener() {} }, webFrame: { setZoomLevel() {} } }));

import { installDomHelpers } from "../../src/renderer/dom/augment";
import { FileSystemAdapter } from "../../src/renderer/vault/adapter";
import { Vault } from "../../src/renderer/vault/vault";
import { InternalPlugins } from "../../src/renderer/core-plugins/manager";
import { applyTemplate } from "../../src/renderer/core-plugins/templates/format";
import { mergeProperties } from "../../src/renderer/core-plugins/templates";
import { dailyNotePath, dailyNoteDate } from "../../src/renderer/core-plugins/daily-notes";
import { uniqueNotePath } from "../../src/renderer/core-plugins/zk-prefixer";
import { snapshotDue, lineDiff } from "../../src/renderer/core-plugins/file-recovery";
import { headingSection } from "../../src/renderer/core-plugins/note-composer";
import { convertMarkdown } from "../../src/renderer/core-plugins/misc";
import { findConflicts, hotkeyId } from "../../src/renderer/settings/tabs/hotkeys";
import { attachmentMode } from "../../src/renderer/settings/tabs/files";
import { hotkeyLabel, normaliseKey, eventModifiers } from "../../src/renderer/commands/keymap";
import { hexToHsl, quoteFonts } from "../../src/renderer/theme/custom-css";

installDomHelpers(window as any);

let dir: string;
const read = (p: string) => fs.readFileSync(path.join(dir, ".obsidian", p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(dir, ".obsidian", p));
const write = (p: string, s: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), s);
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-settings-test-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("vault config (app.json / appearance.json)", () => {
  it("writes only non-default values, splitting appearance keys like Obsidian", async () => {
    write(".obsidian/app.json", JSON.stringify({ somePluginKey: 1 }));
    const v = new Vault(new FileSystemAdapter(dir));
    await v.loadConfig();
    v.setConfig("showLineNumber", true);
    v.setConfig("readableLineLength", true); // default: not written
    v.setConfig("accentColor", "#ff0000");
    v.setConfig("baseFontSize", 18);
    v.setConfig("cssTheme", "");
    await v.flushConfig();
    expect(JSON.parse(read("app.json"))).toEqual({ somePluginKey: 1, showLineNumber: true });
    expect(JSON.parse(read("appearance.json"))).toEqual({ accentColor: "#ff0000", baseFontSize: 18 });
    // Back to defaults removes the keys; unknown keys stay.
    v.setConfig("showLineNumber", false);
    v.setConfig("accentColor", "");
    v.setConfig("baseFontSize", 16);
    await v.flushConfig();
    expect(JSON.parse(read("app.json"))).toEqual({ somePluginKey: 1 });
    expect(JSON.parse(read("appearance.json"))).toEqual({});
    expect(v.getConfig("baseFontSize")).toBe(16);
    expect(v.getConfig("theme")).toBe("system");
  });

  it("doesn't rewrite files when nothing changes", async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-settings-test2-"));
    const v = new Vault(new FileSystemAdapter(d2));
    await v.loadConfig();
    v.setConfig("readableLineLength", true);
    v.setConfig("theme", "system");
    await v.flushConfig();
    expect(fs.existsSync(path.join(d2, ".obsidian", "app.json"))).toBe(false);
    expect(fs.existsSync(path.join(d2, ".obsidian", "appearance.json"))).toBe(false);
    fs.rmSync(d2, { recursive: true, force: true });
  });

  it("compares arrays by content (enabledCssSnippets default [])", async () => {
    const v = new Vault(new FileSystemAdapter(dir));
    await v.loadConfig();
    v.setConfig("enabledCssSnippets", []);
    v.setConfig("enabledCssSnippets", ["a"]);
    await v.flushConfig();
    expect(JSON.parse(read("appearance.json"))).toEqual({ enabledCssSnippets: ["a"] });
  });
});

describe("vault config read errors", () => {
  // An adapter whose reads fail the way macOS fails them when Documents access is denied.
  const failingAdapter = (files: Record<string, string | Error>) => {
    const writes: Record<string, string> = {};
    const adapter: any = {
      getName: () => "T",
      read: async (p: string) => {
        const f = files[p];
        if (f === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        if (f instanceof Error) throw f;
        return f;
      },
      write: async (p: string, d: string) => void (writes[p] = d),
      exists: async (p: string) => p in files,
    };
    return { adapter, writes };
  };
  const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });

  it("treats only a missing file as empty", async () => {
    const { adapter, writes } = failingAdapter({});
    const v = new Vault(adapter);
    await v.loadConfig();
    expect(v.unreadableConfig.size).toBe(0);
    v.setConfig("showLineNumber", true);
    await v.flushConfig();
    expect(JSON.parse(writes[".obsidian/app.json"])).toEqual({ showLineNumber: true });
  });

  it("never writes back a config file it wasn't allowed to read", async () => {
    const { adapter, writes } = failingAdapter({ ".obsidian/app.json": eperm(), ".obsidian/appearance.json": eperm(), ".obsidian/hotkeys.json": eperm() });
    const v = new Vault(adapter);
    await v.loadConfig();
    expect([...v.unreadableConfig].sort()).toEqual(["app", "appearance"]);
    v.setConfig("accentColor", "#ff0000");
    v.setConfig("showLineNumber", true);
    await v.flushConfig();
    expect(v.getConfig("accentColor")).toBe("#ff0000"); // works for this session
    expect(await v.readConfigJson("hotkeys")).toBeNull();
    await v.writeConfigJson("hotkeys", {});
    expect(writes).toEqual({});
  });

  it("keeps a copy of an invalid file and doesn't overwrite it", async () => {
    const { adapter, writes } = failingAdapter({ ".obsidian/appearance.json": '{"accentColor": "#ff0000",' });
    const v = new Vault(adapter);
    await v.loadConfig();
    expect(v.unreadableConfig.has("appearance")).toBe(true);
    expect(writes[".obsidian/appearance.json.bak"]).toBe('{"accentColor": "#ff0000",');
    v.setConfig("theme", "obsidian");
    v.setConfig("showLineNumber", true);
    await v.flushConfig();
    expect(writes[".obsidian/appearance.json"]).toBeUndefined();
    expect(JSON.parse(writes[".obsidian/app.json"])).toEqual({ showLineNumber: true });
  });
});

describe("core plugins (core-plugins.json)", () => {
  const fakeApp = (d: string) => {
    const vault = new Vault(new FileSystemAdapter(d));
    return { vault, commands: { addCommand() {}, removeCommand() {} }, setting: null } as any;
  };
  it("reads the legacy array form and writes Obsidian's object form", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-core-"));
    fs.mkdirSync(path.join(d, ".obsidian"));
    fs.writeFileSync(path.join(d, ".obsidian/core-plugins.json"), JSON.stringify(["file-explorer", "daily-notes"]));
    const app = fakeApp(d);
    const ip = new InternalPlugins(app, {});
    app.internalPlugins = ip;
    await ip.load();
    expect(ip.plugins["daily-notes"].enabled).toBe(true);
    expect(ip.plugins["graph"].enabled).toBe(false);
    await ip.setEnabled("random-note", true);
    const saved = JSON.parse(fs.readFileSync(path.join(d, ".obsidian/core-plugins.json"), "utf8"));
    expect(Array.isArray(saved)).toBe(false);
    expect(saved["random-note"]).toBe(true);
    expect(saved["file-explorer"]).toBe(true);
    expect(saved["editor-status"]).toBe(false);
    expect("markdown-importer" in saved).toBe(false); // legacy id only written once used
    expect(Object.keys(saved).slice(0, 4)).toEqual(["file-explorer", "global-search", "switcher", "graph"]);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it("uses Obsidian's defaults when there is no file, and keeps unknown ids", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-core-"));
    fs.mkdirSync(path.join(d, ".obsidian"));
    fs.writeFileSync(path.join(d, ".obsidian/core-plugins.json"), JSON.stringify({ "future-plugin": true, graph: false }));
    const app = fakeApp(d);
    const ip = new InternalPlugins(app, {});
    app.internalPlugins = ip;
    await ip.load();
    expect(ip.plugins["file-recovery"].enabled).toBe(true); // defaultOn
    expect(ip.plugins["zk-prefixer"].enabled).toBe(false);
    expect(ip.plugins["graph"].enabled).toBe(false);
    await ip.setEnabled("graph", true);
    const saved = JSON.parse(fs.readFileSync(path.join(d, ".obsidian/core-plugins.json"), "utf8"));
    expect(saved["future-plugin"]).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it("stores plugin options in <id>.json with only non-default values", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-core-"));
    const app = fakeApp(d);
    const ip = new InternalPlugins(app, {});
    app.internalPlugins = ip;
    ip.register({ id: "note-composer", defaultOptions: { replacementText: "link", askBeforeMerging: true } });
    await ip.load();
    const p = ip.plugins["note-composer"];
    expect(p.options.replacementText).toBe("link");
    p.setOption("replacementText", "embed");
    await p.saveData();
    expect(JSON.parse(fs.readFileSync(path.join(d, ".obsidian/note-composer.json"), "utf8"))).toEqual({ replacementText: "embed" });
    p.setOption("replacementText", "link");
    await p.saveData();
    expect(JSON.parse(fs.readFileSync(path.join(d, ".obsidian/note-composer.json"), "utf8"))).toEqual({});
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("hotkeys", () => {
  it("parses keys the way hotkeys.json stores them", () => {
    const ev = (o: any) => new KeyboardEvent("keydown", o);
    expect(normaliseKey(ev({ code: "KeyP", key: "p" }))).toBe("P");
    expect(normaliseKey(ev({ code: "Digit1", key: "1" }))).toBe("1");
    expect(normaliseKey(ev({ code: "Comma", key: "," }))).toBe(",");
    expect(normaliseKey(ev({ code: "ArrowLeft", key: "ArrowLeft" }))).toBe("ArrowLeft");
    expect(eventModifiers(ev({ code: "KeyP", key: "P", ctrlKey: process.platform !== "darwin", metaKey: process.platform === "darwin", shiftKey: true }))).toEqual(["Mod", "Shift"]);
  });
  it("shows Mod as Ctrl on Windows/Linux", () => {
    if (process.platform === "darwin") expect(hotkeyLabel(["Mod", "Shift"], "P")).toBe("⌘⇧P");
    else expect(hotkeyLabel(["Shift", "Mod"], "p")).toBe("Ctrl + Shift + P");
  });
  it("finds conflicts regardless of modifier order and key case", () => {
    const cmds = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const keys: Record<string, any[]> = {
      a: [{ modifiers: ["Mod", "Shift"], key: "p" }],
      b: [{ modifiers: ["Shift", "Mod"], key: "P" }],
      c: [{ modifiers: ["Mod"], key: "P" }],
    };
    const m = findConflicts(cmds, (id) => keys[id]);
    expect([...m.values()]).toEqual([["a", "b"]]);
    expect(hotkeyId({ modifiers: ["Shift", "Mod"], key: "x" })).toBe(hotkeyId({ modifiers: ["Mod", "Shift"], key: "X" }));
  });
});

describe("template variables", () => {
  const date = moment("2026-10-21T09:05:00");
  it("replaces {{title}}, {{date}}, {{time}} and format variants (measured against Obsidian 1.14.4)", () => {
    const tpl = "T={{title}} U={{TITLE}} S={{ title }} D={{date}} t={{time}} DF={{date:YYYY/MM}} TF={{time:HH}} sp={{date: dddd}} x={{foo}}";
    expect(applyTemplate(tpl, { title: "Probe Note" }, { date })).toBe("T=Probe Note U=Probe Note S={{ title }} D=2026-10-21 t=09:05 DF=2026/10 TF=09 sp= Wednesday x={{foo}}");
  });
  it("uses the configured date and time formats", () => {
    expect(applyTemplate("{{date}} {{time}}", {}, { date, dateFormat: "DD.MM.YYYY", timeFormat: "h:mm A" })).toBe("21.10.2026 9:05 AM");
  });
  it("passes note composer variables", () => {
    expect(applyTemplate("from {{fromTitle}} to {{newTitle}}:\n{{content}}", { content: "x $& y", fromTitle: "A", newTitle: "B" }, { date })).toBe("from A to B:\nx $& y");
  });
  it("merges template properties into a note's properties", () => {
    const t: any = { a: 1, tags: ["y"] };
    mergeProperties(t, { b: 2, tags: ["x", "y"], a: 5 });
    expect(t).toEqual({ a: 1, tags: ["y", "x"], b: 2 });
  });
});

describe("daily notes and unique notes", () => {
  it("builds daily note paths from format and folder", () => {
    const d = moment("2026-10-21");
    expect(dailyNotePath({}, d)).toBe("2026-10-21.md");
    expect(dailyNotePath({ folder: "Daily/", format: "YYYY/MM/YYYY-MM-DD" }, d)).toBe("Daily/2026/10/2026-10-21.md");
    expect(dailyNotePath({ folder: "/Journal", format: "DD.MM.YYYY" }, d)).toBe("Journal/21.10.2026.md");
  });
  it("reads the date back from a daily note path", () => {
    expect(dailyNoteDate({ folder: "Daily" }, "Daily/2026-10-21.md")?.format("YYYY-MM-DD")).toBe("2026-10-21");
    expect(dailyNoteDate({ folder: "Daily" }, "Other/2026-10-21.md")).toBeNull();
    expect(dailyNoteDate({ folder: "Daily" }, "Daily/Notes.md")).toBeNull();
  });
  it("picks a free unique note name", () => {
    const taken = new Set(["Zk/202610210905.md"]);
    expect(uniqueNotePath((p) => taken.has(p), "Zk", "YYYYMMDDHHmm", moment("2026-10-21T09:05:00"))).toBe("Zk/202610210906.md");
    expect(uniqueNotePath(() => false, "", "YYYYMMDDHHmm", moment("2026-10-21T09:05:00"))).toBe("202610210905.md");
  });
});

describe("file recovery and note composer helpers", () => {
  it("takes a snapshot only after the interval and when the text changed", () => {
    const now = Date.now();
    expect(snapshotDue(null, "a", now, 5)).toBe(true);
    expect(snapshotDue({ path: "x", ts: now - 60_000, data: "a" }, "b", now, 5)).toBe(false);
    expect(snapshotDue({ path: "x", ts: now - 6 * 60_000, data: "a" }, "b", now, 5)).toBe(true);
    expect(snapshotDue({ path: "x", ts: now - 6 * 60_000, data: "a" }, "a", now, 5)).toBe(false);
  });
  it("diffs lines", () => {
    expect(lineDiff("a\nb\nc", "a\nc\nd").map((d) => d.op + d.text)).toEqual([" a", "-b", " c", "+d"]);
  });
  it("finds the heading section under the cursor", () => {
    const lines = ["# A", "x", "## B", "y", "### C", "z", "## D", "w"];
    expect(headingSection(lines, 3)).toEqual({ start: 2, end: 6, level: 2, title: "B" });
    expect(headingSection(lines, 0)?.end).toBe(8);
  });
  it("converts other apps' Markdown", () => {
    const o = { roamHighlights: true, roamTodos: true, bearTags: true, hashLinks: true, mdLinks: true };
    expect(convertMarkdown("^^hi^^ #[[my tag]] #two words# - {{[[TODO]]}} task [x](Note.md)", o, (t) => (t === "Note.md" ? "Note" : null))).toBe("==hi== #my-tag #two-words - [ ] task [[Note|x]]");
  });
});

describe("appearance helpers", () => {
  it("derives accent HSL and quotes font names", () => {
    expect(hexToHsl("#8a5cf5")).toEqual({ h: 258, s: 88, l: 66 });
    expect(hexToHsl("nope")).toBeNull();
    // Every way an accent can be written gives the same color (never falls back to the default).
    expect(hexToHsl("#ff0000")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("#f00")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("#ff0000cc")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("rgb(255, 0, 0)")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("rgba(255,0,0,0.5)")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("rgb(255 0 0 / 50%)")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("RGB(100%, 0%, 0%)")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("#f00f")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("#ff000")).toBeNull();
    expect(hexToHsl("rgb(255, 0)")).toBeNull();
    expect(quoteFonts("Segoe UI, Arial, 'My Font'")).toBe('"Segoe UI", Arial, \'My Font\'');
  });
  it("maps the attachment folder setting", () => {
    expect(attachmentMode("/")).toBe("root");
    expect(attachmentMode("./")).toBe("current");
    expect(attachmentMode("./attachments")).toBe("subfolder");
    expect(attachmentMode("Files/Att")).toBe("folder");
  });
  it("leaves no stray files", () => {
    expect(exists("hotkeys.json")).toBe(false);
  });
});
