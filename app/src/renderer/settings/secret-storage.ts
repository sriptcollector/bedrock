// app.secretStorage (obsidian API 1.11.4+): named secrets (API keys, passwords) that plugins can
// read by id. Like Obsidian they live on this computer only, encrypted with the operating
// system's key store (Electron safeStorage), never in the vault folder and never synced.
import { ipcRenderer } from "electron";
import { Events } from "../api/events";
import { SETTINGS_IPC } from "../../shared/ipc-settings";

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class SecretStorage extends Events {
  private secrets: Record<string, string> = {};
  private meta: Record<string, { lastAccess?: number }> = {};
  available = false;
  /** Saved secrets exist but couldn't be decrypted: the stored blob is kept as it is, never replaced. */
  locked = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(private app: any) {
    super();
  }

  async load(): Promise<void> {
    try {
      this.meta = JSON.parse(this.app.loadLocalStorage("secrets-meta") ?? "{}") ?? {};
    } catch {
      this.meta = {};
    }
    try {
      this.available = !!(await ipcRenderer.invoke(SETTINGS_IPC.secretsAvailable));
      const blob = this.app.loadLocalStorage("secrets");
      if (this.available && blob) {
        const plain = await ipcRenderer.invoke(SETTINGS_IPC.secretsDecrypt, blob);
        if (!plain) throw new Error("decryption failed");
        this.secrets = JSON.parse(plain);
      }
    } catch (e) {
      // Keep the blob: the OS key store may be unavailable right now (a new signature after an
      // update asks again), and overwriting it would lose every saved secret for good.
      console.error("Couldn't read saved secrets", e);
      this.secrets = {};
      this.locked = !!this.app.loadLocalStorage("secrets");
    }
  }

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  validateId(id: string): boolean {
    return typeof id === "string" && ID_RE.test(id);
  }

  private assertUnlocked(): void {
    if (this.locked) throw new Error("Saved secrets couldn't be unlocked on this computer, so they can't be changed right now. Restart the app and allow access to the keychain if asked.");
  }

  private persist(): void {
    const data = JSON.stringify(this.secrets);
    this.saving = this.saving.then(async () => {
      const enc = await ipcRenderer.invoke(SETTINGS_IPC.secretsEncrypt, data).catch(() => null);
      if (enc) this.app.saveLocalStorage("secrets", enc);
    });
    this.app.saveLocalStorage("secrets-meta", JSON.stringify(this.meta));
  }

  setSecret(id: string, secret: string): void {
    if (!this.available) throw new Error("Secure storage isn't available on this computer.");
    if (!this.validateId(id)) throw new Error("Secret names can only use lowercase letters, numbers and dashes.");
    this.assertUnlocked();
    this.secrets[id] = String(secret);
    this.meta[id] = this.meta[id] ?? {};
    this.persist();
    this.trigger("changed");
  }
  /** Read without marking it as accessed. */
  peekSecret(id: string): string | null {
    return this.secrets[id] ?? null;
  }
  getSecret(id: string): string | null {
    if (id in this.secrets) {
      this.meta[id] = { ...(this.meta[id] ?? {}), lastAccess: Date.now() };
      this.app.saveLocalStorage("secrets-meta", JSON.stringify(this.meta));
    }
    return this.peekSecret(id);
  }
  getLastAccess(id: string): number | null {
    return this.meta[id]?.lastAccess ?? null;
  }
  listSecrets(): string[] {
    return Object.keys(this.secrets).sort();
  }
  deleteSecret(id: string): void {
    this.assertUnlocked();
    delete this.secrets[id];
    delete this.meta[id];
    this.persist();
    this.trigger("changed");
  }
  /** Wait for pending writes (tests). */
  flush(): Promise<void> {
    return this.saving;
  }
}

/** SecretComponent (obsidian API): pick a secret by name; the setting stores the name only. */
export class SecretComponent {
  disabled = false;
  selectEl: HTMLSelectElement;
  private cb: ((v: string | null) => unknown) | null = null;
  constructor(private app: any, containerEl: HTMLElement) {
    this.selectEl = containerEl.createEl("select", "dropdown secret-component");
    this.fill("");
    this.selectEl.addEventListener("change", () => {
      if (this.selectEl.value === "__add") {
        this.app.setting?.openTabById?.("keychain");
        this.selectEl.value = "";
        return;
      }
      this.cb?.(this.selectEl.value || null);
    });
  }
  private fill(value: string): void {
    this.selectEl.empty();
    this.selectEl.createEl("option", { value: "", text: "Choose a secret" });
    for (const id of this.app?.secretStorage?.listSecrets?.() ?? []) this.selectEl.createEl("option", { value: id, text: id });
    this.selectEl.createEl("option", { value: "__add", text: "Add a secret in Keychain..." });
    this.selectEl.value = value;
  }
  then(cb: (c: this) => any): this {
    cb(this);
    return this;
  }
  setDisabled(d: boolean): this {
    this.disabled = d;
    this.selectEl.disabled = d;
    return this;
  }
  setValue(value: string): this {
    this.fill(value ?? "");
    return this;
  }
  onChange(cb: (value: string | null) => unknown): this {
    this.cb = cb;
    return this;
  }
}
