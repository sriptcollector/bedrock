// "Export to PDF...": options modal (file name as title, page size, landscape, margin, downscale),
// then the note is rendered into a print-only container and the main process prints the window
// to PDF (only that container is visible in print). Options persist in app.json pdfExportSettings.
import { ipcRenderer } from "electron";
import { SHELL_IPC, type PdfOptions } from "../../shared/ipc-shell";
import { Modal } from "../ui/modal";
import { Setting } from "../ui/setting";
import { Notice } from "../ui/notice";
import { Component } from "../api/events";
import { MarkdownRenderer } from "../markdown/renderer";

export const PDF_DEFAULTS: PdfOptions & { includeName: boolean } = { includeName: true, pageSize: "Letter", landscape: false, margin: "0", downscalePercent: 100 };

const PRINT_CSS = `
.print { display: none; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: white !important; }
  body > *:not(.print) { display: none !important; }
  .print { display: block !important; color: black; }
  .print .markdown-preview-view { padding: 0; overflow: visible; height: auto; }
  .print .inline-title { font-size: 2em; font-weight: 700; margin-bottom: 0.5em; }
  .print pre, .print blockquote, .print table, .print img { break-inside: avoid; }
}`;

function ensurePrintCss(): void {
  if (document.getElementById("bedrock-print-css")) return;
  const s = document.head.createEl("style", { attr: { id: "bedrock-print-css" } });
  s.textContent = PRINT_CSS;
}

class PdfModal extends Modal {
  constructor(app: any, private onExport: (o: typeof PDF_DEFAULTS) => void) {
    super(app);
    this.setTitle("Export to PDF");
    const saved = app.vault.getConfig("pdfExportSettings") ?? {};
    const o = { ...PDF_DEFAULTS, ...saved };
    new Setting(this.contentEl).setName("Include file name as title").addToggle((t) => t.setValue(o.includeName).onChange((v) => (o.includeName = v)));
    new Setting(this.contentEl).setName("Page size").addDropdown((d) => {
      for (const s of ["A3", "A4", "A5", "Legal", "Letter", "Tabloid"]) d.addOption(s, s);
      d.setValue(o.pageSize).onChange((v) => (o.pageSize = v));
    });
    new Setting(this.contentEl).setName("Landscape").addToggle((t) => t.setValue(o.landscape).onChange((v) => (o.landscape = v)));
    new Setting(this.contentEl).setName("Margin").addDropdown((d) =>
      d
        .addOption("0", "Default")
        .addOption("1", "None")
        .addOption("2", "Small")
        .setValue(String(o.margin))
        .onChange((v) => (o.margin = v)),
    );
    new Setting(this.contentEl)
      .setName("Downscale percent")
      .addSlider((s) =>
        s
          .setLimits(10, 100, 1)
          .setValue(o.downscalePercent)
          .setDynamicTooltip()
          .onChange((v) => (o.downscalePercent = v)),
      );
    const btns = this.modalEl.createDiv("modal-button-container");
    btns.createEl("button", { cls: "mod-cta", text: "Export to PDF" }).addEventListener("click", () => {
      const { includeName, ...rest } = o;
      const store: any = { ...rest };
      if (!includeName) store.includeName = false;
      app.vault.setConfig("pdfExportSettings", JSON.stringify(store) === JSON.stringify({ pageSize: "Letter", landscape: false, margin: "0", downscalePercent: 100 }) ? undefined : store);
      this.close();
      this.onExport(o);
    });
  }
}

/** Render the note into .print and print it (exposed for tests: returns the saved path). */
export async function renderAndPrint(app: any, view: any, o: typeof PDF_DEFAULTS): Promise<string | null> {
  ensurePrintCss();
  const file = view.file;
  const comp = new Component();
  comp.load();
  const root = document.body.createDiv("print");
  try {
    const pv = root.createDiv("markdown-preview-view markdown-rendered");
    if (o.includeName) pv.createDiv({ cls: "inline-title", text: file.basename });
    const text: string = view.editor?.getValue?.() ?? (await app.vault.cachedRead(file));
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    await MarkdownRenderer.render(app, body, pv.createDiv(), file.path, comp);
    await new Promise((r) => setTimeout(r, 300)); // images and embeds settle
    return await ipcRenderer.invoke(SHELL_IPC.printPdf, file.basename, { pageSize: o.pageSize, landscape: o.landscape, margin: String(o.margin), downscalePercent: o.downscalePercent });
  } finally {
    root.remove();
    comp.unload();
  }
}

export async function exportToPdf(app: any, view: any): Promise<void> {
  new PdfModal(app, async (o) => {
    try {
      const out = await renderAndPrint(app, view, o);
      if (out) new Notice(`Exported to ${out}`);
    } catch (e: any) {
      new Notice(`Couldn't export the PDF: ${e?.message ?? e}`);
    }
  }).open();
}
