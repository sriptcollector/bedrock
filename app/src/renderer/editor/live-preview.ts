// Live preview: hide Markdown syntax except where the cursor/selection is, and render rich
// elements inline (links, embeds, images, checkboxes, bullets, rules, math, callouts, tables,
// mermaid, properties). Line classes (HyperMD-*) are added in both modes for theme compatibility.
import { RangeSetBuilder, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { editorInfoField, editorLivePreviewField } from "./fields";
import { renderMathToString, escapeHtml } from "../markdown/parser";
import { renderEmbed, renderMarkdownInto, decorateCallout, loadMermaid, renderHtml } from "../markdown/renderer";
import { Component } from "../api/events";
import { splitAlias, parseLinktext } from "../../core/links";
import { Keymap } from "../commands/keymap";

// ---------- helpers ----------
function selectionTouches(state: EditorState, from: number, to: number, hasFocus: boolean): boolean {
  if (!hasFocus) return false;
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

function lineTouched(state: EditorState, from: number, to: number, hasFocus: boolean): boolean {
  if (!hasFocus) return false;
  const a = state.doc.lineAt(from).from;
  const b = state.doc.lineAt(to).to;
  return selectionTouches(state, a, b, true);
}

const hide = Decoration.replace({});

// ---------- widgets ----------
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const wrap = createEl("label", { cls: "task-list-label", attr: { contenteditable: "false" } });
    const cb = wrap.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
    cb.setAttr("data-task", this.checked ? "x" : " ");
    cb.checked = this.checked;
    cb.addEventListener("mousedown", (e) => e.preventDefault());
    cb.addEventListener("click", (e) => {
      e.preventDefault();
      const ch = view.state.sliceDoc(this.pos + 1, this.pos + 2);
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: ch === " " ? "x" : " " }, userEvent: "input.toggle" });
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return createSpan({ cls: "list-bullet", text: "-" });
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const d = createDiv("hr");
    d.createEl("hr");
    return d;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly src: string, readonly display: boolean) {
    super();
  }
  eq(o: MathWidget) {
    return o.src === this.src && o.display === this.display;
  }
  toDOM() {
    const el = this.display ? createDiv("math math-block cm-embed-block") : createSpan("math math-inline");
    el.innerHTML = renderMathToString(this.src, this.display);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class LinkWidget extends WidgetType {
  constructor(readonly text: string, readonly href: string, readonly internal: boolean, readonly unresolved: boolean) {
    super();
  }
  eq(o: LinkWidget) {
    return o.text === this.text && o.href === this.href && o.unresolved === this.unresolved;
  }
  toDOM() {
    const s = createSpan(this.internal ? "cm-hmd-internal-link" : "cm-link");
    const a = s.createSpan({ cls: "cm-underline" + (this.unresolved ? " is-unresolved" : ""), text: this.text });
    a.setAttr("data-href", this.href);
    if (!this.internal) s.addClass("external-link");
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class EmbedWidget extends WidgetType {
  private comp = new Component();
  constructor(readonly src: string, readonly alt: string, readonly app: any, readonly sourcePath: string) {
    super();
  }
  eq(o: EmbedWidget) {
    return o.src === this.src && o.alt === this.alt && o.sourcePath === this.sourcePath;
  }
  toDOM(view: EditorView) {
    const span = createSpan({ cls: "internal-embed cm-embed-block", attr: { src: this.src, alt: this.alt } });
    this.comp.load();
    renderEmbed(this.app, span, this.sourcePath, this.comp, 1).then(() => view.requestMeasure());
    span.querySelectorAll("img").forEach((img) => img.addEventListener("load", () => view.requestMeasure()));
    span.addEventListener("load", () => view.requestMeasure(), true);
    return span;
  }
  destroy() {
    this.comp.unload();
  }
  ignoreEvent(e: Event) {
    return e.type !== "mousedown";
  }
}

class RenderedBlockWidget extends WidgetType {
  private comp = new Component();
  constructor(readonly source: string, readonly kind: "callout" | "table", readonly app: any, readonly sourcePath: string, readonly from: number) {
    super();
  }
  eq(o: RenderedBlockWidget) {
    return o.source === this.source && o.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const el = createDiv(`cm-embed-block markdown-rendered cm-${this.kind}`);
    el.setAttr("contenteditable", "false");
    this.comp.load();
    if (this.kind === "table") {
      el.addClass("cm-table-widget");
      el.innerHTML = renderHtml(this.source);
      view.requestMeasure();
    } else {
      renderMarkdownInto(this.app, this.source, el, this.sourcePath, this.comp, { embedDepth: 1 }).then(() => {
        el.querySelectorAll<HTMLElement>(".callout").forEach((c) => decorateCallout(c));
        view.requestMeasure();
      });
    }
    const edit = el.createDiv({ cls: "edit-block-button", attr: { "aria-label": "Edit this block" } });
    edit.setText("</>");
    edit.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 1 } });
      view.focus();
    });
    return el;
  }
  destroy() {
    this.comp.unload();
  }
  ignoreEvent(e: Event) {
    return !(e.target as HTMLElement).closest?.(".edit-block-button") && e.type !== "mousedown";
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly src: string, readonly from: number) {
    super();
  }
  eq(o: MermaidWidget) {
    return o.src === this.src;
  }
  toDOM(view: EditorView) {
    const el = createDiv("cm-embed-block mermaid");
    loadMermaid()
      .then((m) => m.render("bedrock-lp-mermaid-" + Math.random().toString(36).slice(2), this.src))
      .then(({ svg }: any) => {
        el.innerHTML = svg;
        view.requestMeasure();
      })
      .catch((e: any) => el.setText(String(e?.message ?? e)));
    return el;
  }
}

class CodeFlairWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  eq(o: CodeFlairWidget) {
    return o.lang === this.lang;
  }
  toDOM() {
    return createSpan({ cls: "code-block-flair", text: this.lang });
  }
}

/** Zero-height stand-in for the frontmatter block in live preview (properties show above). */
class HiddenBlockWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return createDiv("cm-frontmatter-hidden");
  }
  get estimatedHeight() {
    return 0;
  }
}

// ---------- block-level decorations (state field) ----------
function buildBlockDecorations(state: EditorState): DecorationSet {
  const lp = state.field(editorLivePreviewField, false) ?? true;
  const owner = state.field(editorInfoField, false);
  const app = owner?.app;
  const sourcePath = owner?.file?.path ?? "";
  const focus = owner?.editorHasFocus?.() ?? true;
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  let headerPlaced = false;

  tree.iterate({
    enter: (node: SyntaxNodeRef) => {
      const { from, to, name } = node;
      if (name === "Document") return true;
      if (name === "Frontmatter") {
        if (lp && owner && from === 0 && owner.app?.vault.getConfig("propertiesInDocument") !== "source") {
          const end = Math.min(state.doc.length, to);
          decos.push(Decoration.replace({ widget: new HiddenBlockWidget(), block: true }).range(0, end));
          headerPlaced = true;
        }
        return false;
      }
      if (!lp) return false;
      if (name === "Table") {
        if (!lineTouched(state, from, to, focus)) {
          decos.push(Decoration.replace({ widget: new RenderedBlockWidget(state.sliceDoc(from, to), "table", app, sourcePath, from), block: true }).range(from, to));
        }
        return false;
      }
      if (name === "Blockquote") {
        const first = state.doc.lineAt(from).text;
        if (/^\s*>\s*\[![^\]]+\]/.test(first) && !lineTouched(state, from, to, focus)) {
          decos.push(Decoration.replace({ widget: new RenderedBlockWidget(state.sliceDoc(from, to), "callout", app, sourcePath, from), block: true }).range(from, to));
          return false;
        }
        return true;
      }
      if (name === "BlockMath") {
        if (!lineTouched(state, from, to, focus)) {
          const src = state.sliceDoc(from, to).trim().replace(/^\$\$|\$\$$/g, "");
          decos.push(Decoration.replace({ widget: new MathWidget(src, true), block: true }).range(from, to));
        }
        return false;
      }
      if (name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        const lang = info ? state.sliceDoc(info.from, info.to).trim() : "";
        if (lang === "mermaid" && !lineTouched(state, from, to, focus)) {
          const text = node.node.getChild("CodeText");
          const src = text ? state.sliceDoc(text.from, text.to) : "";
          decos.push(Decoration.replace({ widget: new MermaidWidget(src, from), block: true }).range(from, to));
        }
        return false;
      }
      return name === "BulletList" || name === "OrderedList" || name === "ListItem" || name === "Paragraph";
    },
  });
  owner?.onFrontmatterHidden?.(headerPlaced);
  return Decoration.set(decos, true);
}

export const blockDecorationsField = StateField.define<DecorationSet>({
  create: (s) => buildBlockDecorations(s),
  update(value, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    const lpChanged = tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
    if (tr.docChanged || tr.selection || treeChanged || lpChanged || tr.effects.some((e) => e.is(refreshLivePreview))) return buildBlockDecorations(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

import { StateEffect } from "@codemirror/state";
export const refreshLivePreview = StateEffect.define<null>();

// ---------- inline decorations (view plugin) ----------
function buildInline(view: EditorView): DecorationSet {
  const state = view.state;
  const lp = state.field(editorLivePreviewField, false) ?? true;
  const owner = state.field(editorInfoField, false);
  const app = owner?.app;
  const sourcePath = owner?.file?.path ?? "";
  const focus = view.hasFocus;
  const decos: Range<Decoration>[] = [];
  const lineDeco = (pos: number, cls: string, attrs?: Record<string, string>) => {
    const l = state.doc.lineAt(pos);
    decos.push(Decoration.line({ class: cls, attributes: attrs }).range(l.from));
  };
  for (const { from: vf, to: vt } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: vf,
      to: vt,
      enter: (node: SyntaxNodeRef) => {
        const { from, to, name } = node;
        const m = name.match(/^ATXHeading(\d)$/);
        if (m) {
          lineDeco(from, `HyperMD-header HyperMD-header-${m[1]}`);
          if (lp && !lineTouched(state, from, to, focus)) {
            const mark = node.node.getChild("HeaderMark");
            if (mark && mark.from === from) {
              const after = state.sliceDoc(mark.to, mark.to + 1) === " " ? mark.to + 1 : mark.to;
              decos.push(hide.range(mark.from, after));
            }
            // closing #'s
            const marks = node.node.getChildren("HeaderMark");
            if (marks.length > 1) {
              const last = marks[marks.length - 1];
              decos.push(hide.range(Math.max(from, last.from - 1), last.to));
            }
          }
          return true;
        }
        if (name === "SetextHeading1" || name === "SetextHeading2") {
          lineDeco(from, `HyperMD-header HyperMD-header-${name.endsWith("1") ? 1 : 2}`);
          return true;
        }
        if (name === "Frontmatter") {
          if (!lp) for (let p = from; p <= to; ) {
            const l = state.doc.lineAt(p);
            decos.push(Decoration.line({ class: "HyperMD-frontmatter" }).range(l.from));
            p = l.to + 1;
          }
          return false;
        }
        if (name === "FencedCode") {
          const first = state.doc.lineAt(from);
          const last = state.doc.lineAt(to);
          for (let n = first.number; n <= last.number; n++) {
            const l = state.doc.line(n);
            const cls = "HyperMD-codeblock HyperMD-codeblock-bg" + (n === first.number ? " HyperMD-codeblock-begin HyperMD-codeblock-begin-bg" : "") + (n === last.number && n !== first.number ? " HyperMD-codeblock-end HyperMD-codeblock-end-bg" : "");
            decos.push(Decoration.line({ class: cls }).range(l.from));
          }
          if (lp && !lineTouched(state, from, to, focus)) {
            const info = node.node.getChild("CodeInfo");
            const lang = info ? state.sliceDoc(info.from, info.to) : "";
            if (first.length) decos.push(Decoration.replace({ widget: lang ? new CodeFlairWidget(lang) : undefined }).range(first.from, first.to));
            if (last.number !== first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text)) decos.push(hide.range(last.from, last.to));
          }
          return false;
        }
        if (name === "Blockquote") {
          for (let p = from; p <= to; ) {
            const l = state.doc.lineAt(p);
            decos.push(Decoration.line({ class: "HyperMD-quote HyperMD-quote-1" }).range(l.from));
            p = l.to + 1;
          }
          return true;
        }
        if (name === "QuoteMark") {
          // Parity (Obsidian 1.14.4): the ">" stays in the text but turns transparent unless the
          // cursor is on that line; the line's left border draws the quote.
          decos.push(Decoration.mark({ class: "cm-formatting cm-formatting-quote" }).range(from, to));
          if (lp && !lineTouched(state, from, to, focus)) decos.push(Decoration.mark({ class: "cm-transparent" }).range(from, to));
          return false;
        }
        if (name === "ListItem") {
          const l = state.doc.lineAt(from);
          let depth = 0;
          for (let p = node.node.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
          lineDeco(from, `HyperMD-list-line HyperMD-list-line-${depth} cm-line-list`);
          const task = node.node.getChild("Task");
          if (task) {
            const marker = task.getChild("TaskMarker");
            if (marker) {
              const ch = state.sliceDoc(marker.from + 1, marker.from + 2);
              decos.push(Decoration.line({ class: "HyperMD-task-line", attributes: { "data-task": ch } }).range(l.from));
              const listMark = node.node.getChild("ListMark");
              if (lp && !selectionTouches(state, listMark ? listMark.from : marker.from, marker.to, focus)) {
                decos.push(Decoration.replace({ widget: new CheckboxWidget(ch !== " ", marker.from) }).range(marker.from, marker.to));
              }
            }
          }
          return true;
        }
        if (name === "ListMark") {
          const parent = node.node.parent?.parent;
          const isBullet = parent?.name === "BulletList";
          const hasTask = !!node.node.parent?.getChild("Task");
          decos.push(Decoration.mark({ class: "cm-formatting cm-formatting-list " + (isBullet ? "cm-formatting-list-ul" : "cm-formatting-list-ol") }).range(from, to));
          const taskMarker = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
          const revealTo = hasTask && taskMarker ? taskMarker.to : to;
          if (lp && isBullet && !selectionTouches(state, from, revealTo, focus)) {
            if (hasTask) decos.push(hide.range(from, Math.min(to + 1, state.doc.lineAt(from).to)));
            else decos.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
          }
          return false;
        }
        if (name === "HorizontalRule") {
          lineDeco(from, "HyperMD-hr");
          if (lp && !lineTouched(state, from, to, focus)) decos.push(Decoration.replace({ widget: new HrWidget() }).range(from, to));
          return false;
        }
        if (!lp) {
          if (name === "WikiLink" || name === "Embed") {
            decos.push(Decoration.mark({ attributes: { "data-href": splitAlias(state.sliceDoc(from, to).replace(/^!?\[\[|\]\]$/g, "")).link } }).range(from, to));
            return false;
          }
          return true;
        }
        // ----- live preview inline elements -----
        const touched = selectionTouches(state, from, to, focus);
        switch (name) {
          case "Emphasis":
          case "StrongEmphasis":
          case "Strikethrough":
          case "Highlight":
          case "InlineCode": {
            if (!touched) {
              const markName = name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : name === "Highlight" ? "HighlightMark" : "EmphasisMark";
              let c = node.node.firstChild;
              for (; c; c = c.nextSibling) if (c.name === markName && (c.from === from || c.to === to)) decos.push(hide.range(c.from, c.to));
            }
            if (name === "InlineCode") decos.push(Decoration.mark({ class: "cm-inline-code" }).range(from, to));
            return true;
          }
          case "WikiLink": {
            if (touched) return false;
            const inner = state.sliceDoc(from + 2, to - 2);
            const { link, alias } = splitAlias(inner);
            const display = alias ?? link.replace(/#\^?/g, (x) => (x === "#" ? " > " : " > ^")).replace(/^ > /, "");
            const unresolved = !!app && !!parseLinktext(link).path && !app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, sourcePath);
            decos.push(Decoration.replace({ widget: new LinkWidget(display, link, true, unresolved) }).range(from, to));
            return false;
          }
          case "Embed": {
            if (touched) return false;
            const inner = state.sliceDoc(from + 3, to - 2);
            const { link, alias } = splitAlias(inner);
            if (app) decos.push(Decoration.replace({ widget: new EmbedWidget(link, alias ?? "", app, sourcePath) }).range(from, to));
            return false;
          }
          case "Link": {
            if (touched) return false;
            const text = state.sliceDoc(from, to);
            const mm = text.match(/^\[([\s\S]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)$/);
            if (!mm) return true;
            const href = mm[2];
            const internal = !/^[a-z][a-z0-9+.-]*:/i.test(href);
            let target = href;
            try {
              target = decodeURI(href);
            } catch {
              /* keep */
            }
            decos.push(Decoration.replace({ widget: new LinkWidget(mm[1], target, internal, false) }).range(from, to));
            return false;
          }
          case "Image": {
            if (touched) return false;
            const text = state.sliceDoc(from, to);
            const mm = text.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?\s*\)$/);
            if (!mm || !app) return false;
            const src = mm[2];
            if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^file:/i.test(src)) {
              decos.push(Decoration.replace({ widget: new ExternalImageWidget(src, mm[1]) }).range(from, to));
            } else {
              let p = src;
              try {
                p = decodeURI(src);
              } catch {
                /* keep */
              }
              decos.push(Decoration.replace({ widget: new EmbedWidget(p, mm[1], app, sourcePath) }).range(from, to));
            }
            return false;
          }
          case "InlineMath": {
            if (touched) return false;
            const src = state.sliceDoc(from, to);
            const display = src.startsWith("$$");
            decos.push(Decoration.replace({ widget: new MathWidget(display ? src.slice(2, -2) : src.slice(1, -1), display) }).range(from, to));
            return false;
          }
          case "URL":
          case "Autolink":
            return false;
        }
        return true;
      },
    });
  }
  return Decoration.set(decos, true);
}

class ExternalImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(o: ExternalImageWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const m = this.alt.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
    const img = createEl("img", { attr: { src: this.src, alt: m ? m[1] : this.alt, referrerpolicy: "no-referrer" } });
    if (m) img.setAttr("width", m[2]);
    img.addEventListener("load", () => view.requestMeasure());
    const s = createSpan("image-embed");
    s.appendChild(img);
    return s;
  }
}

export const inlineLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInline(view);
    }
    update(u: ViewUpdate) {
      const lpChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || lpChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(refreshLivePreview)))) {
        this.decorations = buildInline(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e: MouseEvent, view: EditorView) {
        const t = e.target as HTMLElement;
        const lp = view.state.field(editorLivePreviewField, false);
        const owner = view.state.field(editorInfoField, false);
        const linkEl = t.closest<HTMLElement>("[data-href]");
        if (!linkEl || !owner?.app || e.button !== 0) return false;
        const isWidget = !!t.closest(".cm-hmd-internal-link, .cm-link");
        // Live preview: plain click opens a rendered link. Source mode: Mod+click opens.
        if ((lp && isWidget) || Keymap.isModifier(e, "Mod")) {
          e.preventDefault();
          const href = linkEl.getAttribute("data-href")!;
          if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            // Web viewer (when on) opens web links in a tab.
            if (!owner.app.openWebLink?.(href)) owner.app.openExternal(href);
          }
          else owner.app.workspace.openLinkText(href, owner.file?.path ?? "", Keymap.isModEvent(e) || false);
          return true;
        }
        return false;
      },
    },
  },
);

/** Tags: add begin/end classes so themes can draw pills. */
export const hashtagDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (n) => {
            if (n.name === "Hashtag") {
              const tag = view.state.sliceDoc(n.from + 1, n.to);
              b.add(n.from, n.from + 1, Decoration.mark({ class: "cm-formatting cm-formatting-hashtag cm-hashtag-begin", attributes: { "data-tag": tag } }));
              b.add(n.from + 1, n.to, Decoration.mark({ class: "cm-hashtag-end", attributes: { "data-tag": tag } }));
            }
          },
        });
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

export function livePreviewExtensions(): Extension[] {
  return [blockDecorationsField, inlineLivePreview, hashtagDecorations];
}

export { escapeHtml };
