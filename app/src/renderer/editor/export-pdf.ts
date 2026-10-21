// "Export to PDF": the settings modal (include file name, page size, landscape, margin, downscale)
// and the export itself — the note is rendered in full into a .print container, the window is
// printed to PDF by the main process, then the container is removed. Settings are remembered in
// app.json as pdfExportSettings.
import { Modal } from "../ui/modal";
import { Setting } from "../ui/setting";
import { Notice } from "../ui/notice";
import { Component } from "../api/events";
import { renderMarkdownInto } from "../markdown/renderer";
import { getFrontMatterInfo, parseYaml } from "../../core/parse";
import { EDITOR_IPC } from "../../shared/editor-ipc";

export interface PdfExportSettings {
  includeName: boolean;
  pageSize: string;
  landscape: boolean;
  margin: string;
  downscalePercent: number;
}

const DEFAULTS: PdfExportSettings = { includeName: false, pageSize: "Letter", landscape: false, margin: "0", downscalePercent: 100 };

function load(app: any): PdfExportSettings {
  const s = app.vault.getConfig("pdfExportSettings") ?? {};
  return { ...DEFAULTS, ...s };
}

export class ExportPdfModal extends Modal {
  constructor(app: any, private file: any, private text: string) {
    super(app);
  }
  onOpen(): void {
    const s = load(this.app);
    this.setTitle("Export to PDF");
    this.modalEl.addClass("mod-pdf-export");
    const c = this.contentEl;
    c.createEl("p", { text: `Export “${this.file.basename}” to PDF with the settings below.` });
    new Setting(c).setName("Include file name as title").addToggle((t) => t.setValue(s.includeName).onChange((v) => (s.includeName = v)));
    new Setting(c).setName("Page size").addDropdown((d) =>
      d
        .addOptions({ A3: "A3", A4: "A4", A5: "A5", Legal: "Legal", Letter: "Letter", Tabloid: "Tabloid" })
        .setValue(s.pageSize)
        .onChange((v) => (s.pageSize = v)),
    );
    new Setting(c).setName("Landscape").addToggle((t) => t.setValue(s.landscape).onChange((v) => (s.landscape = v)));
    new Setting(c).setName("Margin").addDropdown((d) =>
      d
        .addOption("0", "Default")
        .addOption("2", "Minimal")
        .addOption("1", "None")
        .setValue(s.margin)
        .onChange((v) => (s.margin = v)),
    );
    new Setting(c).setName("Downscale percent").addSlider((sl) =>
      sl
        .setLimits(10, 100, 1)
        .setValue(s.downscalePercent)
        .setDynamicTooltip()
        .onChange((v) => (s.downscalePercent = v)),
    );
    const buttons = c.createDiv("modal-button-container");
    const go = buttons.createEl("button", { cls: "mod-cta", text: "Export to PDF" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    go.addEventListener("click", async () => {
      const { includeName, ...rest } = s;
      this.app.vault.setConfig("pdfExportSettings", { ...rest, includeName });
      this.close();
      await exportToPdf(this.app, this.file, this.text, s);
    });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export async function exportToPdf(app: any, file: any, text: string, s: PdfExportSettings): Promise<string | null> {
  const native = (window as any).bedrockNative;
  if (!native?.invoke) {
    new Notice("Export to PDF isn't available in this window.");
    return null;
  }
  const filePath: string | null = await native.invoke(EDITOR_IPC.pickPdfPath, file.basename + ".pdf");
  if (!filePath) return null;
  const notice = new Notice("Exporting to PDF…", 0);
  const comp = new Component();
  comp.load();
  const print = document.body.createDiv("print");
  try {
    const view = print.createDiv("markdown-preview-view markdown-rendered");
    if (s.includeName) view.createEl("h1", { cls: "print-title", text: file.basename });
    const fm = getFrontMatterInfo(text);
    const body = fm.exists ? text.slice(fm.contentStart) : text;
    let frontmatter: any = null;
    try {
      frontmatter = fm.exists ? parseYaml(fm.frontmatter) : null;
    } catch {
      /* ignore */
    }
    const sizer = view.createDiv("markdown-preview-sizer markdown-preview-section");
    await renderMarkdownInto(app, body, sizer, file.path, comp, { embedDepth: 0, frontmatter, sourceText: text });
    // Wait for images to load (or fail) before printing.
    await Promise.all(Array.from(print.querySelectorAll("img")).map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
    document.body.addClass("is-printing");
    await native.invoke(EDITOR_IPC.printToPdf, { filePath, pageSize: s.pageSize, landscape: s.landscape, margin: s.margin, scale: s.downscalePercent, defaultPath: filePath });
    notice.hide();
    new Notice(`Exported to ${filePath}`);
    return filePath;
  } catch (e: any) {
    notice.hide();
    new Notice(`Couldn't export to PDF: ${e?.message ?? e}`);
    return null;
  } finally {
    document.body.removeClass("is-printing");
    print.remove();
    comp.unload();
  }
}
