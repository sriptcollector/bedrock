// Turning sync on: the sync passphrase dialog (first computer, another computer, forgot it) and the
// one-time message for computers that synced with 0.1.2 or older. Sync never turns itself on; these
// dialogs are the only way in.
import { Modal } from "../ui/modal";
import { Notice } from "../ui/notice";
import type { SyncClient } from "./client";
import type { SyncKeyInfo, SyncTurnOnMode } from "../../shared/sync";

const MIN = 10;

/** Plain words about what turning sync on means. Shared by the settings tab and the dialogs. */
export const SYNC_EXPLAINER = [
  "What syncs: the notes, attachments and settings in this vault (you can leave folders and file types out). They go to your Toolbay account so your other computers get them, with version history.",
  "Your sync passphrase locks them. Notes, file names and folder names are encrypted on this computer before they're uploaded, with a key only your passphrase opens. Toolbay stores the locked copy and can't read it.",
];
export const FORGET_WARNING =
  "If you forget the passphrase, your synced notes can't be recovered from Toolbay, by you or by us. The files on your computers are never affected: you can start over with a new passphrase and they upload again.";

export class TurnOnSyncModal extends Modal {
  private info: SyncKeyInfo | null = null;
  private mode: SyncTurnOnMode = "create";

  constructor(
    app: any,
    private client: SyncClient,
  ) {
    super(app);
    this.modalEl.addClass("bedrock-sync-turn-on");
  }

  onOpen(): void {
    this.setTitle("Turn on sync");
    this.contentEl.createEl("p", { cls: "setting-item-description", text: "Checking your Toolbay account…" });
    this.client.keyInfo().then(
      (info) => {
        this.info = info;
        this.mode = info.thisComputerHasKey ? "resume" : info.accountHasKey ? "unlock" : "create";
        this.render();
      },
      (e) => {
        this.contentEl.empty();
        this.contentEl.createEl("p", { text: `Couldn't reach your Toolbay account: ${e.message}` });
      },
    );
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    const btns = this.modalEl.querySelector(".modal-button-container") ?? this.modalEl.createDiv("modal-button-container");
    btns.empty();
    const mode = this.mode;
    this.setTitle(mode === "reset" ? "Start over with a new passphrase" : "Turn on sync");

    if (mode !== "reset") for (const t of SYNC_EXPLAINER) el.createEl("p", { text: t });

    if (mode === "resume") {
      el.createEl("p", { text: "This computer already has your sync key, so there's nothing to type." });
      const go = btns.createEl("button", { cls: "mod-cta", text: "Turn on sync" });
      go.addEventListener("click", () => this.submit(go, "resume"));
      this.cancelButton(btns);
      return;
    }

    if (mode === "unlock") {
      el.createEl("p", { text: "Sync is already set up on another computer. Enter the sync passphrase you chose there." });
      const pass = this.field(el, "Sync passphrase", "current-password");
      pass.focus();
      const forgot = el.createEl("a", { cls: "sync-forgot-link", text: "Forgot your passphrase?", href: "#" });
      forgot.addEventListener("click", (e) => {
        e.preventDefault();
        this.mode = "reset";
        this.render();
      });
      const go = btns.createEl("button", { cls: "mod-cta", text: "Unlock and turn on" });
      const run = () => this.submit(go, "unlock", pass.value);
      go.addEventListener("click", run);
      pass.addEventListener("keydown", (e) => e.key === "Enter" && run());
      this.cancelButton(btns);
      return;
    }

    // create or reset
    if (mode === "reset") {
      el.createEl("p", {
        text: "Choose a new sync passphrase. The synced copy in your Toolbay account is erased and replaced with the notes on this computer, under a new key. Your other computers keep their files and ask for the new passphrase; their notes upload again when they sync.",
      });
      el.createEl("p", { text: "Nothing on any computer is deleted." });
    } else {
      el.createEl("p", { text: `Choose a sync passphrase: at least ${MIN} characters. A few unrelated words is easy to remember and hard to guess. You'll type it once on each of your computers.` });
    }
    el.createEl("p", { cls: "mod-warning", text: FORGET_WARNING });
    const pass = this.field(el, mode === "reset" ? "New sync passphrase" : "Sync passphrase", "new-password");
    const again = this.field(el, "Type it again", "new-password");
    const ackRow = el.createEl("label", { cls: "sync-ack" });
    const ack = ackRow.createEl("input", { type: "checkbox" });
    ackRow.appendText(" I understand that if I forget this passphrase, my synced notes can't be recovered from Toolbay.");
    pass.focus();
    const go = btns.createEl("button", { cls: mode === "reset" ? "mod-warning" : "mod-cta", text: mode === "reset" ? "Erase synced copy and start over" : "Turn on sync" });
    const run = () => {
      if (pass.value.normalize("NFKC").trim().length < MIN) return void new Notice(`Use at least ${MIN} characters for your sync passphrase.`);
      if (pass.value !== again.value) return void new Notice("The two passphrases don't match.");
      if (!ack.checked) return void new Notice("Tick the box to confirm you'll keep your passphrase safe.");
      this.submit(go, mode, pass.value);
    };
    go.addEventListener("click", run);
    again.addEventListener("keydown", (e) => e.key === "Enter" && run());
    if (mode === "reset" && this.info) {
      const back = btns.createEl("button", { text: "Back" });
      back.addEventListener("click", () => {
        this.mode = this.info!.thisComputerHasKey ? "resume" : "unlock";
        this.render();
      });
    } else this.cancelButton(btns);
  }

  private field(el: HTMLElement, label: string, autocomplete: string): HTMLInputElement {
    const row = el.createDiv("sync-passphrase-field");
    row.createEl("label", { text: label });
    return row.createEl("input", { type: "password", attr: { autocomplete, spellcheck: "false", "aria-label": label } });
  }

  private cancelButton(btns: Element): void {
    const c = (btns as HTMLElement).createEl("button", { text: "Cancel" });
    c.addEventListener("click", () => this.close());
  }

  private async submit(btn: HTMLButtonElement, mode: SyncTurnOnMode, passphrase?: string): Promise<void> {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = mode === "resume" ? "Turning on…" : "Working…";
    try {
      await this.client.turnOn(mode, passphrase);
      this.close();
      new Notice(mode === "reset" ? "New passphrase set. Sync is on." : "Sync is on.");
    } catch (e: any) {
      new Notice(e?.message ?? String(e), 8000);
      btn.disabled = false;
      btn.textContent = label;
    }
  }
}

/** Shown once on computers that synced with 0.1.2 or older. */
export class SyncMigrationModal extends Modal {
  private chose = false;

  constructor(
    app: any,
    private client: SyncClient,
  ) {
    super(app);
    this.modalEl.addClass("bedrock-sync-migration");
  }

  onOpen(): void {
    this.setTitle("Sync is off until you choose");
    const el = this.contentEl;
    el.createEl("p", { text: "Sync no longer turns itself on. It's off on this computer, and nothing from your vault has been uploaded since this update." });
    el.createEl("p", {
      text: "Earlier versions kept your vault's key in your Toolbay account without a passphrase, so Toolbay could have unlocked your synced notes. This update deletes that key from your account.",
    });
    el.createEl("p", {
      text: "If you turn sync back on, you choose a sync passphrase and your synced notes get a new key that only your passphrase opens. Toolbay can't read them. Your notes on this computer stay as they are either way.",
    });
    const btns = this.modalEl.createDiv("modal-button-container");
    const on = btns.createEl("button", { cls: "mod-cta", text: "Turn on sync…" });
    on.addEventListener("click", () => {
      this.chose = true;
      this.close();
      new TurnOnSyncModal(this.app, this.client).open();
    });
    const off = btns.createEl("button", { text: "Keep sync off" });
    off.addEventListener("click", () => this.close());
  }

  onClose(): void {
    // closing the message any way counts as "seen"; sync stays off unless they turn it on
    if (!this.chose) void this.client.dismissMigration().catch(() => {});
  }
}
