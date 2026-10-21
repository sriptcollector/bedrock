// Settings › Interface: tab title bar, ribbon, zoom, menus, window frame, settings window.
import { webFrame } from "electron";
import { BuiltinTab, appSettings } from "./base";
import { SettingPage, SettingGroup } from "../render";
import type { Setting } from "../../ui/setting";
import { Notice } from "../../ui/notice";
import { setIcon } from "../../dom/icons";

export function getZoom(app: any): number {
  const z = parseFloat(app.loadLocalStorage("zoom") ?? "0");
  return Number.isFinite(z) ? z : 0;
}
export function setZoom(app: any, level: number): void {
  level = Math.max(-2.5, Math.min(3, Math.round(level * 2) / 2));
  app.saveLocalStorage("zoom", level === 0 ? null : String(level));
  try {
    webFrame.setZoomLevel(level);
  } catch {
    /* not in Electron (tests) */
  }
  document.body.style.setProperty("--zoom-factor", String(Math.pow(1.2, level)));
}

export class InterfaceTab extends BuiltinTab {
  private frame = "hidden";
  private frameChanged = false;
  constructor(app: any) {
    super(app, "interface", "Interface", "monitor");
  }
  display(): void {
    appSettings.get().then((s) => {
      const f = s?.frame ?? "hidden";
      if (f !== this.frame) {
        this.frame = f;
        this.rerender();
      }
    });
    super.display();
  }
  getSettingDefinitions(): any[] {
    const app = this.app;
    return [
      { name: "Show tab title bar", desc: "Show the bar at the top of each tab with its title and buttons.", control: { type: "toggle", key: "showViewHeader" } },
      { name: "Show ribbon", desc: "Show the column of buttons along the left edge of the window.", control: { type: "toggle", key: "showRibbon" } },
      {
        type: "page",
        name: "Ribbon menu configuration",
        desc: "Choose which buttons appear in the ribbon and in what order.",
        page: () => new RibbonPage(app),
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          {
            name: "Zoom level",
            desc: "Make everything in the window bigger or smaller.",
            render: (s: Setting) => {
              s.addExtraButton((b) =>
                b
                  .setIcon("rotate-ccw")
                  .setTooltip("Restore default")
                  .onClick(() => {
                    setZoom(app, 0);
                    this.rerender();
                  }),
              );
              const z = getZoom(app);
              const pct = (v: number) => Math.round(Math.pow(1.2, v) * 100) + "%";
              const val = s.controlEl.createSpan({ cls: "slider-value", text: pct(z) });
              s.addSlider((sl) =>
                sl
                  .setLimits(-2.5, 3, 0.5)
                  .setValue(z)
                  .setDynamicTooltip()
                  .onChange((v) => {
                    val.setText(pct(v));
                    setZoom(app, v);
                  }),
              );
            },
          },
          {
            name: "Native menus",
            desc: "Use your operating system's style for context menus instead of the app's own.",
            control: { type: "toggle", key: "nativeMenus" },
          },
          {
            name: "Window frame style",
            desc: "How the window's title bar is drawn. Takes effect after a relaunch.",
            render: (s: Setting) => {
              s.addDropdown((d) =>
                d
                  .addOptions({ hidden: "Hidden (default)", custom: `${app.brand.displayName} frame`, native: "Native frame" })
                  .setValue(this.frame)
                  .onChange(async (v) => {
                    this.frame = v;
                    this.frameChanged = true;
                    await appSettings.set({ frame: v });
                    this.rerender();
                    new Notice("Relaunch the app to use the new window frame.");
                  }),
              );
              const relaunch = s.controlEl.createEl("button", { cls: "mod-cta", text: "Relaunch" });
              relaunch.addEventListener("click", () => appSettings.relaunch());
              relaunch.toggle(this.frameChanged);
            },
          },
          {
            name: "Open settings in new window",
            desc: "Show settings in a separate window. Turn off to show them on top of the main window instead.",
            control: { type: "toggle", key: "settingsPopoutWindow" },
          },
        ],
      },
    ];
  }
}

/** Interface › Ribbon menu configuration */
class RibbonPage extends SettingPage {
  constructor(private app: any) {
    super();
    this.title = "Ribbon menu configuration";
  }
  display(): void {
    const rb = this.app.workspace.leftRibbon;
    const el = this.containerEl;
    el.empty();
    const g = new SettingGroup(el).addClass("mod-list", "mod-no-icon");
    const save = () => {
      const h: Record<string, boolean> = {};
      for (const it of rb.items) h[it.id] = !!it.hidden;
      rb.hiddenItems = h;
      rb.applyOrder?.();
      this.app.workspace.requestSaveLayout();
    };
    if (!rb.items.length) {
      g.addSetting((s) => s.setClass("mod-empty-state").setName("There are no ribbon buttons."));
      return;
    }
    rb.items.forEach((it: any, i: number) =>
      g.addSetting((s) => {
        s.setName(it.title);
        const iconEl = s.settingEl.createDiv("setting-item-icon");
        s.settingEl.prepend(iconEl);
        setIcon(iconEl, it.icon);
        if (i > 0)
          s.addExtraButton((b) =>
            b
              .setIcon("arrow-up")
              .setTooltip("Move up")
              .onClick(() => {
                const items = rb.items;
                [items[i - 1], items[i]] = [items[i], items[i - 1]];
                save();
                this.display();
              }),
          );
        s.addToggle((t) =>
          t.setValue(!it.hidden).onChange((v) => {
            it.hidden = !v;
            it.buttonEl.toggle(v);
            save();
          }),
        );
      }),
    );
  }
}
