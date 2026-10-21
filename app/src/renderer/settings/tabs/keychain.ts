// Settings › Keychain: secrets (API keys, passwords) that plugins can use by name.
import moment from "moment";
import { BuiltinTab } from "./base";
import { Modal } from "../../ui/modal";
import { Setting } from "../../ui/setting";
import { Notice } from "../../ui/notice";

export class KeychainTab extends BuiltinTab {
  private query = "";
  constructor(app: any) {
    super(app, "keychain", "Keychain", "key-round");
  }
  getSettingDefinitions(): any[] {
    const ss = this.app.secretStorage;
    const ids: string[] = ss?.listSecrets() ?? [];
    return [
      {
        type: "list",
        heading: "Secrets",
        emptyState: ss?.isEncryptionAvailable?.() === false
          ? "Secure storage isn't available on this computer, so secrets can't be saved."
          : "No secrets yet. Secrets keep things like API keys and passwords that plugins need, encrypted on this computer and never synced.",
        addItem: { name: "Add secret", action: () => this.edit(null) },
        search: ids.length ? { placeholder: "Find secret...", match: (d: any, q: string) => d.name.toLowerCase().includes(q) } : undefined,
        items: ids.map((id) => {
          const last = ss.getLastAccess(id);
          return {
            name: id,
            desc: last ? `Last used ${moment(last).fromNow()}` : "Never accessed",
            render: (s: Setting) => {
              s.settingEl.prepend(createDiv("setting-item-icon"));
              s.addExtraButton((b) =>
                b
                  .setIcon("pen-line")
                  .setTooltip("Edit secret")
                  .onClick(() => this.edit(id)),
              );
              s.addExtraButton((b) =>
                b
                  .setIcon("trash-2")
                  .setTooltip("Delete")
                  .onClick(async () => {
                    const ok = await this.app.ui.confirm({ title: "Delete secret", body: `Delete “${id}”? Plugins that use it will stop working until you add it again.`, cta: "Delete", danger: true });
                    if (!ok) return;
                    ss.deleteSecret(id);
                    this.rerender();
                  }),
              );
            },
          };
        }),
      },
    ];
  }

  private edit(id: string | null): void {
    const m = new SecretModal(this.app, id, () => this.rerender());
    m.open();
  }
}

class SecretModal extends Modal {
  constructor(app: any, private id: string | null, private done: () => void) {
    super(app);
  }
  onOpen(): void {
    const ss = this.app.secretStorage;
    this.setTitle(this.id ? "Edit secret" : "Add secret");
    let name = this.id ?? "";
    let value = "";
    const err = this.contentEl.createDiv({ cls: "setting-item-description mod-warning" });
    new Setting(this.contentEl)
      .setName("Name")
      .setDesc("Lowercase letters, numbers and dashes. Plugins ask for the secret by this name.")
      .addText((t) => {
        t.setPlaceholder("my-api-key").setValue(name).onChange((v) => (name = v.trim()));
        if (this.id) t.setDisabled(true);
      });
    new Setting(this.contentEl).setName("Value").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder(this.id ? "Type a new value" : "Paste the secret").onChange((v) => (value = v));
    });
    const btns = this.modalEl.createDiv("modal-button-container");
    btns.createEl("button", { cls: "mod-cta", text: "Save" }).addEventListener("click", () => {
      if (!ss.validateId(name)) {
        err.setText("Use only lowercase letters, numbers and dashes in the name.");
        return;
      }
      if (!value) {
        err.setText("Enter a value.");
        return;
      }
      if (!this.id && ss.listSecrets().includes(name)) {
        err.setText("A secret with that name already exists.");
        return;
      }
      try {
        ss.setSecret(name, value);
      } catch (e: any) {
        new Notice(e?.message ?? String(e));
        return;
      }
      this.close();
      this.done();
    });
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
