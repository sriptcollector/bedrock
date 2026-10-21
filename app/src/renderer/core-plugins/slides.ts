// Slides core plugin ("slides"): present the active note full screen, one slide per part between
// horizontal rules (a line with just ---). Arrow keys / Space / Page keys move, Home/End jump,
// Esc closes. The presentation covers the window (not OS full screen, like the original). Slides are laid out on a 960x700 stage scaled to the window, centred.
import { Component } from "../api/events";
import { setIcon } from "../dom/icons";
import { MarkdownRenderer } from "../markdown/renderer";
import { Notice } from "../ui/notice";
import type { CorePluginImpl } from "./manager";

const STAGE_W = 960;
const STAGE_H = 700;
const MARGIN = 0.08;

/** Split a note into slide sources at `---` lines outside code fences (frontmatter removed). */
export function splitSlides(text: string): string[] {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    if (!fence && /^\s*---\s*$/.test(line)) {
      out.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  out.push(cur.join("\n"));
  return out.filter((s, i, a) => s.trim() || a.length === 1);
}

export class SlidesPresentation extends Component {
  containerEl: HTMLElement;
  private stageEl: HTMLElement;
  private slideEls: HTMLElement[] = [];
  private progressEl: HTMLElement;
  private prevBtn: HTMLElement;
  private nextBtn: HTMLElement;
  index = 0;

  constructor(private app: any, private sources: string[], private sourcePath: string) {
    super();
    this.containerEl = createDiv("slides-container");
    const reveal = this.containerEl.createDiv("reveal slide center");
    this.stageEl = reveal.createDiv("slides");
    const close = reveal.createDiv({ cls: "slides-close-btn", attr: { "aria-label": "Close presentation" } });
    setIcon(close, "x-square");
    close.addEventListener("click", () => this.close());
    const controls = reveal.createEl("aside", "controls");
    this.prevBtn = controls.createEl("button", { cls: "navigate-left", attr: { "aria-label": "previous slide" } });
    this.prevBtn.createDiv("controls-arrow");
    this.nextBtn = controls.createEl("button", { cls: "navigate-right", attr: { "aria-label": "next slide" } });
    this.nextBtn.createDiv("controls-arrow");
    this.prevBtn.addEventListener("click", () => this.go(this.index - 1));
    this.nextBtn.addEventListener("click", () => this.go(this.index + 1));
    this.progressEl = reveal.createDiv("progress").createSpan();
  }

  async open(): Promise<void> {
    document.body.appendChild(this.containerEl);
    this.load();
    for (const src of this.sources) {
      const s = this.stageEl.createEl("section");
      await MarkdownRenderer.render(this.app, src, s, this.sourcePath, this);
      this.slideEls.push(s);
    }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      let handled = true;
      if (k === "Escape") this.close();
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "n", "l", "j"].includes(k)) this.go(this.index + 1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "h", "k"].includes(k)) this.go(this.index - 1);
      else if (k === "Home") this.go(0);
      else if (k === "End") this.go(this.slideEls.length - 1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    this.register(() => document.removeEventListener("keydown", onKey, true));
    const onResize = () => this.layout();
    window.addEventListener("resize", onResize);
    this.register(() => window.removeEventListener("resize", onResize));
    this.layout();
    this.go(0);
  }

  private layout(): void {
    const w = this.containerEl.clientWidth || window.innerWidth;
    const h = this.containerEl.clientHeight || window.innerHeight;
    const scale = Math.min(w / (STAGE_W * (1 + MARGIN)), h / (STAGE_H * (1 + MARGIN * 1.2)));
    this.stageEl.style.width = STAGE_W + "px";
    this.stageEl.style.height = STAGE_H + "px";
    this.stageEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  go(i: number): void {
    const n = this.slideEls.length;
    if (!n) return;
    this.index = Math.max(0, Math.min(n - 1, i));
    this.slideEls.forEach((s, j) => {
      s.toggleClass("past", j < this.index);
      s.toggleClass("present", j === this.index);
      s.toggleClass("future", j > this.index);
      s.toggleAttribute("hidden", Math.abs(j - this.index) > 1);
    });
    this.prevBtn.toggleClass("enabled", this.index > 0);
    this.nextBtn.toggleClass("enabled", this.index < n - 1);
    this.progressEl.style.transform = `scaleX(${n > 1 ? this.index / (n - 1) : 1})`;
  }

  close(): void {
    this.containerEl.remove();
    this.unload();
  }
}

export const slidesPlugin: CorePluginImpl = {
  id: "slides",
  onEnable(p) {
    const app = p.app;
    const start = async () => {
      const file = app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return;
      const text = app.workspace.activeEditor?.file === file && app.workspace.activeEditor.editor ? app.workspace.activeEditor.editor.getValue() : await app.vault.cachedRead(file);
      const slides = splitSlides(text);
      if (!slides.length) return new Notice("This note is empty.");
      await new SlidesPresentation(app, slides, file.path).open();
    };
    p.addCommand({
      id: "slides:start",
      name: "Slides: Start presentation",
      icon: "monitor",
      checkCallback: (checking: boolean) => {
        const f = app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void start();
        return true;
      },
    });
  },
};
