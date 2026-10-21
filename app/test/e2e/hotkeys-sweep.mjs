// Hotkeys sweep: every default hotkey in docs/reference/commands.json is bound to the same command
// and works when pressed for real (Playwright keyboard -> Chromium input pipeline -> our keymap),
// plus the editor keys that are not commands (undo/redo, select all, clipboard, indent, list
// continuation, window zoom). Windows/Linux bindings (Mod = Ctrl).
// Usage: node test/e2e/hotkeys-sweep.mjs [--keep]
import fs from "node:fs";
import path from "node:path";
import { launch, Checks, repoDir, shot } from "./lib/harness.mjs";

const ref = JSON.parse(fs.readFileSync(path.join(repoDir, "docs", "reference", "commands.json"), "utf8")).commands.filter((c) => c.defaultHotkeys.length);
const C = new Checks();

const KEYNAME = { " ": "Space" };
function chord(hk) {
  const mods = hk.modifiers.map((m) => ({ Mod: "Control", Ctrl: "Control", Meta: "Meta", Shift: "Shift", Alt: "Alt" })[m]);
  return [...mods, KEYNAME[hk.key] ?? hk.key].join("+");
}

// State a hotkey needs to apply (same names as the commands sweep).
const SETUP = {
  "app:go-back": "history",
  "app:go-forward": "history-forward",
  "workspace:undo-close-pane": "closed",
  "workspace:close-window": "popout",
  "editor:follow-link": "on-link",
  "editor:open-link-in-new-leaf": "on-link",
  "editor:open-link-in-new-split": "on-link",
  "editor:open-link-in-new-window": "on-link",
};
for (let i = 1; i <= 9; i++) SETUP[i === 9 ? "workspace:goto-last-tab" : `workspace:goto-tab-${i}`] = "tabs9";

const L = await launch();
const { win, errors } = L;
try {
  await win.evaluate(async () => {
    const app = window.app;
    for (const p of Object.values(app.internalPlugins.plugins)) if (!p.info.legacy && p.id !== "publish") await p.enable?.();
    // Keep the browser and OS dialogs out of the test.
    app.openExternal = () => {};
    window.__ran = [];
    const orig = app.commands.executeCommand.bind(app.commands);
    app.commands.executeCommand = (c) => {
      const r = orig(c);
      window.__ran.push({ id: c.id, ok: r });
      return r;
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__hk = {
      async reset(variant) {
        for (const m of Array.from(document.querySelectorAll(".modal-container"))) m.remove();
        while (app.keymap.scopes?.length) app.keymap.popScope(app.keymap.scopes[app.keymap.scopes.length - 1]);
        document.querySelectorAll(".menu").forEach((m) => m.remove());
        app.setting?.close?.();
        for (const w of app.workspace.floatingSplit.children.slice()) w.close();
        await app.workspace.changeLayout(app.workspace.defaultLayout());
        let welcome = app.vault.getFileByPath("Welcome.md") ?? (await app.vault.create("Welcome.md", "# Welcome\n\nSee [[Beta]].\n"));
        const beta = app.vault.getFileByPath("Beta.md") ?? (await app.vault.create("Beta.md", "# Beta\n"));
        const l1 = app.workspace.getLeaf(false);
        if (variant === "history" || variant === "history-forward") {
          await l1.openFile(beta, { active: true });
          await l1.openFile(welcome, { active: true });
          if (variant === "history-forward") await l1.history.back();
        } else await l1.openFile(welcome, { active: true, state: { mode: "source" } });
        const l2 = app.workspace.getLeaf("tab");
        await l2.openFile(beta, { active: false });
        if (variant === "tabs9") for (let i = 0; i < 7; i++) await app.workspace.createLeafInTabs(l1.parent).openFile(beta, { active: false });
        app.workspace.setActiveLeaf(l1, { focus: true });
        if (variant === "closed") app.closedTabs.push({ type: "markdown", state: { file: "Beta.md" } });
        if (variant === "popout") {
          const pl = app.workspace.openPopoutLeaf();
          await pl.openFile(beta, { active: true });
          await sleep(300);
          app.workspace.setActiveLeaf(l1, { focus: true });
        }
        await sleep(100);
        const ed = app.workspace.activeLeaf?.view?.editor;
        if (ed) {
          ed.focus();
          if (variant === "on-link") {
            const lines = ed.getValue().split("\n");
            const ln = lines.findIndex((x) => x.includes("[["));
            if (ln >= 0) ed.setCursor({ line: ln, ch: lines[ln].indexOf("[[") + 3 });
          } else ed.setCursor({ line: ed.lineCount() - 1, ch: 0 });
        }
        window.__ran = [];
      },
    };
  });

  // 1) Bindings match the reference and fire the right command on a real key press.
  const registered = new Set(await win.evaluate(() => Object.keys(window.app.commands.commands)));
  for (const c of ref) {
    for (const hk of c.defaultHotkeys) {
      const label = `${chord(hk)} -> ${c.id}`;
      if (!registered.has(c.id)) {
        C.check(label, false, "command not registered");
        continue;
      }
      const bound = await win.evaluate(({ id, hk }) => (window.app.hotkeyManager.getDefaultHotkeys(id) ?? []).some((h) => h.key.toUpperCase() === hk.key.toUpperCase() && [...h.modifiers].sort().join() === [...hk.modifiers].sort().join()), { id: c.id, hk });
      await win.evaluate((v) => window.__hk.reset(v), SETUP[c.id] ?? null);
      // The popout case: press while a popout is focused is covered by close-window itself.
      await win.keyboard.press(chord(hk));
      await win.waitForTimeout(c.id === "workspace:close-window" ? 600 : 250);
      const ran = await win.evaluate(() => window.__ran.slice());
      const hit = ran.find((r) => r.id === c.id);
      const others = ran.filter((r) => r.id !== c.id && r.ok).map((r) => r.id);
      const ok = bound && hit?.ok === true && !others.length;
      C.check(label, ok, ok ? "" : `bound=${bound} ran=${JSON.stringify(ran)}`);
      if (!ok) await shot(win, "hotkey-fail-" + c.id.replace(/[^a-z0-9-]/gi, "_"));
    }
  }

  // 2) Editor keys that aren't commands.
  await win.evaluate(() => window.__hk.reset(null));
  const doc = () => win.evaluate(() => window.app.workspace.activeLeaf.view.editor.getValue());
  const setDoc = (t, line, ch) =>
    win.evaluate(
      ({ t, line, ch }) => {
        const ed = window.app.workspace.activeLeaf.view.editor;
        ed.setValue(t);
        ed.setCursor({ line, ch });
        ed.focus();
      },
      { t, line, ch },
    );
  await setDoc("alpha", 0, 5);
  await win.keyboard.type(" beta");
  await win.keyboard.press("Control+Z");
  await win.waitForTimeout(100);
  const afterUndo = await doc();
  await win.keyboard.press("Control+Y");
  await win.waitForTimeout(100);
  const afterRedo = await doc();
  C.check("Ctrl+Z undo / Ctrl+Y redo", afterUndo === "alpha" && afterRedo === "alpha beta", `${JSON.stringify(afterUndo)} / ${JSON.stringify(afterRedo)}`);
  await win.keyboard.press("Control+Shift+Z");
  C.check("Ctrl+Shift+Z redo does not break", (await doc()).startsWith("alpha"));
  await setDoc("one two", 0, 0);
  await win.keyboard.press("Control+A");
  const selAll = await win.evaluate(() => window.app.workspace.activeLeaf.view.editor.getSelection());
  C.check("Ctrl+A selects all", selAll === "one two", selAll);
  await win.keyboard.press("Control+C");
  await win.keyboard.press("End");
  await win.keyboard.press("Control+V");
  await win.waitForTimeout(150);
  C.check("Ctrl+C / Ctrl+V copy and paste", (await doc()) === "one twoone two", await doc());
  await win.keyboard.press("Control+A");
  await win.keyboard.press("Control+X");
  await win.waitForTimeout(100);
  C.check("Ctrl+X cut", (await doc()) === "", await doc());
  await win.keyboard.press("Control+Shift+V");
  await win.waitForTimeout(150);
  C.check("Ctrl+Shift+V paste as plain text", (await doc()) === "one twoone two", await doc());
  await setDoc("- item", 0, 6);
  await win.keyboard.press("Enter");
  await win.keyboard.type("next");
  C.check("Enter continues a list", (await doc()) === "- item\n- next", JSON.stringify(await doc()));
  await win.keyboard.press("Tab");
  await win.waitForTimeout(80);
  const indented = await doc();
  await win.keyboard.press("Shift+Tab");
  await win.waitForTimeout(80);
  C.check("Tab / Shift+Tab indent and unindent a list item", /\n\s+- next$/.test(indented) && (await doc()) === "- item\n- next", JSON.stringify([indented, await doc()]));
  await setDoc("abc\ndef", 0, 0);
  await win.keyboard.press("Shift+ArrowDown");
  const sel = await win.evaluate(() => window.app.workspace.activeLeaf.view.editor.getSelection());
  C.check("Shift+Arrow extends the selection", sel === "abc\n", JSON.stringify(sel));
  // Window zoom (not commands): Ctrl+= / Ctrl+- / Ctrl+0
  const zoom = () => win.evaluate(() => require("electron").webFrame.getZoomLevel());
  await win.keyboard.press("Control+Equal");
  await win.waitForTimeout(150);
  const zIn = await zoom();
  await win.keyboard.press("Control+Minus");
  await win.keyboard.press("Control+Minus");
  await win.waitForTimeout(150);
  const zOut = await zoom();
  await win.keyboard.press("Control+Digit0");
  await win.waitForTimeout(150);
  C.check("Ctrl+= / Ctrl+- / Ctrl+0 zoom the window", zIn > 0 && zOut < zIn && (await zoom()) === 0, `${zIn} ${zOut} ${await zoom()}`);
  C.check("no renderer errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  C.check("hotkeys run", false, String(e?.stack ?? e));
} finally {
  await L.close();
}
process.exit(C.summary() ? 1 : 0);
