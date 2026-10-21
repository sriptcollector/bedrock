// Small built-in views: the empty "New tab" page and viewers for images, audio, video and PDF.
import { ItemView, FileView } from "../workspace/view";
import { setIcon } from "../dom/icons";
import type { WorkspaceLeaf } from "../workspace/leaf";
import type { TFile } from "../vault/files";

export class EmptyView extends ItemView {
  navigation = true;
  icon = "file";
  getViewType(): string {
    return "empty";
  }
  getDisplayText(): string {
    return "New tab";
  }
  protected async onOpen(): Promise<void> {
    this.render();
    // Actions depend on which core plugins are on (Bases, Canvas, Web viewer) and on the hotkeys.
    const ip = this.app.internalPlugins;
    const onChange = () => this.render();
    ip?.on?.("change", onChange);
    this.register(() => ip?.off?.("change", onChange));
  }

  /** The empty new tab: pill buttons for New note, New base, New canvas, Go to file, Web viewer. */
  render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("empty-state");
    const box = c.createDiv("empty-state-container");
    box.createDiv({ cls: "empty-state-title" });
    const actions = box.createDiv("empty-state-action-list");
    const cmds = this.app.commands;
    const action = (label: string, icon: string, cmdId: string) => {
      if (!cmds.findCommand(cmdId)) return;
      const a = actions.createDiv({ cls: "text-icon-button tappable mod-pill empty-state-action", attr: { role: "button", tabindex: "0", "aria-label": label } });
      setIcon(a.createSpan("text-button-icon"), icon);
      a.createSpan({ cls: "text-button-label", text: label });
      const hk = this.app.hotkeyManager.printHotkeyForCommand(cmdId);
      if (hk) a.createSpan({ cls: "empty-state-hotkey", text: " " + hk });
      const run = () => cmds.executeCommandById(cmdId);
      a.addEventListener("click", run);
      a.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          run();
        }
      });
    };
    action("New note", "square-pen", "file-explorer:new-file");
    action("New base", "layout-list", "bases:new-file");
    action("New canvas", "layout-dashboard", "canvas:new-file");
    if (this.app.vault.getFiles().length) action("Go to file", "search", "switcher:open");
    action("Open web viewer", "globe-2", "webviewer:open");
  }
}

abstract class MediaView extends FileView {
  protected async onLoadFileMedia(file: TFile, make: (src: string) => HTMLElement): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("bedrock-media-view");
    const el = make(this.app.vault.getResourcePath(file));
    this.contentEl.appendChild(el);
  }
  async onUnloadFile(): Promise<void> {
    this.contentEl.empty();
  }
}

export class ImageView extends MediaView {
  icon = "image";
  getViewType(): string {
    return "image";
  }
  canAcceptExtension(ext: string): boolean {
    return IMAGE_EXTS.includes(ext);
  }
  async onLoadFile(file: TFile): Promise<void> {
    await this.onLoadFileMedia(file, (src) => {
      const wrap = createDiv("image-container");
      wrap.createEl("img", { attr: { src, alt: file.name } });
      return wrap;
    });
  }
}

export class AudioView extends MediaView {
  icon = "file-audio";
  getViewType(): string {
    return "audio";
  }
  async onLoadFile(file: TFile): Promise<void> {
    await this.onLoadFileMedia(file, (src) => createEl("audio", { attr: { src, controls: true } }));
  }
}

export class VideoView extends MediaView {
  icon = "file-video";
  getViewType(): string {
    return "video";
  }
  async onLoadFile(file: TFile): Promise<void> {
    await this.onLoadFileMedia(file, (src) => createEl("video", { attr: { src, controls: true } }));
  }
}

export class PdfView extends MediaView {
  icon = "file-text";
  getViewType(): string {
    return "pdf";
  }
  async onLoadFile(file: TFile): Promise<void> {
    // Chromium's built-in PDF viewer (pdf.js integration can replace this later).
    await this.onLoadFileMedia(file, (src) => createEl("embed", { attr: { src: src.split("?")[0], type: "application/pdf", style: "width:100%;height:100%" } }));
  }
}

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"];
export const AUDIO_EXTS = ["mp3", "wav", "m4a", "3gp", "flac", "ogg", "oga", "opus", "webm"];
export const VIDEO_EXTS = ["mp4", "ogv", "mov", "mkv"];

export function registerSimpleViews(app: any): void {
  const r = app.viewRegistry;
  r.registerView("empty", (leaf: WorkspaceLeaf) => new EmptyView(leaf));
  r.registerView("image", (leaf: WorkspaceLeaf) => new ImageView(leaf));
  r.registerView("audio", (leaf: WorkspaceLeaf) => new AudioView(leaf));
  r.registerView("video", (leaf: WorkspaceLeaf) => new VideoView(leaf));
  r.registerView("pdf", (leaf: WorkspaceLeaf) => new PdfView(leaf));
  r.registerExtensions(IMAGE_EXTS, "image");
  r.registerExtensions(AUDIO_EXTS, "audio");
  r.registerExtensions(VIDEO_EXTS, "video");
  r.registerExtensions(["pdf"], "pdf");
}
