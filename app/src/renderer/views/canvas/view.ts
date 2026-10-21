// Canvas view (`canvas`, .canvas files): a TextFileView around the Canvas controller. Also registers
// the canvas commands, the Canvas settings tab, canvas.json options and the link indexer that lets
// canvases feed the graph and backlinks.
import { TextFileView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import type { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { FuzzySuggestModal } from "../../ui/modal";
import { SettingTab, Setting } from "../../ui/setting";
import { Canvas, type CanvasOptions } from "./canvas";
import { parseCanvas, serializeCanvas, type CanvasData } from "./format";
import { CanvasLinkIndexer } from "./links";
import { TextNode } from "./nodes";
import { installCanvasStyles } from "./styles";
import { embedRenderers } from "../../markdown/renderer";
import { setIcon } from "../../dom/icons";

const DEFAULT_OPTIONS: CanvasOptions = { snapToObjects: true, snapToGrid: true };

/** canvas.json (Obsidian's file for the Canvas core plugin's options). */
export class CanvasPluginState {
  options: CanvasOptions = { ...DEFAULT_OPTIONS };
  private loaded = false;
  indexer: CanvasLinkIndexer;
  constructor(public app: any) {
    this.indexer = new CanvasLinkIndexer(app);
  }
  get path(): string {
    return `${this.app.vault.configDir}/canvas.json`;
  }
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (await this.app.vault.adapter.exists(this.path)) {
        const raw = JSON.parse(await this.app.vault.adapter.read(this.path));
        if (raw && typeof raw === "object") this.options = { ...DEFAULT_OPTIONS, ...raw };
      }
    } catch {
      /* keep defaults */
    }
  }
  save(): void {
    this.app.vault.adapter.write(this.path, JSON.stringify(this.options, null, 2)).catch((e: any) => console.error("[canvas] could not save canvas.json", e));
    this.app.workspace.iterateAllLeaves((l: any) => l.view instanceof CanvasView && l.view.canvas?.applyOptions());
  }
}

let pluginState: CanvasPluginState | null = null;

export class CanvasView extends TextFileView {
  canvas: Canvas | null = null;
  icon = "layout-dashboard";
  private pendingViewState: { x: number; y: number; zoom: number } | null = null;
  private loadFailed = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    installCanvasStyles();
  }

  get plugin(): CanvasPluginState {
    return pluginState!;
  }

  getViewType(): string {
    return "canvas";
  }

  canAcceptExtension(ext: string): boolean {
    return ext === "canvas";
  }

  protected async onOpen(): Promise<void> {
    this.contentEl.empty();
    const view = this;
    this.canvas = new Canvas(
      {
        app: this.app,
        get file() {
          return view.file;
        },
        get options() {
          return view.plugin.options;
        },
        saveOptions: () => this.plugin.save(),
        requestSave: () => {
          if (!this.loadFailed) this.requestSave();
        },
        onReadonlyChange: (ro) => this.saveLocal({ readonly: ro }),
      },
      this.contentEl,
    );
    this.registerDomEvent(document, "copy", (e: ClipboardEvent) => this.isActive() && this.canvas?.handleCopy(e));
    this.registerDomEvent(document, "cut", (e: ClipboardEvent) => this.isActive() && this.canvas?.handleCopy(e, true));
    this.registerDomEvent(document, "paste", (e: ClipboardEvent) => this.isActive() && this.canvas?.handlePaste(e));
    this.registerEvent(
      this.app.vault.on("modify", (f: any) => {
        if (f !== this.file) this.canvas?.onFileModified(f);
      }),
    );
    this.registerEvent(this.app.vault.on("rename", (f: any, old: string) => this.canvas?.onFileRenamed(f, old)));
  }

  private isActive(): boolean {
    return this.app.workspace.activeLeaf === this.leaf;
  }

  getViewData(): string {
    if (!this.canvas) return this.data;
    return serializeCanvas(this.canvas.getData());
  }

  setViewData(data: string, clear: boolean): void {
    if (!this.canvas) return;
    let parsed: CanvasData;
    try {
      parsed = parseCanvas(data);
      this.loadFailed = false;
    } catch (e: any) {
      this.loadFailed = true;
      new Notice(`This canvas file can't be read (${e?.message ?? e}). It's shown empty and won't be saved, so the file stays as it is.`);
      parsed = { nodes: [], edges: [] };
    }
    const c = this.canvas;
    c.setData(parsed, !clear);
    if (clear) {
      const local = this.loadLocal();
      c.setReadonly(this.loadFailed || !!local.readonly);
      if (this.pendingViewState) {
        const v = this.pendingViewState;
        this.pendingViewState = null;
        c.zoomToFitQueued = false;
        c.setViewport(v.x, v.y, v.zoom);
      } else if (c.width && c.height) c.zoomToFit(true);
      else c.zoomToFitQueued = true;
      c.resetHistory();
    } else c.pushHistory();
  }

  clear(): void {
    this.canvas?.setData({ nodes: [], edges: [] }, false);
  }

  getState(): Record<string, any> {
    const st: Record<string, any> = super.getState();
    const c = this.canvas;
    if (c && this.file) st.viewState = { x: c.tx, y: c.ty, zoom: c.tZoom };
    return st;
  }

  async setState(state: any, result: { history: boolean }): Promise<void> {
    const v = state?.viewState;
    if (v && typeof v.x === "number" && typeof v.y === "number" && typeof v.zoom === "number") this.pendingViewState = { x: v.x, y: v.y, zoom: v.zoom };
    await super.setState(state, result);
    if (this.pendingViewState && this.canvas && this.file && state?.file === this.file.path) {
      const p = this.pendingViewState;
      this.pendingViewState = null;
      this.canvas.zoomToFitQueued = false;
      this.canvas.setViewport(p.x, p.y, p.zoom);
    }
  }

  setEphemeralState(s: any): void {
    if (s?.focus) this.canvas?.wrapperEl.focus({ preventScroll: true });
  }

  focus(): void {
    this.canvas?.wrapperEl.focus({ preventScroll: true });
  }

  onResize(): void {
    this.canvas?.onResize();
  }

  onPaneMenu(menu: Menu, source: string): void {
    const c = this.canvas;
    if (c) {
      menu.addItem((i: any) =>
        i
          .setTitle("Read-only")
          .setIcon("lock")
          .setChecked(c.readonly)
          .setSection("view")
          .onClick(() => c.setReadonly(!c.readonly)),
      );
      menu.addItem((i: any) =>
        i
          .setTitle("Jump to group")
          .setIcon("lucide-layout-dashboard")
          .setSection("view")
          .onClick(() => jumpToGroup(this)),
      );
    }
    super.onPaneMenu(menu, source);
  }

  private localKey(): string {
    return `canvas-local-${this.file?.path ?? ""}`;
  }
  private loadLocal(): { readonly?: boolean } {
    try {
      return JSON.parse(this.app.loadLocalStorage?.(this.localKey()) ?? "{}") ?? {};
    } catch {
      return {};
    }
  }
  private saveLocal(d: { readonly?: boolean }): void {
    if (!this.file) return;
    this.app.saveLocalStorage?.(this.localKey(), d.readonly ? JSON.stringify(d) : null);
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.canvas?.destroy();
    this.canvas = null;
  }
}

function jumpToGroup(view: CanvasView): void {
  const c = view.canvas;
  if (!c) return;
  const groups = [...c.nodes.values()].filter((n) => n.data.type === "group");
  if (!groups.length) {
    new Notice("This canvas has no groups.");
    return;
  }
  class GroupPicker extends FuzzySuggestModal<any> {
    getItems() {
      return groups;
    }
    getItemText(g: any) {
      return g.data.label || "Untitled group";
    }
    onChooseItem(g: any) {
      c!.selectOnly(g);
      c!.zoomToBbox(g.getBBox());
    }
  }
  const m = new GroupPicker(view.app);
  m.setPlaceholder("Jump to group...");
  m.open();
}

async function newCanvas(app: any, inFolder?: any): Promise<void> {
  const o = pluginState!.options;
  let folder = "";
  if (inFolder) folder = inFolder.isRoot?.() ? "" : inFolder.path;
  else if (o.newFileLocation === "current") {
    const f = app.workspace.getActiveFile?.();
    folder = f?.parent && !f.parent.isRoot() ? f.parent.path : "";
  } else if (o.newFileLocation === "folder") folder = String(o.newFileFolderPath ?? "").replace(/^\/+|\/+$/g, "");
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try {
      await app.vault.createFolder(folder);
    } catch {
      folder = "";
    }
  }
  const path = app.vault.getAvailablePath((folder ? folder + "/" : "") + "Untitled", "canvas");
  const file = await app.vault.create(path, "");
  await app.workspace.getLeaf(false).openFile(file, { active: true });
}

class CanvasSettingTab extends SettingTab {
  constructor(app: any) {
    super();
    this.app = app;
    this.id = "canvas";
    this.name = "Canvas";
    this.icon = "layout-dashboard";
  }
  display(): void {
    const el = this.containerEl;
    el.empty();
    const o = pluginState!.options;
    const save = () => pluginState!.save();
    new Setting(el)
      .setName("Default location for new canvas files")
      .addDropdown((d: any) =>
        d
          .addOption("root", "Vault folder")
          .addOption("current", "Same folder as current file")
          .addOption("folder", "In the folder specified below")
          .setValue(o.newFileLocation ?? "root")
          .onChange((v: any) => {
            o.newFileLocation = v;
            save();
            this.display();
          }),
      );
    if (o.newFileLocation === "folder")
      new Setting(el)
        .setName("Folder to create new canvas files in")
        .setDesc("New canvases go into this folder.")
        .addText((t: any) =>
          t
            .setPlaceholder("Example: folder 1/folder 2")
            .setValue(o.newFileFolderPath ?? "")
            .onChange((v: string) => {
              o.newFileFolderPath = v;
              save();
            }),
        );
    new Setting(el)
      .setName("Default mouse wheel behavior")
      .addDropdown((d: any) =>
        d
          .addOption("pan", "Pan")
          .addOption("zoom", "Zoom")
          .setValue(o.defaultWheelBehavior ?? "pan")
          .onChange((v: any) => {
            o.defaultWheelBehavior = v;
            save();
          }),
      );
    new Setting(el)
      .setName("Default Ctrl + Drag behavior")
      .addDropdown((d: any) =>
        d
          .addOption("menu", "Show menu")
          .addOption("card", "Add card")
          .addOption("note", "Add note from vault")
          .addOption("media", "Add media from vault")
          .addOption("webpage", "Add web page")
          .addOption("group", "Create group")
          .setValue(o.defaultModDragBehavior ?? "menu")
          .onChange((v: any) => {
            o.defaultModDragBehavior = v;
            save();
          }),
      );
    new Setting(el)
      .setName("Show card names")
      .addDropdown((d: any) =>
        d
          .addOption("always", "Always")
          .addOption("hover", "On hover")
          .addOption("never", "Never")
          .setValue(o.cardLabelVisibility ?? "always")
          .onChange((v: any) => {
            o.cardLabelVisibility = v;
            save();
          }),
      );
    new Setting(el)
      .setName("Snap to grid")
      .setDesc("Cards line up with the background grid when you move or resize them.")
      .addToggle((t: any) =>
        t.setValue(!!o.snapToGrid).onChange((v: boolean) => {
          o.snapToGrid = v;
          save();
        }),
      );
    new Setting(el)
      .setName("Snap to objects")
      .setDesc("Cards line up with the edges and centres of nearby cards.")
      .addToggle((t: any) =>
        t.setValue(!!o.snapToObjects).onChange((v: boolean) => {
          o.snapToObjects = v;
          save();
        }),
      );
    new Setting(el)
      .setName("Zoom threshold for hiding card content")
      .setDesc("When you zoom out past this level, cards show only their titles so large canvases stay fast.")
      .addSlider((s: any) =>
        s
          .setLimits(-0.7, 2.4, 0.01)
          .setValue(o.zoomBreakpoint ?? 0)
          .onChange((v: number) => {
            o.zoomBreakpoint = v;
            save();
          }),
      );
  }
}

/** Register the canvas view, file extension, commands, settings tab and link indexing. */
export function registerCanvas(app: any): CanvasPluginState {
  installCanvasStyles();
  pluginState = new CanvasPluginState(app);
  void pluginState.load();
  pluginState.indexer.start();
  const core = app.internalPlugins?.plugins?.canvas;
  if (core) core.instance = pluginState;
  app.viewRegistry.registerView("canvas", (leaf: WorkspaceLeaf) => new CanvasView(leaf));
  app.viewRegistry.registerExtensions(["canvas"], "canvas");
  const activeCanvas = (): CanvasView | null => {
    const v = app.workspace.activeLeaf?.view;
    return v instanceof CanvasView ? v : null;
  };
  app.commands.addCommand({ id: "canvas:new-file", name: "Canvas: Create new canvas", icon: "layout-dashboard", callback: () => void newCanvas(app) });
  app.commands.addCommand({
    id: "canvas:jump-to-group",
    name: "Canvas: Jump to group",
    checkCallback: (checking: boolean) => {
      const v = activeCanvas();
      if (!v) return false;
      if (!checking) jumpToGroup(v);
      return true;
    },
  });
  app.commands.addCommand({
    id: "canvas:convert-to-file",
    name: "Canvas: Convert to file...",
    checkCallback: (checking: boolean) => {
      const v = activeCanvas();
      const sel = v?.canvas ? [...v.canvas.selection] : [];
      if (!v || v.canvas?.readonly || sel.length !== 1 || !(sel[0] instanceof TextNode)) return false;
      if (!checking) void v.canvas!.convertToFile(sel[0] as TextNode);
      return true;
    },
  });
  app.commands.addCommand({
    id: "canvas:export-as-image",
    name: "Canvas: Export as image",
    checkCallback: (checking: boolean) => {
      const v = activeCanvas();
      if (!v || !v.canvas) return false;
      if (!checking) void exportAsImage(v);
      return true;
    },
  });
  // Keep file cards pointing at files that move, in canvases that aren't open too.
  app.vault.on("rename", async (f: any, old: string) => {
    if (!f || f.extension === "canvas" || !f.extension) return;
    for (const cf of app.vault.getFiles()) {
      if (cf.extension !== "canvas") continue;
      const open = app.workspace.getLeavesOfType("canvas").some((l: any) => l.view?.file === cf);
      if (open) continue;
      const d = pluginState!.indexer.get(cf.path);
      if (!d || !d.nodes.some((n) => (n.type === "file" && n.file === old) || (n.type === "group" && n.background === old))) continue;
      try {
        const text = await app.vault.read(cf);
        const data = parseCanvas(text);
        for (const n of data.nodes) {
          if (n.type === "file" && n.file === old) n.file = f.path;
          if (n.type === "group" && n.background === old) n.background = f.path;
        }
        await app.vault.modify(cf, serializeCanvas(data, { reorder: false }));
      } catch (e) {
        console.error("[canvas] couldn't update links in", cf.path, e);
      }
    }
  });
  if (app.setting?.addSettingTab) app.setting.addSettingTab(new CanvasSettingTab(app), "core");
  embedRenderers.canvas = (a, el, file, _subpath, component) => renderCanvasEmbed(a, el, file, component);
  return pluginState;
}

/** Export the whole canvas as a PNG next to the canvas file. */
async function exportAsImage(view: CanvasView): Promise<void> {
  const c = view.canvas!;
  if (!c.nodes.size) {
    new Notice("This canvas is empty, so there's nothing to export.");
    return;
  }
  try {
    const { renderCanvasPng } = await import("./export");
    const png = await renderCanvasPng(c);
    const base = view.file ? view.file.path.replace(/\.canvas$/i, "") : "Canvas";
    const path = view.app.vault.getAvailablePath(base, "png");
    await view.app.vault.createBinary(path, png);
    new Notice(`Saved the canvas as "${path}".`);
  } catch (e: any) {
    new Notice(`Couldn't export the canvas: ${e?.message ?? e}`);
  }
}

/** `![[board.canvas]]` in a note: a read-only, zoomed-to-fit view of the canvas. */
async function renderCanvasEmbed(app: any, el: HTMLElement, file: any, component: any): Promise<void> {
  el.addClass("canvas-embed", "inline-embed", "is-loaded");
  el.empty();
  const box = el.createDiv("canvas-embed-content");
  let data: CanvasData;
  try {
    data = parseCanvas(await app.vault.cachedRead(file));
  } catch {
    box.createDiv({ cls: "file-embed-title", text: `"${file.name}" can't be read.` });
    return;
  }
  const c = new Canvas(
    {
      app,
      file,
      get options() {
        return pluginState?.options ?? { snapToGrid: true, snapToObjects: true };
      },
      saveOptions: () => {},
      requestSave: () => {},
      embedded: true,
    },
    box,
  );
  c.setReadonly(true);
  c.setData(data, false);
  c.zoomToFitQueued = true;
  requestAnimationFrame(() => {
    c.onResize();
    c.zoomToFit(true);
  });
  const open = el.createDiv({ cls: "markdown-embed-link", attr: { "aria-label": "Open link" } });
  setIcon(open, "maximize-2");
  open.addEventListener("click", (e) => {
    e.stopPropagation();
    void app.workspace.getLeaf(e.ctrlKey || e.metaKey ? "tab" : false).openFile(file);
  });
  component?.register?.(() => c.destroy());
}
