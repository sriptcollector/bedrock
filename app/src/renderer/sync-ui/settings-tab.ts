// Settings › Sync. Same order as Obsidian's Sync tab, minus what Bedrock doesn't need (no remote
// vault picker, no region): account, sync on/off (with the sync passphrase), status + pause,
// storage, device name, deleted files, activity log, selective sync, vault configuration sync.
// Sync is off until the person turns it on here.
import { Setting, SettingTab } from "../ui/setting";
import { Notice } from "../ui/notice";
import { formatBytes, formatTime, type SyncClient } from "./client";
import { ActivityLogModal, DeletedFilesModal, ExcludedFoldersModal } from "./modals";
import { ChangePassphraseModal, FORGET_WARNING, SYNC_EXPLAINER, TurnOnSyncModal } from "./turn-on";
import type { SyncConfigCategories, SyncSettings, SyncSnapshot } from "../../shared/sync";

const IMAGE = "bmp, png, jpg, jpeg, gif, svg, webp, avif";
const AUDIO = "mp3, wav, m4a, 3gp, flac, ogg, oga, opus";
const VIDEO = "mp4, webm, ogv, mov, mkv";

const CONFIG: Array<[keyof SyncConfigCategories, string, string]> = [
  ["app", "Main settings", "Editor, files and links, and other app settings."],
  ["appearance", "Appearance settings", "Light or dark mode, the active theme, fonts and which snippets are on."],
  ["themes", "Themes and snippets", "The theme and CSS snippet files themselves. Whether they're on follows the setting above."],
  ["hotkeys", "Hotkeys", "Your custom hotkeys."],
  ["corePlugins", "Active core plugin list", "Which core plugins are turned on."],
  ["corePluginSettings", "Core plugin settings", "Settings of core plugins such as daily notes, templates and graph view."],
  ["communityPlugins", "Active community plugin list", "Which community plugins are turned on."],
  ["communityPluginData", "Installed community plugins", "The plugins themselves (code, styles, manifest) and their settings."],
];

export class SyncSettingTab extends SettingTab {
  private off: (() => void) | null = null;
  private last = "";
  private statusEl: HTMLElement | null = null;

  constructor(
    app: any,
    private client: SyncClient,
  ) {
    super();
    this.app = app;
    this.id = "sync";
    this.name = "Sync";
    (this as any).icon = "refresh-cw";
  }

  display(): void {
    this.off?.();
    this.last = "";
    this.off = this.client.onChange((s) => {
      // full re-render only when the layout changes; status changes update one line in place
      const key = JSON.stringify([s.status === "disabled", s.status === "locked", s.signedIn, s.account, s.usage, s.settings, s.hubInstalled]);
      if (key !== this.last) {
        this.last = key;
        this.render(s);
      } else this.statusEl?.setText(statusLine(s));
    });
    if (!this.client.snapshot) this.containerEl.createDiv({ cls: "setting-item-description", text: "Loading…" });
    if (this.client.snapshot?.signedIn) void this.client.usage().catch(() => {});
  }

  hide(): void {
    this.off?.();
    this.off = null;
  }

  /** Settings search: this tab is drawn by hand, so list its rows here (names match the rows). */
  getSearchIndex() {
    const rows: { name: string; desc?: string; aliases?: string[]; group?: string | null }[] = [
      { name: "Sync", desc: "Turn sync on or off.", aliases: ["turn on", "turn off", "enable", "disable"] },
      { name: "Sync passphrase", desc: "Change your sync passphrase.", aliases: ["change passphrase", "forgot passphrase", "reset", "password", "key", "encryption", "unlock"] },
      { name: "Account", desc: "Your Toolbay account.", aliases: ["sign in", "sign out", "toolbay"] },
      { name: "Sync status", desc: "Pause or resume sync.", aliases: ["pause", "resume"] },
      { name: "Storage used", aliases: ["quota", "space", "usage"] },
      { name: "Device name", aliases: ["computer name"] },
      { name: "Deleted files", aliases: ["trash", "restore"] },
      { name: "Activity log", aliases: ["history", "log"] },
      { name: "Excluded folders", group: "Selective sync", aliases: ["exclude", "ignore"] },
      { name: "Sync images", group: "Selective sync" },
      { name: "Sync audio", group: "Selective sync" },
      { name: "Sync videos", group: "Selective sync" },
      { name: "Sync PDFs", group: "Selective sync" },
      { name: "Sync all other types", group: "Selective sync" },
    ];
    for (const [, name, desc] of CONFIG) rows.push({ name, desc, group: "Vault configuration sync" });
    return rows;
  }

  private render(s: SyncSnapshot): void {
    const el = this.containerEl;
    const scroll = el.scrollTop;
    const focused = document.activeElement?.closest(".setting-item")?.getAttribute("data-key");
    el.empty();
    el.addClass("bedrock-sync-settings");
    if (s.status === "disabled") {
      el.createEl("p", { text: "This window is a folder opened as a separate vault. Only your main vault syncs." });
      return;
    }
    if (!s.signedIn) return this.renderSignedOut(s);

    const who = s.account ? `${s.account.name || s.account.handle || s.account.email}${s.account.handle ? ` (@${s.account.handle})` : ""}` : "your Toolbay account";
    new Setting(el)
      .setName("Account")
      .setDesc(`Signed in as ${who}. To sign out or switch accounts, use the Toolbay app.`);

    if (!s.settings.enabled) return this.renderOff();

    new Setting(el)
      .setName("Sync")
      .setDesc("On. This vault syncs through your Toolbay account, locked with your sync passphrase.")
      .addButton((b) =>
        b.setButtonText("Turn off").onClick(async () => {
          b.setDisabled(true);
          await this.client.turnOff().catch((e) => new Notice(e.message));
        }),
      );

    new Setting(el)
      .setName("Sync passphrase")
      .setDesc("Forgot it or want a new one? Change it here without the old one. Your synced notes stay as they are.")
      .addButton((b) => b.setButtonText("Change passphrase").onClick(() => new ChangePassphraseModal(this.app, this.client).open()));

    const status = new Setting(el).setName("Sync status").setDesc(statusLine(s));
    status.settingEl.addClass("sync-status-setting");
    this.statusEl = status.descEl;
    if (s.status === "locked") status.addButton((b) => b.setButtonText("Enter passphrase").setCta().onClick(() => new TurnOnSyncModal(this.app, this.client).open()));
    status.addButton((b) =>
      b.setButtonText(s.settings.paused ? "Resume" : "Pause").onClick(async () => {
        b.setDisabled(true);
        await (s.settings.paused ? this.client.resume() : this.client.pause()).catch((e) => new Notice(e.message));
      }),
    );

    const usage = new Setting(el).setName("Storage used");
    if (s.usage) {
      const pct = s.usage.quotaBytes ? (s.usage.usedBytes / s.usage.quotaBytes) * 100 : 0;
      usage.setDesc(`You're using ${formatBytes(s.usage.usedBytes)} of ${formatBytes(s.usage.quotaBytes)}. This includes ${s.usage.retentionDays} days of version history and deleted files.`);
      const bar = usage.descEl.createDiv("sync-usage-bar");
      const fill = bar.createDiv("sync-usage-bar-fill");
      fill.style.width = `${Math.max(0.5, Math.min(100, pct)).toFixed(1)}%`;
      if (pct > 90) bar.addClass("mod-warning");
    } else usage.setDesc(s.status === "offline" ? "Shown when sync is connected." : "Checking…");

    new Setting(el)
      .setName("Device name")
      .setDesc("Shown in the activity log, version history and the names of conflict copies. Leave empty to use this computer's name.")
      .addText((t) => {
        t.setPlaceholder(s.computerName).setValue(s.settings.deviceName);
        t.inputEl.addEventListener("change", () => void this.client.setSettings({ deviceName: t.getValue().trim() }));
      })
      .settingEl.setAttr("data-key", "device-name");

    new Setting(el)
      .setName("Deleted files")
      .setDesc("See and restore files deleted on any of your computers.")
      .addButton((b) => b.setButtonText("View").onClick(() => new DeletedFilesModal(this.app, this.client).open()));
    new Setting(el)
      .setName("Activity log")
      .setDesc("See what synced, when, and any problems.")
      .addButton((b) => b.setButtonText("View").onClick(() => new ActivityLogModal(this.app, this.client).open()));

    new Setting(el).setName("Selective sync").setHeading();
    const ex = s.settings.excludedFolders;
    new Setting(el)
      .setName("Excluded folders")
      .setDesc(ex.length ? `Not syncing on this computer: ${ex.join(", ")}.` : "Keep some folders on this computer only.")
      .addButton((b) => b.setButtonText("Manage").onClick(() => new ExcludedFoldersModal(this.app, this.client).open()));
    this.toggle("Sync images", `Image files: ${IMAGE}.`, s.settings.images, (v) => ({ images: v }));
    this.toggle("Sync audio", `Audio files: ${AUDIO}.`, s.settings.audio, (v) => ({ audio: v }));
    this.toggle("Sync videos", `Video files: ${VIDEO}.`, s.settings.video, (v) => ({ video: v }));
    this.toggle("Sync PDFs", "PDF files.", s.settings.pdf, (v) => ({ pdf: v }));
    this.toggle("Sync all other types", "Every other kind of file. Notes, canvases and bases always sync.", s.settings.other, (v) => ({ other: v }));

    new Setting(el).setName("Vault configuration sync").setHeading();
    el.createDiv({
      cls: "setting-item-description sync-config-note",
      text: "These apply to this computer. Turn on the same ones on your other computers to share them both ways.",
    });
    for (const [k, name, desc] of CONFIG) this.toggle(name, desc, s.settings.config[k], (v) => ({ config: { ...s.settings.config, [k]: v } }));

    new Setting(el).setName("Privacy").setHeading();
    el.createDiv({
      cls: "setting-item-description sync-privacy-note",
      text:
        "Your notes, file names and folder names are encrypted on this computer before they leave it, with a key only your sync passphrase opens. Toolbay stores the locked copy and can't read it. This computer keeps the opened key in its keychain, so you type the passphrase once per computer. " +
        FORGET_WARNING,
    });
    el.scrollTop = scroll;
    if (focused) (el.querySelector(`[data-key="${focused}"] input`) as HTMLInputElement | null)?.focus();
  }

  private toggle(name: string, desc: string, value: boolean, patch: (v: boolean) => Partial<SyncSettings>): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((t) => t.setValue(value).onChange((v) => void this.client.setSettings(patch(v)).catch((e) => new Notice(e.message))));
  }

  private renderOff(): void {
    const el = this.containerEl;
    new Setting(el)
      .setName("Sync")
      .setDesc("Off. Nothing from this vault is uploaded. Your notes stay on this computer.")
      .addButton((b) => b.setButtonText("Turn on sync").setCta().onClick(() => new TurnOnSyncModal(this.app, this.client).open()));
    new Setting(el)
      .setName("Sync passphrase")
      .setDesc("Forgot it or want a new one? Change it without the old one on a computer that has your sync key.")
      .addButton((b) => b.setButtonText("Change passphrase").onClick(() => new ChangePassphraseModal(this.app, this.client).open()));
    for (const t of SYNC_EXPLAINER) el.createEl("p", { cls: "setting-item-description sync-intro", text: t });
    el.createEl("p", { cls: "setting-item-description sync-intro", text: FORGET_WARNING });
  }

  private renderSignedOut(s: SyncSnapshot): void {
    const el = this.containerEl;
    el.createEl("p", {
      cls: "sync-intro",
      text: "Sync keeps this vault the same on all your computers, with version history. It's free, goes through your Toolbay account, and stays off until you turn it on. You choose a sync passphrase that locks your notes, so Toolbay can't read them.",
    });
    el.createEl("p", {
      cls: "sync-intro",
      text: s.hubInstalled
        ? "To use it, sign in in the Toolbay app, then come back here and turn sync on."
        : "Sign-in happens in the Toolbay app. Install it and sign in there, then come back here and turn sync on.",
    });
    const btns = el.createDiv("sync-signin-buttons");
    const b = btns.createEl("button", { cls: "mod-cta sync-signin-button", text: s.hubInstalled ? "Sign in to Toolbay" : "Get the Toolbay app" });
    b.addEventListener("click", async () => {
      await this.client.signIn().catch((e) => new Notice(e.message));
      new Notice(s.hubInstalled ? "Finish signing in in the Toolbay app, then turn sync on here." : "Install the Toolbay app and sign in there, then turn sync on here.");
    });
  }
}

export function statusLine(s: SyncSnapshot): string {
  if (s.status === "synced") return `${s.message}${s.lastSyncedAt ? ` · last sync ${formatTime(s.lastSyncedAt)}` : ""}.`.replace(/\.\./, ".");
  return s.message;
}
