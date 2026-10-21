// App shell parity, end to end on the built app (temp copies of the fixture vault, own app data):
// windows (settings, plugin/theme browsers, vault manager, popouts, bounds per vault, frame
// styles), vaults (manager, create form, switcher, sandbox), URIs, updates, metadata cache kept
// between runs, deferred tabs, default file to open, config folder override and reload.
// Usage: node test/e2e/shell-parity.mjs [--only <section,...>] [--keep]
import fs from "node:fs";
import path from "node:path";
import { launch, Checks, shot, argValue } from "./lib/harness.mjs";

const C = new Checks();
const only = argValue("--only")?.split(",") ?? null;
const want = (s) => !only || only.includes(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const windows = (L) => L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({ id: w.id, title: w.getTitle(), size: w.getContentSize(), visible: w.isVisible(), url: w.webContents.getURL() })));
const waitFor = async (fn, ms = 5000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  return null;
};

// ---------------------------------------------------------------- windows
if (want("windows")) {
  const L = await launch({ width: 1280, height: 800 });
  const { win, errors } = L;
  try {
    // Settings: own window 900x700 by default.
    const before = (await windows(L)).length;
    await win.evaluate(() => window.app.setting.open());
    const sw = await waitFor(async () => (await windows(L)).find((w) => w.size[0] === 900 && w.size[1] === 700));
    C.check("settings opens in its own 900x700 window", !!sw, JSON.stringify(await windows(L)));
    await win.evaluate(() => window.app.setting.close());
    await sleep(400);
    // Option: in-app dialog.
    await win.evaluate(() => window.app.vault.setConfig("settingsPopoutWindow", false));
    await win.evaluate(() => window.app.setting.open());
    await sleep(500);
    const inApp = await win.evaluate(() => !!document.querySelector(".modal-container .mod-settings, .modal.mod-settings"));
    C.check("settings can open as an in-app dialog (settingsPopoutWindow off)", inApp && (await windows(L)).length === before);
    await win.evaluate(() => window.app.setting.close());
    await win.evaluate(() => window.app.vault.setConfig("settingsPopoutWindow", undefined));
    // Plugin and theme browsers: 1100x800 windows.
    for (const kind of ["plugins", "themes"]) {
      // Open through the URI action (same code path as the Browse / Manage buttons).
      await win.evaluate((k) => require("electron").ipcRenderer.emit("bedrock:shell-uri", {}, { action: k === "plugins" ? "show-plugin" : "show-theme", params: {} }), kind);
      const bw = await waitFor(async () => (await windows(L)).find((w) => w.size[0] === 1100 && w.size[1] === 800));
      C.check(`${kind} browser opens in its own 1100x800 window`, !!bw, JSON.stringify((await windows(L)).map((w) => w.size)));
      await L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getContentSize()[0] === 1100).forEach((w) => w.close()));
      await win.evaluate(() => window.app.setting.close());
      await sleep(400);
    }
    // Vault manager: 800x650, list, per-vault menu, create form.
    await win.evaluate(() => window.app.commands.executeCommandById("app:open-vault"));
    const vm = await waitFor(async () => (await windows(L)).find((w) => w.size[0] === 800 && w.size[1] === 650));
    C.check("vault manager window is 800x650", !!vm, JSON.stringify((await windows(L)).map((w) => w.size)));
    const vmState = await win.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 400));
      // The manager window's document is driven by this renderer.
      const d = window.app.shell.vaultManagerDoc();
      if (!d) return null;
      return {
        items: Array.from(d.querySelectorAll(".vault-manager-item-name")).map((e) => e.textContent),
        options: Array.from(d.querySelectorAll(".vault-manager-options .setting-item-name")).map((e) => e.textContent),
        language: !!d.querySelector(".vault-manager-language select"),
      };
    });
    C.check("vault manager lists known vaults and offers create / open folder / open synced vault / language", !!vmState && vmState.items.length >= 1 && vmState.options.join("|") === "Create new vault|Open folder as vault|Open your synced vault" && vmState.language, JSON.stringify(vmState));
    // Per-vault menu.
    const menu = await win.evaluate(async () => {
      const d = window.app.shell.vaultManagerDoc();
      d.querySelector(".vault-manager-item-menu").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 100 }));
      await new Promise((r) => setTimeout(r, 200));
      const items = Array.from(d.querySelectorAll(".menu .menu-item-title")).map((e) => e.textContent);
      d.querySelectorAll(".menu").forEach((m) => m.remove());
      return items;
    });
    C.check("per-vault menu: copy path, reveal (rename/move/remove for other vaults)", menu.includes("Reveal vault in system explorer") && menu.includes("Copy vault path"), menu.join(", "));
    // Create form.
    const parent = path.join(L.tmp, "new-vaults");
    fs.mkdirSync(parent, { recursive: true });
    const form = await win.evaluate(async (parentDir) => {
      const d = window.app.shell.vaultManagerDoc();
      const createBtn = Array.from(d.querySelectorAll(".vault-manager-options button")).find((b) => b.textContent === "Create");
      createBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const out = { title: d.querySelector(".vault-manager-form-title")?.textContent, back: !!d.querySelector(".vault-manager-back"), fields: Array.from(d.querySelectorAll(".setting-item-name")).map((e) => e.textContent) };
      // Location picker is a native dialog; drive the same IPC the Create button uses.
      const r = await require("electron").ipcRenderer.invoke("bedrock:shell-create-vault", "Made by test", parentDir);
      out.created = r;
      const bad = await require("electron").ipcRenderer.invoke("bedrock:shell-create-vault", "a/b", parentDir);
      out.badName = bad?.error ?? null;
      d.querySelector(".vault-manager-back").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r2) => setTimeout(r2, 200));
      out.home = !!d.querySelector(".vault-manager-title");
      return out;
    }, parent);
    const createdDir = path.join(parent, "Made by test");
    C.check("create-vault form: name, location, create, back link", form.title === "Create local vault" && form.back && form.fields.includes("Vault name") && form.fields.includes("Location") && form.home, JSON.stringify(form));
    C.check("creating a vault makes the folder and opens it in its own window", fs.existsSync(path.join(createdDir, ".obsidian")) && !!(await waitFor(async () => (await windows(L)).find((w) => /Made by test/.test(w.title)), 8000)) && !!form.badName, JSON.stringify((await windows(L)).map((w) => w.title)));
    // Bounds per vault: resize the new vault's window, close it, reopen: same size.
    await L.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /Made by test/.test(x.getTitle()));
      w.setSize(900, 640);
    });
    await sleep(300);
    await L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => /Made by test/.test(x.getTitle()))?.close());
    await sleep(600);
    await win.evaluate((dir) => require("electron").ipcRenderer.invoke("bedrock:shell-open-vault", dir), createdDir);
    const re = await waitFor(async () => (await L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => /Made by test/.test(x.getTitle())).map((x) => x.getSize())))[0], 8000);
    C.check("one window per vault; size remembered per vault", !!re && Math.abs(re[0] - 900) <= 2 && Math.abs(re[1] - 640) <= 2, JSON.stringify(re));
    const twice = await win.evaluate((dir) => require("electron").ipcRenderer.invoke("bedrock:shell-open-vault", dir), createdDir);
    await sleep(400);
    const count = (await windows(L)).filter((w) => /Made by test/.test(w.title)).length;
    C.check("opening an open vault focuses its window instead of a second one", twice && count === 1, String(count));
    await L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => /Made by test/.test(x.getTitle())).forEach((x) => x.close()));
    await win.evaluate(() => window.app.shell.closeVaultManager());
    // Vault switcher at the bottom of the left sidebar.
    const sw2 = await win.evaluate(async () => {
      const el = document.querySelector(".workspace-sidedock-vault-profile");
      const r = el.getBoundingClientRect();
      const dock = document.querySelector(".mod-left-split").getBoundingClientRect();
      el.querySelector(".workspace-drawer-vault-switcher").dispatchEvent(new MouseEvent("mouseenter"));
      el.querySelector(".workspace-drawer-vault-switcher").click();
      await new Promise((res) => setTimeout(res, 300));
      const items = Array.from(document.querySelectorAll(".menu .menu-item-title")).map((e) => e.textContent);
      document.querySelectorAll(".menu").forEach((m) => m.remove());
      return { atBottom: Math.abs(r.bottom - dock.bottom) <= 2, name: el.querySelector(".workspace-drawer-vault-name").textContent, buttons: el.querySelectorAll(".workspace-drawer-vault-actions .clickable-icon").length, items, tip: el.querySelector(".workspace-drawer-vault-switcher").getAttribute("aria-label") };
    });
    C.check("vault switcher at the bottom of the left sidebar: name, menu (vaults + Manage vaults...), help and settings", sw2.atBottom && sw2.name === "vault" && sw2.buttons === 2 && sw2.items.at(-1) === "Manage vaults..." && /files?, \d+ folders?/.test(sw2.tip ?? ""), JSON.stringify(sw2));
    await win.evaluate(() => document.querySelector(".workspace-drawer-vault-actions .clickable-icon:last-child").click());
    C.check("vault switcher settings button opens settings", !!(await waitFor(() => win.evaluate(() => !!window.app.setting.isActive))));
    await win.evaluate(() => window.app.setting.close());
    // Sandbox vault: separate window with sample notes, re-created fresh.
    await win.evaluate(() => require("electron").ipcRenderer.invoke("bedrock:shell-open-sandbox"));
    const sb = await waitFor(async () => (await windows(L)).find((w) => /Sandbox/.test(w.title)), 8000);
    C.check("sandbox vault opens in its own window with sample notes", !!sb && fs.existsSync(path.join(L.userData, "Sandbox", "Start here.md")), JSON.stringify((await windows(L)).map((w) => w.title)));
    await L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => /Sandbox/.test(x.getTitle())).forEach((x) => x.close()));
    // Help window (F1).
    await win.evaluate(() => window.app.commands.executeCommandById("app:open-help"));
    const hw = await waitFor(async () => (await windows(L)).find((w) => w.size[0] === 600 && w.size[1] === 680));
    C.check("help window (600x680) opens with F1's command", !!hw);
    // Update state: a downloaded update shows the relaunch notice and the Settings row.
    await L.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("file:")).webContents.send("bedrock:update-state", { status: "downloaded", version: "9.9.9" }));
    await sleep(300);
    const upd = await win.evaluate(() => Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent).join(" | "));
    C.check("a downloaded update shows a 'Relaunch to update' notice", /9\.9\.9.*Relaunch to update/.test(upd), upd);
    // Popout windows: open/move, layout "floating", own caption buttons area.
    await win.evaluate(async () => {
      const app = window.app;
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Welcome.md"));
      app.commands.executeCommandById("workspace:open-in-new-window");
    });
    await sleep(1200);
    const pop = await win.evaluate(() => {
      const ws = window.app.workspace;
      const w = ws.floatingSplit.children[0];
      return { n: ws.floatingSplit.children.length, editor: !!w?.doc?.querySelector(".cm-editor"), layout: ws.getLayout().floating?.children?.[0]?.type, root: w?.containerEl.className };
    });
    C.check("open in new window: popout with the same note, saved under floating", pop.n === 1 && pop.editor && pop.layout === "window", JSON.stringify(pop));
    await shot(win, "shell-popout-main");
    C.check("no renderer errors (windows)", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    C.check("windows section", false, String(e?.stack ?? e));
  } finally {
    await L.close();
  }
}

// ---------------------------------------------------------------- frame styles
if (want("frame")) {
  for (const frame of ["custom", "native"]) {
    const L = await launch({ beforeLaunch: ({ userData }) => fs.writeFileSync(path.join(userData, "app-settings.json"), JSON.stringify({ frame })) });
    try {
      await sleep(500);
      const st = await L.win.evaluate(() => ({ attr: document.body.getAttribute("data-frame"), frameless: document.body.classList.contains("is-frameless"), title: getComputedStyle(document.querySelector(".titlebar-text")).display, top: document.querySelector(".app-container").getBoundingClientRect().top }));
      const ok = frame === "custom" ? st.attr === "custom" && st.title === "block" && st.top >= 29 : st.attr === "native" && !st.frameless;
      C.check(`window frame style "${frame}" applies after relaunch`, ok, JSON.stringify(st));
      await shot(L.win, "shell-frame-" + frame);
    } finally {
      await L.close();
    }
  }
}

// ---------------------------------------------------------------- persistence and startup
if (want("startup")) {
  const L1 = await launch();
  let keep = { tmp: L1.tmp, vault: L1.vault, userData: L1.userData };
  try {
    await L1.win.evaluate(async () => {
      const app = window.app;
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Welcome.md"));
      await app.workspace.getLeaf("tab").openFile(app.vault.getFileByPath("Beta.md"));
      app.vault.setConfig("openBehavior", "file:Projects/Alpha.md");
      await app.metadataCache.persistNow();
      await app.workspace.saveLayout();
      await app.vault.flushConfig();
    });
    const first = await L1.win.evaluate(() => window.app.metadataCache.lastReused);
    C.check("first start parses every file (nothing saved yet)", first === 0, String(first));
  } finally {
    await L1.close({ keep: true });
  }
  const L2 = await launch({ reuse: keep });
  try {
    const st = await L2.win.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 600));
      const app = window.app;
      let deferred = 0;
      app.workspace.iterateRootLeaves((l) => l.isDeferred && deferred++);
      return { reused: app.metadataCache.lastReused, notes: app.vault.getMarkdownFiles().length, active: app.workspace.getActiveFile()?.path, deferred, links: Object.keys(app.metadataCache.resolvedLinks).length };
    });
    C.check("metadata cache kept between runs (unchanged notes aren't parsed again)", st.reused >= st.notes && st.links > 0, JSON.stringify(st));
    C.check("default file to open on start (a specific file)", st.active === "Projects/Alpha.md", JSON.stringify(st));
    C.check("background tabs restore deferred", st.deferred >= 1, JSON.stringify(st));
    // A note changed while the app was closed is parsed again.
    await L2.win.evaluate(() => window.app.metadataCache.clearPersisted());
  } finally {
    await L2.close({ keep: true });
  }
  fs.appendFileSync(path.join(keep.vault, "Beta.md"), "\n#newtag\n");
  const L3 = await launch({ reuse: keep });
  try {
    const st = await L3.win.evaluate(() => ({ reused: window.app.metadataCache.lastReused, tags: Object.keys(window.app.metadataCache.getTags()) }));
    C.check('"Rebuild vault cache" clears the saved cache (everything is read again)', st.reused === 0 && st.tags.includes("#newtag"), JSON.stringify(st));
    // Config folder override.
    await L3.win.evaluate(() => window.app.saveLocalStorage("config", ".bedrock-alt"));
  } finally {
    await L3.close({ keep: true });
  }
  const L4 = await launch({ reuse: keep });
  try {
    await L4.win.evaluate(async () => {
      window.app.vault.setConfig("showLineNumber", true);
      window.app.vault.setConfig("readableLineLength", true); // default: not written
      await window.app.vault.flushConfig();
    });
    const dir = await L4.win.evaluate(() => window.app.vault.configDir);
    const appJson = JSON.parse(fs.readFileSync(path.join(keep.vault, ".bedrock-alt", "app.json"), "utf8"));
    C.check("config folder name can be overridden; only non-default values are written", dir === ".bedrock-alt" && appJson.showLineNumber === true && !("readableLineLength" in appJson), JSON.stringify(appJson));
    // Reload when a config file changes on disk.
    fs.writeFileSync(path.join(keep.vault, ".bedrock-alt", "appearance.json"), JSON.stringify({ baseFontSize: 21 }));
    fs.writeFileSync(path.join(keep.vault, ".bedrock-alt", "hotkeys.json"), JSON.stringify({ "app:toggle-left-sidebar": [{ modifiers: ["Mod", "Shift"], key: "L" }] }));
    const reloaded = await waitFor(() => L4.win.evaluate(() => window.app.vault.getConfig("baseFontSize") === 21 && window.app.hotkeyManager.printHotkeyForCommand("app:toggle-left-sidebar") !== "" && getComputedStyle(document.body).getPropertyValue("--font-text-size").trim() === "21px"), 4000);
    C.check("config reloads when appearance.json / hotkeys.json change on disk", !!reloaded, JSON.stringify(await L4.win.evaluate(() => [window.app.vault.getConfig("baseFontSize"), window.app.hotkeyManager.printHotkeyForCommand("app:toggle-left-sidebar"), getComputedStyle(document.body).getPropertyValue("--font-text-size")])));
    await L4.win.evaluate(() => window.app.saveLocalStorage("config", null));
  } finally {
    await L4.close();
  }
}

// ---------------------------------------------------------------- URIs
if (want("uri")) {
  const L = await launch({ args: ["bedrock://new?vault=vault&name=From%20URI&content=Hello%20from%20a%20link"] });
  try {
    const made = await waitFor(() => L.win.evaluate(() => window.app.vault.getFileByPath("From URI.md") && window.app.workspace.getActiveFile()?.path), 8000);
    C.check("URI on the command line: new (name, content) creates and opens the note", made === "From URI.md" && fs.readFileSync(path.join(L.vault, "From URI.md"), "utf8") === "Hello from a link");
    const send = (action, params) => L.app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("file:")).webContents.send("bedrock:shell-uri", u), { action, params });
    await send("open", { vault: "vault", file: "Beta" });
    C.check("open (vault, file)", (await waitFor(() => L.win.evaluate(() => window.app.workspace.getActiveFile()?.path === "Beta.md"))) === true);
    await send("open", { vault: "vault", file: "Projects/Alpha", paneType: "split" });
    C.check("open with paneType split", !!(await waitFor(() => L.win.evaluate(() => window.app.workspace.getActiveFile()?.path === "Projects/Alpha.md" && document.querySelectorAll(".mod-root .workspace-tabs").length >= 2))));
    await send("new", { file: "Inbox/Deep/Note", content: "x", silent: "true" });
    await sleep(500);
    C.check("new with file path creates folders; silent doesn't open", fs.existsSync(path.join(L.vault, "Inbox", "Deep", "Note.md")) && (await L.win.evaluate(() => window.app.workspace.getActiveFile()?.path)) !== "Inbox/Deep/Note.md");
    await send("new", { file: "Inbox/Deep/Note", content: "y", append: "true", silent: "true" });
    await sleep(400);
    C.check("new with append adds to an existing note", fs.readFileSync(path.join(L.vault, "Inbox", "Deep", "Note.md"), "utf8") === "x\ny");
    await send("new", { file: "Inbox/Deep/Note", content: "z", overwrite: "true", silent: "true" });
    await sleep(400);
    C.check("new with overwrite replaces the note", fs.readFileSync(path.join(L.vault, "Inbox", "Deep", "Note.md"), "utf8") === "z");
    await send("new", { file: "../escape", content: "no" });
    await sleep(300);
    C.check("new refuses paths outside the vault", !fs.existsSync(path.join(L.vault, "..", "escape.md")));
    await send("search", { query: "tag:#x" });
    C.check("search opens the search pane with the query", !!(await waitFor(() => L.win.evaluate(() => window.app.globalSearch.getGlobalSearchQuery() === "tag:#x"))));
    await send("daily", {});
    C.check("daily opens today's daily note", !!(await waitFor(() => L.win.evaluate(() => /\d{4}-\d{2}-\d{2}/.test(window.app.workspace.getActiveFile()?.basename ?? "")))));
    await L.win.evaluate(() => window.app.internalPlugins.setEnabled("zk-prefixer", true));
    await send("unique", { content: "unique body" });
    C.check("unique creates a unique note", !!(await waitFor(() => L.win.evaluate(() => /^\d{12}/.test(window.app.workspace.getActiveFile()?.basename ?? "")))));
    // hook-get-address copies a Markdown link; with callbacks it calls x-success.
    await L.win.evaluate(async () => window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath("Beta.md")));
    await send("hook-get-address", {});
    await sleep(400);
    const clip = await L.win.evaluate(() => require("electron").ipcRenderer.invoke("bedrock:shell-clipboard", "read"));
    C.check("hook-get-address copies [name](url) of the current note", /^\[Beta\]\(bedrock:\/\/open\?vault=vault&file=Beta\)$/.test(clip), clip);
    await L.win.evaluate(() => {
      window.__opened = [];
      window.app.openExternal = (u) => window.__opened.push(u);
    });
    await send("hook-get-address", { "x-success": "myapp://ok" });
    await sleep(300);
    C.check("x-success is ignored while 'Allow URI callbacks' is off", (await L.win.evaluate(() => window.__opened.length)) === 0);
    await L.win.evaluate(() => window.app.vault.setConfig("uriCallbacks", true));
    await send("hook-get-address", { "x-success": "myapp://ok" });
    await sleep(300);
    const cb = await L.win.evaluate(() => window.__opened[0] ?? "");
    C.check("x-success callback gets name, url and file", /^myapp:\/\/ok\?name=Beta&url=bedrock%3A%2F%2Fopen.*&file=/.test(cb), cb);
    await send("open", { vault: "vault", file: "Missing note", "x-error": "myapp://err" });
    await sleep(300);
    C.check("x-error callback with errorCode", /errorCode=NotFound/.test(await L.win.evaluate(() => window.__opened.at(-1) ?? "")));
    await send("choose-vault", {});
    C.check("choose-vault opens the vault manager", !!(await waitFor(async () => (await windows(L)).find((w) => w.size[0] === 800 && w.size[1] === 650))));
    await L.win.evaluate(() => window.app.shell.closeVaultManager());
    await send("bogus", {});
    await sleep(200);
    C.check("unknown actions say so", /Invalid URI action/.test(await L.win.evaluate(() => Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent).join("|"))));
  } finally {
    await L.close();
  }
  // Short forms and obsidian:// payloads as arguments.
  const L2 = await launch({ args: ["obsidian://vault/vault/Projects/Alpha"] });
  try {
    C.check("obsidian:// vault/<vault>/<file> short form opens the note", (await waitFor(() => L2.win.evaluate(() => window.app.workspace.getActiveFile()?.path === "Projects/Alpha.md"), 8000)) === true);
  } finally {
    await L2.close();
  }
  const absArgs = [];
  const L3 = await launch({ args: absArgs, beforeLaunch: ({ vault }) => absArgs.push("bedrock:///" + path.join(vault, "Beta.md").split(path.sep).join("/")) });
  try {
    C.check("absolute path form (bedrock:///<path>) opens the note in its vault", (await waitFor(() => L3.win.evaluate(() => window.app.workspace.getActiveFile()?.path === "Beta.md"), 8000)) === true, absArgs[0]);
  } finally {
    await L3.close();
  }
}

process.exit(C.summary() ? 1 : 0);
