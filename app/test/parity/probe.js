// Injected into both apps (Bedrock and the reference app) by run.mjs. Only uses the public
// plugin API surface (app.vault, app.workspace, MarkdownView.editor) and the DOM, so the same
// probe works on both. Defines window.__parity.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CURSOR = "‸";
  const view = () => app.workspace.activeLeaf && app.workspace.activeLeaf.view;
  const cm = () => view().editor.cm;

  /** Parse "a‸b" / "a«sel»b" (and several cursors) into text + ranges. */
  function parseMarked(src) {
    let text = "";
    const ranges = [];
    let anchor = null;
    for (const ch of src) {
      if (ch === CURSOR) ranges.push({ anchor: text.length, head: text.length });
      else if (ch === "«") anchor = text.length;
      else if (ch === "»") {
        ranges.push({ anchor, head: text.length });
        anchor = null;
      } else text += ch;
    }
    if (!ranges.length) ranges.push({ anchor: text.length, head: text.length });
    return { text, ranges };
  }

  function markDoc(state) {
    const doc = state.doc.toString();
    const marks = [];
    for (const r of state.selection.ranges) {
      if (r.empty) marks.push([r.head, CURSOR]);
      else {
        marks.push([r.from, "«"]);
        marks.push([r.to, "»"]);
      }
    }
    marks.sort((a, b) => b[0] - a[0] || (a[1] === "«" ? -1 : 1));
    let out = doc;
    for (const [p, m] of marks) out = out.slice(0, p) + m + out.slice(p);
    return out;
  }

  function invisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
    if (parseFloat(cs.fontSize) === 0) return true;
    const m = cs.color.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map((s) => s.trim());
      if (parts.length === 4 && parseFloat(parts[3]) === 0) return true;
    }
    return false;
  }

  const BLOCK_KINDS = [
    ["cm-table-widget", "table"],
    ["cm-callout", "callout"],
    ["math-block", "math"],
    ["mermaid", "mermaid"],
    ["image-embed", "image"],
    ["pdf-embed", "pdf"],
    ["media-embed", "media"],
    ["markdown-embed", "embed"],
    ["internal-embed", "embed"],
    ["metadata-container", "properties"],
    ["cm-embed-block", "block"],
  ];
  function blockKind(el) {
    for (const [c, k] of BLOCK_KINDS) if (el.classList.contains(c) || el.querySelector("." + c)) return k;
    return "widget";
  }

  function renderInline(node) {
    if (node.nodeType === 3) return node.textContent.replace(/[​﻿]/g, "");
    if (node.nodeType !== 1) return "";
    const el = node;
    if (el.classList.contains("cm-widgetBuffer")) return "";
    if (el.tagName === "BR") return "";
    if (el.tagName === "INPUT" && el.type === "checkbox") return el.checked ? "☑" : "☐";
    if (el.classList.contains("list-bullet")) return "•";
    if (el.tagName === "IMG") return "⟦img⟧";
    if (el.classList.contains("cm-fold-indicator") || el.classList.contains("cm-foldPlaceholder")) return el.classList.contains("cm-foldPlaceholder") ? "…" : "";
    if (el.classList.contains("math") || el.classList.contains("math-inline")) return "⟦math⟧";
    if (el.getAttribute("contenteditable") === "false" && (el.classList.contains("internal-embed") || el.classList.contains("cm-embed-block"))) return "⟦" + blockKind(el) + "⟧";
    if (invisible(el)) return "";
    let s = "";
    for (const c of el.childNodes) s += renderInline(c);
    return s;
  }

  function renderedLines() {
    const out = [];
    for (const child of cm().contentDOM.children) {
      if (child.classList.contains("cm-line")) {
        const cls = [...child.classList].filter((c) => c.startsWith("HyperMD-")).sort().join(" ");
        out.push({ text: renderInline(child), cls });
      } else if (child.classList.contains("cm-gap")) {
        continue;
      } else {
        out.push({ text: "⟦" + blockKind(child) + "⟧", cls: "" });
      }
    }
    return out;
  }

  function suggestions() {
    const items = [...document.querySelectorAll(".suggestion-container .suggestion-item")];
    return items.map((e) => {
      const title = e.querySelector(".suggestion-title");
      const note = e.querySelector(".suggestion-note");
      return ((title ? title.innerText : e.innerText) + (note && note.innerText ? " | " + note.innerText : "")).replace(/\s+/g, " ").trim();
    });
  }

  window.__parity = {
    async open(path, mode) {
      // Dismiss popovers (an editing popover steals app.workspace.activeEditor) with an outside click.
      if (document.querySelector(".popover")) {
        for (const t of ["mousedown", "mouseup", "click"]) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true }));
        await sleep(300);
      }
      let f = app.vault.getAbstractFileByPath(path);
      if (!f) f = await app.vault.create(path, "");
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(f, { active: true });
      const st = leaf.getViewState();
      st.state = { ...st.state, mode: "source", source: mode === "source" };
      await leaf.setViewState(st);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await sleep(200);
      return !!view().editor;
    },
    async setDoc(marked) {
      const { text, ranges } = parseMarked(marked);
      const v = cm();
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      v.focus();
      const ed = view().editor;
      ed.setSelections(ranges.map((r) => ({ anchor: ed.offsetToPos(r.anchor), head: ed.offsetToPos(r.head) })));
      await sleep(150);
    },
    focus() {
      cm().focus();
    },
    blur() {
      cm().contentDOM.blur();
    },
    async command(id) {
      app.commands.executeCommandById(id);
      await sleep(120);
    },
    async setConfig(key, value) {
      app.vault.setConfig(key, value);
      if (app.workspace.updateOptions) app.workspace.updateOptions();
      await sleep(100);
    },
    state() {
      const v = cm();
      return { doc: markDoc(v.state), lines: renderedLines(), focus: v.hasFocus, suggest: suggestions() };
    },
    closeSuggest() {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    },
  };
  return true;
})();
