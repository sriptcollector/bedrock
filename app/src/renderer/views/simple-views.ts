// Small built-in views: the empty "New tab" page and viewers for images, audio, video and PDF.
import { ItemView, FileView } from "../workspace/view";
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
    this.contentEl.addClass("empty-state");
    const box = this.contentEl.createDiv("empty-state-container");
    box.createDiv({ cls: "empty-state-title", text: "No file is open" });
    const actions = box.createDiv("empty-state-action-list");
    const action = (text: string, hotkeyCmd: string, cb: () => any) => {
      const a = actions.createDiv({ cls: "empty-state-action tappable", text });
      const hk = this.app.hotkeyManager.printHotkeyForCommand(hotkeyCmd);
      if (hk) a.appendText(` (${hk})`);
      a.addEventListener("click", cb);
    };
    action("Create new note", "file-explorer:new-file", () => this.app.commands.executeCommandById("file-explorer:new-file"));
    action("Go to file", "switcher:open", () => this.app.commands.executeCommandById("switcher:open"));
    action("See recent files", "switcher:open", () => this.app.commands.executeCommandById("switcher:open"));
    action("Close", "workspace:close", () => this.leaf.detach());
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
