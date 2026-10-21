// Core plugin switches for features that are built elsewhere in the app (sidebar panes, graph,
// canvas, the file explorer, word count, editing-mode status...). Turning one off in Settings ›
// Core plugins removes what it brings, like the original: its commands (so hotkeys stop), its
// ribbon buttons, status bar items and open tabs, and its file type; turning it on restores them
// and puts its sidebar tabs back where they belong by default.
import type { CorePluginImpl, InternalPlugin } from "./manager";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";

interface Gate {
  /** Command id prefixes owned by the plugin ("graph:" ...). */
  commands?: string[];
  /** View types whose tabs close when the plugin is turned off. */
  views?: string[];
  /** Sidebar tabs re-created when the plugin is turned back on. */
  restore?: { type: string; side: "left" | "right" }[];
  /** File extensions handled by the plugin's view. */
  extensions?: { exts: string[]; type: string };
  /** Status bar items (selectors) shown only while on. */
  status?: string[];
}

const GATES: Record<string, Gate> = {
  "file-explorer": { commands: ["file-explorer:"], views: ["file-explorer"], restore: [{ type: "file-explorer", side: "left" }] },
  "global-search": { commands: ["global-search:"], views: ["search"], restore: [{ type: "search", side: "left" }] },
  switcher: { commands: ["switcher:"] },
  graph: { commands: ["graph:"], views: ["graph", "localgraph"] },
  backlink: { commands: ["backlink:"], views: ["backlink"], restore: [{ type: "backlink", side: "right" }], status: [".status-bar-item.plugin-backlink"] },
  canvas: { commands: ["canvas:"], views: ["canvas"], extensions: { exts: ["canvas"], type: "canvas" } },
  "outgoing-link": { commands: ["outgoing-links:"], views: ["outgoing-link"], restore: [{ type: "outgoing-link", side: "right" }] },
  "tag-pane": { commands: ["tag-pane:"], views: ["tag"], restore: [{ type: "tag", side: "right" }] },
  properties: { commands: ["properties:"], views: ["all-properties", "file-properties"], restore: [{ type: "all-properties", side: "right" }], status: [".status-bar-item.plugin-properties"] },
  "command-palette": { commands: ["command-palette:"] },
  bookmarks: { commands: ["bookmarks:"], views: ["bookmarks"], restore: [{ type: "bookmarks", side: "left" }] },
  outline: { commands: ["outline:"], views: ["outline"], restore: [{ type: "outline", side: "right" }] },
  "word-count": { status: [".status-bar-item.plugin-word-count"] },
};

function ownsCommand(g: Gate, id: string): boolean {
  return !!g.commands?.some((p) => id.startsWith(p));
}

/** Wrap (or create) each gated plugin's implementation so on/off removes and restores its parts. */
export function installCorePluginGates(app: any): void {
  const ip = app.internalPlugins;
  // Commands added while their plugin is off are held back until it's turned on.
  const held = new Map<string, any>();
  const offPlugins = new Set<string>();
  const ownerOf = (id: string) => Object.entries(GATES).find(([, g]) => ownsCommand(g, id))?.[0] ?? null;
  const origAdd = app.commands.addCommand.bind(app.commands);
  app.commands.addCommand = (cmd: any) => {
    const owner = ownerOf(cmd.id);
    if (owner && offPlugins.has(owner)) {
      held.set(cmd.id, cmd);
      return cmd;
    }
    return origAdd(cmd);
  };
  const ribbonHeld = new Map<string, any[]>();
  const disablers: Record<string, () => void> = {};
  // Plugins that start switched off never get onDisable: apply their "off" state after loading,
  // and close their tabs once the saved layout has been restored.
  const origLoad = ip.load.bind(ip);
  ip.load = async () => {
    await origLoad();
    for (const id of Object.keys(GATES)) if (ip.plugins[id] && !ip.plugins[id].enabled) disablers[id]?.();
    app.workspace.onLayoutReady(() => {
      for (const id of Object.keys(GATES)) if (ip.plugins[id] && !ip.plugins[id].enabled) for (const t of GATES[id].views ?? []) app.workspace.detachLeavesOfType(t);
    });
  };

  for (const [id, gate] of Object.entries(GATES)) {
    const p: InternalPlugin | undefined = ip.plugins[id];
    if (!p) continue;
    const prev: CorePluginImpl | null = p.impl;
    let wasOff = false;
    const disable = () => {
      offPlugins.add(id);
      wasOff = true;
      for (const [cid, c] of Object.entries(app.commands.commands as Record<string, any>)) {
        if (!ownsCommand(gate, cid)) continue;
        held.set(cid, c);
        app.commands.removeCommand(cid);
      }
      const rb = app.workspace.leftRibbon;
      const items = rb.items.filter((it: any) => it.id.startsWith(id + ":"));
      if (items.length) ribbonHeld.set(id, items);
      for (const it of items) rb.removeRibbonAction(it.id);
      for (const t of gate.views ?? []) app.workspace.detachLeavesOfType(t);
      if (gate.extensions) app.viewRegistry.unregisterExtensions(gate.extensions.exts);
      for (const sel of gate.status ?? []) app.statusBar.containerEl.querySelectorAll(sel).forEach((e: HTMLElement) => e.addClass("is-plugin-off"));
    };
    const enable = async () => {
      offPlugins.delete(id);
      for (const [cid, c] of Array.from(held)) {
        if (ownerOf(cid) !== id) continue;
        held.delete(cid);
        origAdd(c);
      }
      const rb = app.workspace.leftRibbon;
      for (const it of ribbonHeld.get(id) ?? []) if (!rb.items.some((x: any) => x.id === it.id)) rb.addRibbonItemButton(it.id, it.icon, it.title, it.callback);
      ribbonHeld.delete(id);
      if (gate.extensions && !app.viewRegistry.isExtensionRegistered(gate.extensions.exts[0])) app.viewRegistry.registerExtensions(gate.extensions.exts, gate.extensions.type);
      for (const sel of gate.status ?? []) app.statusBar.containerEl.querySelectorAll(sel).forEach((e: HTMLElement) => e.removeClass("is-plugin-off"));
      // Turned back on during this session: put its sidebar tabs back.
      if (wasOff && app.workspace.layoutReady)
        for (const r of gate.restore ?? []) if (!app.workspace.getLeavesOfType(r.type).length) await app.workspace.ensureSideLeaf(r.type, r.side, { reveal: false });
    };
    disablers[id] = disable;
    p.impl = {
      ...(prev ?? {}),
      id,
      async onEnable(pp: InternalPlugin) {
        await enable();
        await prev?.onEnable?.(pp);
      },
      onDisable(pp: InternalPlugin) {
        prev?.onDisable?.(pp);
        disable();
      },
    };
  }
  installStatusItems(app);
}

// ---------------------------------------------------------------- editing mode in the status bar

const MODES = [
  { key: "live", label: "Live Preview", icon: "pen-line" },
  { key: "source", label: "Source mode", icon: "code-2" },
  { key: "preview", label: "Reading view", icon: "book-open" },
];

function modeOf(v: any): string {
  if (v?.getMode?.() === "preview") return "preview";
  const st = v?.getState?.() ?? {};
  return st.source ? "source" : "live";
}

/** The editor-status core plugin: an icon for the editing mode of the active note; click to switch. */
function installStatusItems(app: any): void {
  const ip = app.internalPlugins;
  const p: InternalPlugin | undefined = ip.plugins["editor-status"];
  if (!p) return;
  const prev = p.impl;
  p.impl = {
    ...(prev ?? {}),
    id: "editor-status",
    onEnable(pp: InternalPlugin) {
      const bar: HTMLElement = app.statusBar.containerEl;
      const el = createDiv({ cls: "status-bar-item plugin-editor-status mod-clickable", attr: { "data-tooltip-position": "top" } });
      const icon = el.createSpan("status-bar-item-icon");
      const wc = bar.querySelector(".plugin-word-count");
      bar.insertBefore(el, wc);
      pp.register(() => el.remove());
      const update = () => {
        const v = app.workspace.activeLeaf?.view;
        const md = v?.getViewType?.() === "markdown";
        el.toggle(!!md);
        if (!md) return;
        const m = MODES.find((x) => x.key === modeOf(v))!;
        icon.empty();
        setIcon(icon, m.icon);
        el.setAttr("aria-label", m.label);
      };
      el.addEventListener("click", () => {
        const v = app.workspace.activeLeaf?.view;
        if (v?.getViewType?.() !== "markdown") return;
        const cur = modeOf(v);
        const menu = new Menu();
        for (const m of MODES)
          menu.addItem((i) =>
            i
              .setTitle(m.label)
              .setIcon(m.icon)
              .setChecked(m.key === cur)
              .onClick(async () => {
                const st = v.getState();
                await v.leaf.setViewState({ type: "markdown", state: { ...st, mode: m.key === "preview" ? "preview" : "source", source: m.key === "source" }, active: true });
                update();
              }),
          );
        const r = el.getBoundingClientRect();
        menu.showAtPosition({ x: r.left, y: r.top - 4 });
        // Open upwards from the status bar.
        const mr = menu.dom.getBoundingClientRect();
        menu.dom.style.top = `${Math.max(4, r.top - mr.height - 4)}px`;
      });
      pp.registerEvent(app.workspace.on("active-leaf-change", update));
      pp.registerEvent(app.workspace.on("layout-change", update));
      update();
      return prev?.onEnable?.(pp);
    },
    onDisable(pp: InternalPlugin) {
      prev?.onDisable?.(pp);
    },
  };
}
