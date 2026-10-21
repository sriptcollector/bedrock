// Settings › General: version and updates, language, help, Toolbay account, advanced.
import { BRAND } from "../../../shared/brand";
import { Notice } from "../../ui/notice";
import { BuiltinTab, appSettings, descWithLink } from "./base";
import { renderCredit } from "../credit";

export class GeneralTab extends BuiltinTab {
  private app_: Record<string, any> = {};
  private updateMsg = "";
  private gpuChanged = false;
  private account: any = undefined;

  constructor(app: any) {
    super(app, "about", "General", "circle-user");
  }

  display(): void {
    // App-level settings and account come from the main process.
    Promise.all([appSettings.get(), this.app.native.getAccount().catch(() => null)]).then(([s, a]) => {
      const changed = JSON.stringify(s) !== JSON.stringify(this.app_) || a?.handle !== this.account?.handle || this.account === undefined;
      this.app_ = s ?? {};
      this.account = a ?? null;
      if (changed && this.containerEl.isConnected) this.rerenderOnce();
    });
    super.display();
    renderCredit(this.containerEl.createDiv("setting-item bedrock-credit-row"));
  }
  private rendering = false;
  private rerenderOnce(): void {
    if (this.rendering) return;
    this.rendering = true;
    const top = this.containerEl.scrollTop;
    super.display();
    renderCredit(this.containerEl.createDiv("setting-item bedrock-credit-row"));
    this.containerEl.scrollTop = top;
    this.rendering = false;
  }

  getControlValue(key: string): unknown {
    if (key === "autoUpdate") return !this.app_.updateDisabled;
    if (key === "hardwareAcceleration") return !this.app_.disableGpu;
    if (key === "startupNotify") return this.app.loadLocalStorage("startup-notify") === "true";
    return super.getControlValue(key);
  }
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "autoUpdate") this.app_ = await appSettings.set({ updateDisabled: !value });
    else if (key === "hardwareAcceleration") {
      this.app_ = await appSettings.set({ disableGpu: !value });
    } else if (key === "startupNotify") this.app.saveLocalStorage("startup-notify", value ? "true" : null);
    else return super.setControlValue(key, value);
  }

  getSettingDefinitions(): any[] {
    const app = this.app;
    const releases = `https://github.com/${BRAND.repo}/releases`;
    const acct = this.account;
    return [
      {
        name: `Version ${app.version}`,
        desc: descWithLink(`${BRAND.byline}. Free and open source. ${this.updateMsg ? this.updateMsg + " " : ""}`, "See what's new.", () => app.openExternal(releases)),
        render: (s: any) =>
          s.addButton((b: any) =>
            b.setButtonText("Check for updates").onClick(async () => {
              b.setDisabled(true).setButtonText("Checking...");
              this.updateMsg = await app.native.checkForUpdates();
              new Notice(this.updateMsg);
              this.rerender();
            }),
          ),
      },
      { name: "Automatic updates", desc: "Download new versions in the background and install them when you quit. Turn this off to check by hand.", control: { type: "toggle", key: "autoUpdate" } },
      {
        name: "Language",
        desc: "The language the app is shown in. More languages will be added; for now everything is in English.",
        render: (s: any) => s.addDropdown((d: any) => d.addOption("en", "English").setValue("en").setDisabled(true)),
      },
      {
        name: "Help",
        desc: "Read how the app works, ask questions and report problems.",
        render: (s: any) => s.addButton((b: any) => b.setButtonText("Open").onClick(() => app.openExternal(`https://github.com/${BRAND.repo}#readme`))),
      },
      {
        type: "group",
        heading: "Account",
        items: [
          {
            name: "Toolbay account",
            desc:
              acct === undefined
                ? "Checking..."
                : acct
                  ? `Signed in as ${acct.name || acct.handle || acct.email}. This vault syncs with your other computers.`
                  : "You're not signed in. Signing in is only needed to sync this vault between your computers; everything else works without it. Sign in from the Toolbay app.",
            render: (s: any) => {
              if (acct === null) s.addButton((b: any) => b.setButtonText("Get Toolbay").onClick(() => app.openExternal("https://toolbay.ai")));
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          {
            name: "Notify if startup takes longer than expected",
            desc: "Show a message when the app takes unusually long to open, with what slowed it down.",
            render: (s: any) => {
              s.addExtraButton((b: any) =>
                b
                  .setIcon("timer")
                  .setTooltip("Check now")
                  .onClick(() => {
                    const st = app.indexStats;
                    new Notice(st ? `Startup: window ready in ${st.layoutReadyMs} ms, ${st.files} files indexed in ${st.totalMs} ms.` : "Startup timing isn't available yet.");
                  }),
              );
              s.addToggle((t: any) => t.setValue(this.getControlValue("startupNotify") as boolean).onChange((v: boolean) => this.setControlValue("startupNotify", v)));
            },
          },
          {
            name: "Command line interface",
            desc: "Control the app from a terminal. This isn't available yet.",
            render: (s: any) => s.addToggle((t: any) => t.setValue(false).setDisabled(true)),
          },
          {
            name: "Hardware acceleration",
            desc: "Use the graphics card to draw the app. Only turn this off if you see display problems; the app will feel slower without it.",
            render: (s: any) => {
              const relaunch = s.controlEl.createEl("button", { cls: "mod-cta", text: "Relaunch" });
              relaunch.addEventListener("click", () => appSettings.relaunch());
              relaunch.toggle(this.gpuChanged);
              s.addToggle((t: any) =>
                t.setValue(!this.app_.disableGpu).onChange(async (v: boolean) => {
                  await this.setControlValue("hardwareAcceleration", v);
                  this.gpuChanged = true;
                  relaunch.show();
                }),
              );
            },
          },
          {
            name: "Open another folder as vault",
            desc: "Open any folder, such as an existing Obsidian vault, in its own window. It isn't synced.",
            render: (s: any) => s.addButton((b: any) => b.setButtonText("Open folder").onClick(() => app.native.openVaultDialog())),
          },
          {
            name: "Make an existing vault your synced vault",
            desc: `Copy an existing vault's notes, attachments and settings into your ${BRAND.displayName} vault so it syncs. Nothing in the original folder changes.`,
            render: (s: any) => s.addButton((b: any) => b.setButtonText("Import vault").onClick(() => app.importVaultFlow())),
          },
          {
            name: "Vault location",
            desc: app.vault.adapter.basePath,
            render: (s: any) => s.addButton((b: any) => b.setButtonText("Show in folder").onClick(() => app.showInFolder("/"))),
          },
        ],
      },
    ];
  }
}
