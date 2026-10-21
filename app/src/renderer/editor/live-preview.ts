// Live preview: hide Markdown syntax per token group unless the selection touches it (only while
// the editor has focus), and render rich elements in place (links, embeds, images, checkboxes,
// bullets, rules, math, callouts, tables, HTML, mermaid, properties). Hidden ranges are atomic
// for cursor motion. Decorations are only mapped (not rebuilt) while the mouse button is down or
// during IME composition, so dragging a selection doesn't make text jump. Line classes
// (HyperMD-*) and token classes (cm-*) match the original so themes apply in both modes.
import { RangeSet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { SyntaxNodeRef, SyntaxNode } from "@lezer/common";
import { editorInfoField, editorLivePreviewField } from "./fields";
import { renderMathToString, escapeHtml } from "../markdown/parser";
import { renderEmbed, renderMarkdownInto, decorateCallout, loadMermaid, sanitize } from "../markdown/renderer";
import { Component } from "../api/events";
import { splitAlias, parseLinktext } from "../../core/links";
import { Keymap } from "../commands/keymap";
import { setIcon } from "../dom/icons";
import { TableWidget, tableCursorCapture } from "./table";
import { IMAGE_EXTS } from "../views/simple-views";
import { HIGHLIGHT_COLORS } from "./formatting";

export const refreshLivePreview = StateEffect.define<null>();
/** Show the source of the embed/image starting at this position (the "edit" button). */
export const revealEmbed = StateEffect.define<number | null>();

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
const COLOR_BY_EMOJI = new Map(Object.entries(HIGHLIGHT_COLORS).map(([k, v]) => [v, k]));
const EMOJI_RE = new RegExp("^(" + Object.values(HIGHLIGHT_COLORS).join("|") + ")", "u");
const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

function languageLabel(lang: string): string {
  if (!lang) return "";
  const d = LanguageDescription.matchLanguageName(languages, lang, true);
  return d ? d.name : lang;
}

function editButton(el: HTMLElement, onEdit: (e: MouseEvent) => void): void {
  const actions = el.createDiv("embed-actions");
  const btn = actions.createDiv({ cls: "embed-action edit-block-button", attr: { "aria-label": "Edit this block" } });
  setIcon(btn, "code-xml");
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit(e);
  });
}

function isImageTarget(app: any, link: string, sourcePath: string): boolean {
  const { path } = parseLinktext(link);
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) return false;
  return !!app?.metadataCache?.getFirstLinkpathDest(path, sourcePath);
}

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
  constructor(readonly src: string, readonly display: boolean, readonly from = -1) {
    super();
  }
  eq(o: MathWidget) {
    return o.src === this.src && o.display === this.display && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const el = this.display ? createDiv("math math-block cm-embed-block") : createSpan("math math-inline is-loaded");
    el.innerHTML = renderMathToString(this.src, this.display);
    if (this.display && this.from >= 0) {
      el.setAttr("contenteditable", "false");
      editButton(el, () => {
        view.dispatch({ selection: { anchor: this.from + 2 } });
        view.focus();
      });
    }
    return el;
  }
  ignoreEvent(e: Event) {
    return !this.display || e.type !== "mousedown";
  }
}

class EmbedWidget extends WidgetType {
  private comp = new Component();
  constructor(readonly src: string, readonly alt: string, readonly app: any, readonly sourcePath: string, readonly from: number, readonly block: boolean) {
    super();
  }
  eq(o: EmbedWidget) {
    return o.src === this.src && o.alt === this.alt && o.sourcePath === this.sourcePath && o.from === this.from && o.block === this.block;
  }
  toDOM(view: EditorView) {
    const el = createSpan({ cls: "internal-embed cm-embed-block", attr: { src: this.src, alt: this.alt, contenteditable: "false", tabindex: "-1" } });
    if (this.block) el.addClass("is-block");
    this.comp.load();
    renderEmbed(this.app, el, this.sourcePath, this.comp, 1).then(() => {
      editButton(el, () => {
        view.dispatch({ selection: { anchor: this.from + 3 }, effects: revealEmbed.of(this.from) });
        view.focus();
      });
      el.querySelectorAll("img, video, audio, iframe").forEach((m) => m.addEventListener("load", () => view.requestMeasure()));
      enableImageResize(el, view, this.from);
      view.requestMeasure();
    });
    return el;
  }
  get estimatedHeight() {
    return this.block ? 120 : -1;
  }
  destroy() {
    this.comp.unload();
  }
  ignoreEvent(e: Event) {
    return e.type !== "mousedown" || !!(e.target as HTMLElement).closest?.(".markdown-embed-content, .embed-action, .markdown-embed-link, .image-resize-corner, audio, video, iframe, a");
  }
}

/** Drag the image's bottom-right corner to set its width (writes ![[img|W]] / ![alt|W](src)). */
function enableImageResize(el: HTMLElement, view: EditorView, from: number): void {
  const img = el.querySelector<HTMLImageElement>("img");
  if (!img || !el.hasClass("image-embed")) return;
  let wrap = img.parentElement!;
  if (!wrap.hasClass("image-wrapper")) {
    wrap = createDiv("image-wrapper");
    img.replaceWith(wrap);
    wrap.appendChild(img);
  }
  const corner = wrap.createDiv("image-resize-corner");
  corner.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      img.style.width = Math.max(16, Math.round(startW + ev.clientX - startX)) + "px";
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      const w = Math.max(16, Math.round(startW + ev.clientX - startX));
      const line = view.state.doc.lineAt(from);
      const text = view.state.sliceDoc(from, line.to);
      const wiki = /^!\[\[([^\]|]+)(\|[^\]]*)?\]\]/.exec(text);
      if (wiki) {
        const insert = `![[${wiki[1]}|${w}]]`;
        view.dispatch({ changes: { from, to: from + wiki[0].length, insert } });
        return;
      }
      const md = /^!\[([^\]]*?)(\|\d+(?:x\d+)?)?\]\(/.exec(text);
      if (md) view.dispatch({ changes: { from: from + 2, to: from + 2 + md[1].length + (md[2]?.length ?? 0), insert: `${md[1]}|${w}` } });
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  });
}

class ExternalImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly from: number) {
    super();
  }
  eq(o: ExternalImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const m = this.alt.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
    const s = createSpan({ cls: "image-embed external-embed cm-embed-block", attr: { contenteditable: "false" } });
    const img = s.createEl("img", { attr: { src: this.src, alt: m ? m[1] : this.alt, referrerpolicy: "no-referrer" } });
    if (m) {
      img.setAttr("width", m[2]);
      if (m[3]) img.setAttr("height", m[3]);
    }
    img.addEventListener("load", () => view.requestMeasure());
    enableImageResize(s, view, this.from);
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class RenderedBlockWidget extends WidgetType {
  private comp = new Component();
  constructor(readonly source: string, readonly kind: "callout" | "html", readonly app: any, readonly sourcePath: string, readonly from: number) {
    super();
  }
  eq(o: RenderedBlockWidget) {
    return o.source === this.source && o.kind === this.kind && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const el = createDiv(this.kind === "html" ? "cm-html-embed cm-embed-block" : "cm-embed-block markdown-rendered cm-callout");
    el.setAttr("contenteditable", "false");
    el.setAttr("tabindex", "-1");
    this.comp.load();
    if (this.kind === "html") {
      const tpl = document.createElement("template");
      tpl.innerHTML = this.source;
      sanitize(tpl.content);
      el.appendChild(tpl.content);
    } else {
      renderMarkdownInto(this.app, this.source, el, this.sourcePath, this.comp, { embedDepth: 1 }).then(() => {
        el.querySelectorAll<HTMLElement>(".callout").forEach((c) => decorateCallout(c));
        view.requestMeasure();
      });
    }
    editButton(el, () => {
      view.dispatch({ selection: { anchor: this.from + (this.kind === "callout" ? 2 : 0) } });
      view.focus();
    });
    // Clicking the callout body (not a link/fold) puts the cursor in its source, like the original.
    el.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("a, .callout-fold, .edit-block-button, input, .internal-embed")) return;
      if (this.kind === "callout" && t.closest(".callout-title") && el.querySelector(".callout.is-collapsible")) return;
      e.preventDefault();
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.from;
      view.dispatch({ selection: { anchor: Math.max(this.from, Math.min(pos, this.from + this.source.length)) } });
      view.focus();
    });
    return el;
  }
  get estimatedHeight() {
    return 24 * (this.source.split("\n").length + 1);
  }
  destroy() {
    this.comp.unload();
  }
  ignoreEvent() {
    return true;
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly src: string, readonly from: number) {
    super();
  }
  eq(o: MermaidWidget) {
    return o.src === this.src && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const el = createDiv({ cls: "cm-embed-block mermaid", attr: { contenteditable: "false" } });
    loadMermaid()
      .then((m) => m.render("bedrock-lp-mermaid-" + Math.random().toString(36).slice(2), this.src))
      .then(({ svg }: any) => {
        el.innerHTML = svg;
        editButton(el, () => {
          view.dispatch({ selection: { anchor: this.from + 3 } });
          view.focus();
        });
        view.requestMeasure();
      })
      .catch((e: any) => el.setText(String(e?.message ?? e)));
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class InlineHtmlWidget extends WidgetType {
  constructor(readonly html: string) {
    super();
  }
  eq(o: InlineHtmlWidget) {
    return o.html === this.html;
  }
  toDOM() {
    const s = createSpan({ cls: "cm-html-embed cm-inline-html" });
    const tpl = document.createElement("template");
    tpl.innerHTML = this.html;
    sanitize(tpl.content);
    s.appendChild(tpl.content);
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class CodeFlairWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(o: CodeFlairWidget) {
    return o.label === this.label;
  }
  toDOM() {
    return createSpan({ cls: "code-block-flair", text: this.label, attr: { "aria-label": "Copy" } });
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
const VOID_HTML = /^(br|hr|img|input|wbr)$/i;

/** True when the node is the only thing on its line (an embed that should render as a block). */
function isWholeLine(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from);
  return line.to >= to && !state.sliceDoc(line.from, from).trim() && !state.sliceDoc(to, line.to).trim();
}

/** Embeds/images that are alone on their line render as block widgets (handled by the state field). */
function blockEmbedTarget(state: EditorState, node: SyntaxNode): { link: string; alt: string; md: boolean } | null {
  if (node.name !== "Embed" && node.name !== "Image") return null;
  if (!isWholeLine(state, node.from, node.to)) return null;
  const text = state.sliceDoc(node.from, node.to);
  if (node.name === "Embed") {
    const { link, alias } = splitAlias(text.slice(3, -2));
    return { link, alt: alias ?? "", md: false };
  }
  const mm = text.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?\s*\)$/);
  if (!mm || isExternal(mm[2])) return null;
  let p = mm[2];
  try {
    p = decodeURI(p);
  } catch {
    /* keep */
  }
  return { link: p, alt: mm[1], md: true };
}

interface BlockCtx {
  revealed: number | null;
}

function buildBlockDecorations(state: EditorState, ctx: BlockCtx): DecorationSet {
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
        // Tables are always edited through the table widget (a table that ends the note without a
        // newline stays source, like the original).
        if (to >= state.doc.length) return false;
        const first = state.doc.lineAt(from);
        const last = state.doc.lineAt(to);
        const widget = new TableWidget(state.sliceDoc(from, to), from, app, sourcePath, () => (owner?.tableCellExtensions?.() ?? []));
        decos.push(Decoration.line({ class: `HyperMD-table-2 HyperMD-table-row HyperMD-table-row-${last.number - first.number}` }).range(first.from));
        decos.push(Decoration.replace({}).range(from, to));
        decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(to));
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
        const src = state.sliceDoc(from, to).trim().replace(/^\$\$|\$\$$/g, "");
        if (!lineTouched(state, from, to, focus)) decos.push(Decoration.replace({ widget: new MathWidget(src, true, from), block: true }).range(from, to));
        else decos.push(Decoration.widget({ widget: new MathWidget(src, true, -1), block: true, side: 1 }).range(to));
        return false;
      }
      if (name === "HTMLBlock") {
        if (!lineTouched(state, from, to, focus) && !/^\s*<!--/.test(state.sliceDoc(from, from + 8))) {
          decos.push(Decoration.replace({ widget: new RenderedBlockWidget(state.sliceDoc(from, to), "html", app, sourcePath, from), block: true }).range(from, state.doc.lineAt(to).to));
        }
        return false;
      }
      if (name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        const lang = info ? state.sliceDoc(info.from, info.to).trim() : "";
        if (lang === "mermaid" && app?.vault?.getConfig?.("showMermaid") !== false) {
          const text = node.node.getChild("CodeText");
          const src = text ? state.sliceDoc(text.from, text.to) : "";
          if (!lineTouched(state, from, to, focus)) decos.push(Decoration.replace({ widget: new MermaidWidget(src, from), block: true }).range(from, to));
          else decos.push(Decoration.widget({ widget: new MermaidWidget(src, from), block: true, side: 1 }).range(to));
        }
        return false;
      }
      if (name === "Paragraph") {
        // An embed alone on its line renders as a block.
        let child = node.node.firstChild;
        for (; child; child = child.nextSibling) {
          const t = app ? blockEmbedTarget(state, child) : null;
          if (!t) continue;
          const image = isImageTarget(app, t.link, sourcePath);
          const touched = selectionTouches(state, child.from, child.to, focus);
          const revealed = ctx.revealed === child.from;
          const widget = new EmbedWidget(t.link, t.alt, app, sourcePath, child.from, true);
          const line = state.doc.lineAt(child.from);
          if ((image && !revealed) || (!image && !touched)) decos.push(Decoration.replace({ widget }).range(child.from, child.to));
          else decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
        }
        return false;
      }
      return name === "BulletList" || name === "OrderedList" || name === "ListItem";
    },
  });
  owner?.onFrontmatterHidden?.(headerPlaced);
  return Decoration.set(decos, true);
}

const revealedField = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(revealEmbed)) return e.value;
    if (v === null) return null;
    const mapped = tr.changes.mapPos(v);
    if (tr.selection) {
      const line = tr.newDoc.lineAt(mapped);
      const head = tr.newSelection.main.head;
      if (head < line.from || head > line.to) return null;
    }
    return mapped;
  },
});

export const blockDecorationsField = StateField.define<DecorationSet>({
  create: (s) => buildBlockDecorations(s, { revealed: s.field(revealedField, false) ?? null }),
  update(value, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    const lpChanged = tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
    if (tr.docChanged || tr.selection || treeChanged || lpChanged || tr.effects.some((e) => e.is(refreshLivePreview) || e.is(revealEmbed) || e.is(focusChanged)))
      return buildBlockDecorations(tr.state, { revealed: tr.state.field(revealedField, false) ?? null });
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Dispatched when the editor gains or loses focus so block widgets re-evaluate selection reveal. */
export const focusChanged = StateEffect.define<boolean>();

// ---------- inline decorations (view plugin) ----------
interface InlineResult {
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
}

function quoteDepth(text: string): number {
  const m = /^(\s*>\s?)+/.exec(text);
  return m ? (m[0].match(/>/g) ?? []).length : 0;
}

function buildInline(view: EditorView): InlineResult {
  const state = view.state;
  const lp = state.field(editorLivePreviewField, false) ?? true;
  const owner = state.field(editorInfoField, false);
  const app = owner?.app;
  const sourcePath = owner?.file?.path ?? "";
  const focus = view.hasFocus;
  const tabSize = state.tabSize;
  const decos: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const hideRange = (a: number, b: number) => {
    if (b <= a) return;
    decos.push(hide.range(a, b));
    atomic.push(hide.range(a, b));
  };
  const replaceWith = (a: number, b: number, widget: WidgetType) => {
    const d = Decoration.replace({ widget });
    decos.push(d.range(a, b));
    atomic.push(d.range(a, b));
  };
  const mark = (a: number, b: number, cls: string, attrs?: Record<string, string>) => {
    if (b > a) decos.push(Decoration.mark({ class: cls, attributes: attrs }).range(a, b));
  };
  const lineDeco = (pos: number, cls: string, attrs?: Record<string, string>) => {
    const l = state.doc.lineAt(pos);
    decos.push(Decoration.line({ class: cls, attributes: attrs }).range(l.from));
  };
  const seenQuoteLines = new Set<number>();

  for (const { from: vf, to: vt } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: vf,
      to: vt,
      enter: (node: SyntaxNodeRef) => {
        const { from, to, name } = node;
        const m = name.match(/^ATXHeading(\d)$/);
        if (m) {
          lineDeco(from, `HyperMD-header HyperMD-header-${m[1]}`);
          const marks = node.node.getChildren("HeaderMark");
          for (const hm of marks) mark(hm.from, hm.to, `cm-formatting cm-formatting-header cm-formatting-header-${m[1]} cm-header cm-header-${m[1]}`);
          if (lp && !lineTouched(state, from, to, focus)) {
            const first = marks[0];
            if (first && first.from === from) hideRange(first.from, state.sliceDoc(first.to, first.to + 1) === " " ? first.to + 1 : first.to);
            if (marks.length > 1) hideRange(marks[marks.length - 1].from, marks[marks.length - 1].to);
          }
          return true;
        }
        if (name === "SetextHeading1" || name === "SetextHeading2") {
          const level = name.endsWith("1") ? 1 : 2;
          const last = state.doc.lineAt(to);
          for (let p = from; p <= to; ) {
            const l = state.doc.lineAt(p);
            decos.push(Decoration.line({ class: l.number === last.number ? `HyperMD-header-line HyperMD-header-line-${level}` : `HyperMD-header HyperMD-header-${level}` }).range(l.from));
            p = l.to + 1;
          }
          return true;
        }
        if (name === "Frontmatter") {
          if (!lp)
            for (let p = from; p <= to; ) {
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
            const lang = info ? state.sliceDoc(info.from, info.to).trim() : "";
            const label = languageLabel(lang);
            if (first.length) {
              if (label) replaceWith(first.from, first.to, new CodeFlairWidget(label));
              else hideRange(first.from, first.to);
            }
            if (last.number !== first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text)) hideRange(last.from, last.to);
          }
          return false;
        }
        if (name === "BlockMath") {
          for (let p = from; p <= to; ) {
            const l = state.doc.lineAt(p);
            decos.push(Decoration.line({ class: "HyperMD-math" }).range(l.from));
            p = l.to + 1;
          }
          return false;
        }
        if (name === "Blockquote") {
          for (let p = from; p <= to; ) {
            const l = state.doc.lineAt(p);
            if (!seenQuoteLines.has(l.number)) {
              seenQuoteLines.add(l.number);
              const depth = Math.max(1, quoteDepth(l.text));
              decos.push(Decoration.line({ class: `HyperMD-quote HyperMD-quote-${depth}` }).range(l.from));
            }
            p = l.to + 1;
          }
          return true;
        }
        if (name === "QuoteMark") {
          const depth = quoteDepth(state.doc.lineAt(from).text);
          mark(from, to, `cm-formatting cm-formatting-quote cm-formatting-quote-${depth} cm-quote cm-quote-${depth}`);
          if (lp && !lineTouched(state, from, to, focus)) mark(from, to, "cm-transparent");
          return false;
        }
        if (name === "ListItem") {
          const l = state.doc.lineAt(from);
          let depth = 0;
          for (let p = node.node.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
          if (l.from === from || !state.sliceDoc(l.from, from).replace(/>\s?/g, "").trim()) {
            lineDeco(from, `HyperMD-list-line HyperMD-list-line-${depth}`);
            // Indentation guides: each indent unit becomes a .cm-indent span.
            const ws = /^[ \t]*/.exec(state.sliceDoc(l.from, from))![0];
            if (ws.length) {
              let p = l.from;
              let col = 0;
              let level = 0;
              let unitStart = p;
              for (const ch of ws) {
                col = ch === "\t" ? col + tabSize - (col % tabSize) : col + 1;
                p++;
                if (col % tabSize === 0) {
                  level++;
                  mark(unitStart, p, `cm-hmd-list-indent cm-hmd-list-indent-${level}`);
                  mark(unitStart, p, "cm-indent");
                  unitStart = p;
                }
              }
            }
          }
          const task = node.node.getChild("Task");
          if (task) {
            const marker = task.getChild("TaskMarker");
            if (marker) {
              const ch = state.sliceDoc(marker.from + 1, marker.from + 2);
              decos.push(Decoration.line({ class: "HyperMD-task-line", attributes: { "data-task": ch } }).range(l.from));
              mark(marker.from, marker.to, "cm-formatting cm-formatting-task");
              const listMark = node.node.getChild("ListMark");
              if (lp && !selectionTouches(state, listMark ? listMark.from : marker.from, marker.to, focus)) {
                replaceWith(marker.from, marker.to, new CheckboxWidget(ch !== " ", marker.from));
              }
            }
          }
          return true;
        }
        if (name === "ListMark") {
          const parent = node.node.parent?.parent;
          const isBullet = parent?.name === "BulletList";
          let depth = 0;
          for (let p = node.node.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
          const after = state.sliceDoc(to, to + 1) === " " ? to + 1 : to;
          mark(from, after, `cm-formatting cm-formatting-list ${isBullet ? "cm-formatting-list-ul" : "cm-formatting-list-ol"} cm-list-${depth}`);
          const taskMarker = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
          const revealTo = taskMarker ? taskMarker.to : to;
          if (lp && isBullet) {
            if (!selectionTouches(state, from, revealTo, focus)) {
              if (taskMarker) hideRange(from, Math.min(after, taskMarker.from));
              else mark(from, to, "list-bullet");
            }
          }
          return false;
        }
        if (name === "HorizontalRule") {
          lineDeco(from, "HyperMD-hr");
          if (lp && !lineTouched(state, from, to, focus)) replaceWith(from, to, new HrWidget());
          return false;
        }
        if (name === "FootnoteDefinition") {
          lineDeco(from, "HyperMD-footnote");
          const marks = node.node.getChildren("FootnoteMark");
          const label = node.node.getChild("FootnoteLabel");
          if (label) mark(label.from, label.to, "cm-hmd-footnote cm-link");
          if (lp && marks.length === 2 && !selectionTouches(state, from, marks[1].to, focus)) {
            hideRange(marks[0].from, marks[0].to);
            hideRange(marks[1].from, marks[1].to);
            if (label) mark(label.from, label.to, "cm-underline");
          }
          return true;
        }
        if (name === "FootnoteReference") {
          const marks = node.node.getChildren("FootnoteMark");
          if (marks[0]) mark(marks[0].from, marks[0].to, "cm-formatting cm-formatting-link cm-formatting-link-start");
          if (marks[1]) mark(marks[1].from, marks[1].to, "cm-formatting cm-formatting-link cm-formatting-link-end");
          return false;
        }
        if (name === "Comment") {
          mark(from, Math.min(to, from + 2), "cm-comment-start cm-formatting");
          if (to - from >= 4 && state.sliceDoc(to - 2, to) === "%%") mark(to - 2, to, "cm-comment-end cm-formatting");
          return false;
        }
        if (!lp) {
          if (name === "WikiLink" || name === "Embed") {
            mark(from, to, "", { "data-href": splitAlias(state.sliceDoc(from, to).replace(/^!?\[\[|\]\]$/g, "")).link });
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
          case "InlineCode": {
            const markName = name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
            const fcls = name === "InlineCode" ? "cm-formatting-code" : name === "Strikethrough" ? "cm-formatting-strikethrough" : name === "StrongEmphasis" ? "cm-formatting-strong" : "cm-formatting-em";
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name !== markName || (c.from !== from && c.to !== to)) continue;
              mark(c.from, c.to, "cm-formatting " + fcls);
              if (!touched) hideRange(c.from, c.to);
            }
            if (name === "InlineCode") mark(from, to, "cm-inline-code");
            return true;
          }
          case "Highlight": {
            const marks = node.node.getChildren("HighlightMark");
            const open = marks.find((c) => c.from === from);
            const close = marks.find((c) => c.to === to);
            let contentFrom = open ? open.to : from;
            const em = EMOJI_RE.exec(state.sliceDoc(contentFrom, contentFrom + 4));
            if (em) {
              const color = COLOR_BY_EMOJI.get(em[0]);
              mark(contentFrom + em[0].length, close ? close.from : to, `cm-highlight cm-highlight-${color}`);
              if (!touched) hideRange(contentFrom, contentFrom + em[0].length);
              contentFrom += em[0].length;
            }
            for (const c of [open, close]) if (c && !touched) hideRange(c.from, c.to);
            return true;
          }
          case "Escape": {
            mark(from + 1, to, "cm-escape cm-hmd-escape-char");
            if (!touched) hideRange(from, from + 1);
            return false;
          }
          case "WikiLink": {
            const inner = state.sliceDoc(from + 2, to - 2);
            const { link, alias } = splitAlias(inner);
            const unresolved = !!app && !!parseLinktext(link).path && !app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, sourcePath);
            const textFrom = alias !== undefined ? to - 2 - alias.length : from + 2;
            const attrs = { "data-href": link };
            if (touched) {
              mark(from, from + 2, "cm-formatting-link cm-formatting-link-start");
              mark(to - 2, to, "cm-formatting-link cm-formatting-link-end");
              if (alias !== undefined) {
                mark(from + 2, textFrom - 1, "cm-hmd-internal-link cm-link-has-alias");
                mark(textFrom - 1, textFrom, "cm-hmd-internal-link cm-link-alias-pipe");
                mark(textFrom, to - 2, "cm-hmd-internal-link cm-link-alias");
              }
              return false;
            }
            hideRange(from, textFrom);
            hideRange(to - 2, to);
            mark(textFrom, to - 2, "cm-hmd-internal-link" + (alias !== undefined ? " cm-link-alias" : ""));
            mark(textFrom, to - 2, "cm-underline" + (unresolved ? " is-unresolved" : ""), attrs);
            return false;
          }
          case "Embed": {
            if (blockEmbedTarget(state, node.node)) return false;
            const inner = state.sliceDoc(from + 3, to - 2);
            const { link, alias } = splitAlias(inner);
            if (!app) return false;
            const widget = new EmbedWidget(link, alias ?? "", app, sourcePath, from, false);
            if (isImageTarget(app, link, sourcePath) || !touched) replaceWith(from, to, widget);
            else decos.push(Decoration.widget({ widget, side: 1 }).range(to));
            return false;
          }
          case "Link": {
            const marks = node.node.getChildren("LinkMark");
            const url = node.node.getChild("URL");
            if (marks.length < 2 || !url) return true;
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            let href = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
            const external = isExternal(href);
            if (!external)
              try {
                href = decodeURI(href);
              } catch {
                /* keep */
              }
            if (touched) {
              mark(url.from, url.to, "cm-string cm-url");
              return true;
            }
            hideRange(from, textFrom);
            hideRange(textTo, to);
            mark(textFrom, textTo, external ? "cm-link external-link" : "cm-hmd-internal-link");
            mark(textFrom, textTo, "cm-underline", { "data-href": href });
            return true;
          }
          case "Image": {
            if (blockEmbedTarget(state, node.node)) return false;
            const text = state.sliceDoc(from, to);
            const mm = text.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)$/);
            if (!mm || !app) return false;
            const src = mm[2];
            if (isExternal(src) && !/^file:/i.test(src)) replaceWith(from, to, new ExternalImageWidget(src, mm[1], from));
            else {
              let p = src;
              try {
                p = decodeURI(src);
              } catch {
                /* keep */
              }
              const widget = new EmbedWidget(p, mm[1], app, sourcePath, from, false);
              if (isImageTarget(app, p, sourcePath) || !touched) replaceWith(from, to, widget);
              else decos.push(Decoration.widget({ widget, side: 1 }).range(to));
            }
            return false;
          }
          case "Autolink": {
            const url = node.node.getChild("URL");
            if (url) {
              mark(url.from, url.to, "cm-url cm-link external-link");
              if (!touched) {
                hideRange(from, url.from);
                hideRange(url.to, to);
                mark(url.from, url.to, "cm-underline", { "data-href": state.sliceDoc(url.from, url.to) });
              }
            }
            return false;
          }
          case "URL": {
            if (node.node.parent?.name === "Paragraph" || node.node.parent?.name === "ListItem") {
              mark(from, to, "cm-url cm-link external-link");
              if (!touched) mark(from, to, "cm-underline", { "data-href": state.sliceDoc(from, to) });
            }
            return false;
          }
          case "InlineMath": {
            if (touched) {
              mark(from, to, "cm-math");
              return false;
            }
            const src = state.sliceDoc(from, to);
            const display = src.startsWith("$$");
            replaceWith(from, to, new MathWidget(display ? src.slice(2, -2) : src.slice(1, -1), display));
            return false;
          }
          case "HTMLTag": {
            const tagText = state.sliceDoc(from, to);
            const open = /^<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>$/.exec(tagText);
            if (!open) return false;
            const tag = open[1];
            if (open[2] === "/" || VOID_HTML.test(tag)) {
              if (!touched) replaceWith(from, to, new InlineHtmlWidget(tagText));
              return false;
            }
            // Find the matching closing tag among the following siblings.
            let depth = 0;
            for (let s = node.node.nextSibling; s; s = s.nextSibling) {
              if (s.name !== "HTMLTag") continue;
              const t = state.sliceDoc(s.from, s.to);
              if (new RegExp(`^<${tag}\\b`, "i").test(t)) depth++;
              else if (new RegExp(`^</${tag}\\s*>$`, "i").test(t)) {
                if (depth === 0) {
                  if (!selectionTouches(state, from, s.to, focus) && state.doc.lineAt(from).number === state.doc.lineAt(s.to).number) replaceWith(from, s.to, new InlineHtmlWidget(state.sliceDoc(from, s.to)));
                  break;
                }
                depth--;
              }
            }
            return false;
          }
        }
        return true;
      },
    });
  }
  return { decorations: Decoration.set(decos, true), atomic: RangeSet.of(atomic, true) };
}

export const inlineLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: RangeSet<Decoration>;
    mouseDown = false;
    dirty = false;
    private onUp = () => {
      if (!this.mouseDown) return;
      this.mouseDown = false;
      if (this.dirty) {
        this.dirty = false;
        // Rebuild after the click has settled the selection.
        requestAnimationFrame(() => this.view.dispatch({ effects: refreshLivePreview.of(null) }));
      }
    };
    constructor(readonly view: EditorView) {
      const r = buildInline(view);
      this.decorations = r.decorations;
      this.atomic = r.atomic;
      view.dom.ownerDocument.addEventListener("mouseup", this.onUp, true);
    }
    update(u: ViewUpdate) {
      const lpChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
      const forced = u.transactions.some((t) => t.effects.some((e) => e.is(refreshLivePreview)));
      const relevant = u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || lpChanged || forced || syntaxTree(u.startState) !== syntaxTree(u.state);
      if (!relevant) return;
      // While the mouse is down (drag-selecting) or during IME composition, only map.
      if (!forced && !lpChanged && (this.mouseDown || u.view.composing) && !u.viewportChanged) {
        this.decorations = this.decorations.map(u.changes);
        this.atomic = this.atomic.map(u.changes);
        this.dirty = true;
        return;
      }
      const r = buildInline(u.view);
      this.decorations = r.decorations;
      this.atomic = r.atomic;
    }
    destroy() {
      this.view.dom.ownerDocument.removeEventListener("mouseup", this.onUp, true);
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? RangeSet.empty),
    eventHandlers: {
      mousedown(e: MouseEvent, view: EditorView) {
        const t = e.target as HTMLElement;
        const lp = view.state.field(editorLivePreviewField, false);
        const owner = view.state.field(editorInfoField, false);
        const linkEl = t.closest<HTMLElement>("[data-href]");
        if (e.button === 0 && linkEl && owner?.app) {
          const rendered = !!t.closest(".cm-underline");
          // Live preview: a click on a rendered link opens it. Source mode: Mod+click opens.
          if ((lp && rendered) || Keymap.isModifier(e, "Mod")) {
            e.preventDefault();
            const href = linkEl.getAttribute("data-href")!;
            if (isExternal(href)) owner.app.openExternal?.(href) ?? window.open(href);
            else owner.app.workspace.openLinkText(href, owner.file?.path ?? "", Keymap.isModEvent(e) || false);
            return true;
          }
        }
        if (e.button === 0) {
          (this as any).mouseDown = true;
        }
        return false;
      },
      compositionend(_e: Event, view: EditorView) {
        view.dispatch({ effects: refreshLivePreview.of(null) });
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
              b.add(n.from, n.from + 1, Decoration.mark({ class: "cm-formatting cm-formatting-hashtag cm-hashtag cm-hashtag-begin cm-meta", attributes: { "data-tag": tag } }));
              b.add(n.from + 1, n.to, Decoration.mark({ class: "cm-hashtag cm-hashtag-end cm-meta", attributes: { "data-tag": tag } }));
            }
          },
        });
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/** Re-evaluate block widgets when focus changes (selection only reveals while focused). */
const focusWatcher = EditorView.focusChangeEffect.of((_state, focusing) => focusChanged.of(focusing));

export function livePreviewExtensions(): Extension[] {
  return [revealedField, blockDecorationsField, inlineLivePreview, hashtagDecorations, focusWatcher, tableCursorCapture];
}

/** Extensions for the small editors inside table cells (inline live preview only). */
export function cellLivePreviewExtensions(): Extension[] {
  return [inlineLivePreview, hashtagDecorations];
}

export { escapeHtml };
