// Sync modals: version history (with diff and restore), deleted files (restore, empty), activity
// log, and the excluded-folders manager. Layout follows Obsidian's sync history / file recovery
// modals (list on the left, content with "Show changes", Copy and Restore on the right); our own
// code and wording.
import { Modal, FuzzySuggestModal } from "../ui/modal";
import { Notice } from "../ui/notice";
import { ToggleComponent } from "../ui/setting";
import { setIcon } from "../dom/icons";
import { baseName, dayGroup, formatBytes, formatTime, type SyncClient } from "./client";
import { changedSpan, diffLines } from "./diff";
import type { SyncContent, SyncLogEntry, SyncTrashItem, SyncVersion } from "../../shared/sync";

function renderText(el: HTMLElement, c: SyncContent | null, emptyMsg: string): void {
  el.empty();
  if (!c) {
    el.createDiv({ cls: "sync-history-content-empty", text: emptyMsg });
    return;
  }
  if (c.text === null) {
    el.createDiv({ cls: "sync-history-content-empty", text: `This file can't be shown here (${formatBytes(c.size)}). Restore it to open it.` });
    return;
  }
  if (c.text === "") {
    el.createDiv({ cls: "sync-history-content-empty", text: "This version is empty." });
    return;
  }
  el.createEl("pre", { cls: "sync-history-text", text: c.text });
}

/** Inline diff from `oldText` (the selected version) to `newText` (the note as it is now). */
export function renderDiff(el: HTMLElement, oldText: string, newText: string): void {
  el.empty();
  const ops = diffLines(oldText, newText);
  if (ops.every((o) => o.type === "eq")) {
    el.createDiv({ cls: "sync-history-content-empty", text: "This version is the same as the note now." });
    return;
  }
  const view = el.createDiv("diff-view sync-history-diff");
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const line = view.createDiv({ cls: "diff-line" + (o.type === "del" ? " mod-left" : o.type === "add" ? " mod-right" : "") });
    line.createSpan({ cls: "diff-sign", text: o.type === "del" ? "-" : o.type === "add" ? "+" : " " });
    // a removed line directly followed by an added one: highlight the part that changed
    const partner = o.type === "del" && ops[i + 1]?.type === "add" ? ops[i + 1].text : o.type === "add" && ops[i - 1]?.type === "del" ? ops[i - 1].text : null;
    if (partner !== null && o.text && partner) {
      const [pre, mid, post] = changedSpan(o.text, partner);
      line.appendText(pre);
      if (mid) line.createSpan({ cls: "diff-changed", text: mid });
      line.appendText(post);
    } else line.appendText(o.text || "​");
  }
}

// ---------------------------------------------------------------- version history

export class VersionHistoryModal extends Modal {
  private versions: SyncVersion[] = [];
  private selected: SyncVersion | null = null;
  private showChanges = false;
  private listEl: HTMLElement;
  private bodyEl: HTMLElement;
  private titleTextEl: HTMLElement;
  private restoreBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private current: SyncContent | null = null;
  private cache = new Map<number, Promise<SyncContent>>();

  constructor(
    app: any,
    private client: SyncClient,
    private path: string,
  ) {
    super(app);
    this.modalEl.addClass("mod-sync-history", "bedrock-sync-history");
    this.titleEl.detach();
    const wrap = this.contentEl.createDiv("sync-history");
    const left = wrap.createDiv("sync-history-sidebar");
    const head = left.createDiv("sync-history-file");
    setIcon(head.createSpan("sync-history-file-icon"), "file-text");
    head.createSpan({ cls: "sync-history-file-name", text: baseName(path), attr: { "aria-label": path } });
    this.listEl = left.createDiv("sync-history-list");
    const right = wrap.createDiv("sync-history-content-container");
    const bar = right.createDiv("modal-setting-titlebar");
    this.titleTextEl = bar.createDiv("modal-setting-title");
    const tg = bar.createDiv("modal-setting-titlebar-toggle");
    tg.createSpan({ text: "Show changes" });
    new ToggleComponent(tg).setValue(false).setTooltip("Compare this version with the note as it is now").onChange((v) => {
      this.showChanges = v;
      void this.renderBody();
    });
    const actions = bar.createDiv("modal-setting-titlebar-actions");
    this.copyBtn = actions.createEl("button", { text: "Copy" });
    this.restoreBtn = actions.createEl("button", { cls: "mod-cta", text: "Restore" });
    this.copyBtn.addEventListener("click", () => void this.copy());
    this.restoreBtn.addEventListener("click", () => void this.restore());
    this.bodyEl = right.createDiv("sync-history-content");
  }

  async onOpen(): Promise<void> {
    this.listEl.createDiv({ cls: "sync-history-loading", text: "Loading history…" });
    await this.load();
  }

  private async load(selectVersion?: number): Promise<void> {
    try {
      this.versions = await this.client.versions(this.path);
    } catch (e: any) {
      this.listEl.empty();
      this.listEl.createDiv({ cls: "sync-history-content-empty", text: `Can't load the history: ${e.message}` });
      this.bodyEl.empty();
      return;
    }
    this.cache.clear();
    this.current = null;
    this.renderList();
    const pick = this.versions.find((v) => v.version === selectVersion) ?? this.versions.find((v) => !v.deleted) ?? null;
    this.select(pick);
  }

  private renderList(): void {
    this.listEl.empty();
    if (!this.versions.length) {
      this.listEl.createDiv({ cls: "sync-history-content-empty", text: "No sync history for this file yet. It appears after the file has synced." });
      return;
    }
    let group = "";
    for (let i = 0; i < this.versions.length; i++) {
      const v = this.versions[i];
      const g = dayGroup(v.createdAt);
      if (g !== group) {
        group = g;
        this.listEl.createDiv({ cls: "sync-history-group", text: g });
      }
      const item = this.listEl.createDiv({ cls: "sync-history-list-item tappable", attr: { "data-version": String(v.version) } });
      const top = item.createDiv("sync-history-list-item-title");
      top.createSpan({ text: formatTime(v.createdAt) });
      if (v.current) top.createSpan({ cls: "sync-history-badge", text: "Current" });
      const meta = item.createDiv("sync-history-list-item-meta");
      if (v.deleted) meta.setText(`Deleted${v.device ? ` on ${v.device}` : ""}`);
      else meta.setText(`${formatBytes(v.size)}${v.device ? ` · ${v.device}` : ""}`);
      const older = this.versions[i + 1];
      if (older && older.path !== v.path && !v.deleted) item.createDiv({ cls: "sync-history-list-item-meta", text: `Renamed from “${baseName(older.path)}”` });
      item.addEventListener("click", () => this.select(v));
    }
  }

  private select(v: SyncVersion | null): void {
    this.selected = v;
    this.listEl.querySelectorAll(".sync-history-list-item").forEach((el) => el.toggleClass("is-active", !!v && el.getAttribute("data-version") === String(v.version)));
    this.titleTextEl.setText(v ? `${baseName(v.path)} · ${formatTime(v.createdAt)}` : baseName(this.path));
    const can = !!v && !v.deleted;
    this.restoreBtn.disabled = !can;
    this.copyBtn.disabled = !can;
    void this.renderBody();
  }

  private content(v: SyncVersion): Promise<SyncContent> {
    let p = this.cache.get(v.version);
    if (!p) {
      p = this.client.versionContent(this.path, v.version);
      this.cache.set(v.version, p);
      p.catch(() => this.cache.delete(v.version));
    }
    return p;
  }

  private async currentText(): Promise<SyncContent | null> {
    if (this.current) return this.current;
    try {
      const text = await this.app.vault.adapter.read(this.path);
      this.current = { text, size: text.length };
    } catch {
      this.current = null;
    }
    return this.current;
  }

  private async renderBody(): Promise<void> {
    const v = this.selected;
    if (!v) {
      renderText(this.bodyEl, null, this.versions.length ? "Pick a version on the left." : "Nothing to show yet.");
      return;
    }
    if (v.deleted) {
      renderText(this.bodyEl, null, `The file was deleted at this point${v.device ? ` (on ${v.device})` : ""}. Pick an earlier version to see or restore it.`);
      return;
    }
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: "sync-history-loading", text: "Loading…" });
    let c: SyncContent;
    try {
      c = await this.content(v);
    } catch (e: any) {
      renderText(this.bodyEl, null, `Can't load this version: ${e.message}`);
      return;
    }
    if (this.selected !== v) return;
    if (this.showChanges && c.text !== null) {
      const cur = await this.currentText();
      if (this.selected !== v) return;
      if (cur?.text != null) return renderDiff(this.bodyEl, c.text, cur.text);
    }
    renderText(this.bodyEl, c, "");
  }

  private async copy(): Promise<void> {
    const v = this.selected;
    if (!v) return;
    const c = await this.content(v);
    if (c.text === null) return void new Notice("Only text can be copied.");
    await navigator.clipboard.writeText(c.text);
    new Notice("Copied to the clipboard.");
  }

  private async restore(): Promise<void> {
    const v = this.selected;
    if (!v || v.deleted) return;
    if (v.current) return void new Notice("This version is already the current one.");
    this.restoreBtn.disabled = true;
    try {
      await this.client.restoreVersion(this.path, v.version);
      new Notice(`Restored the version from ${formatTime(v.createdAt)}.`);
      await this.load();
    } catch (e: any) {
      new Notice(`Couldn't restore: ${e.message}`);
      this.restoreBtn.disabled = false;
    }
  }
}

// ---------------------------------------------------------------- deleted files

export class DeletedFilesModal extends Modal {
  private items: SyncTrashItem[] = [];
  private chosen = new Set<string>();
  private active: SyncTrashItem | null = null;
  private query = "";
  private listEl: HTMLElement;
  private bodyEl: HTMLElement;
  private titleTextEl: HTMLElement;
  private restoreBtn: HTMLButtonElement;
  private bulkBtn: HTMLButtonElement;
  private emptyBtn: HTMLButtonElement;

  constructor(
    app: any,
    private client: SyncClient,
  ) {
    super(app);
    this.modalEl.addClass("mod-sync-history", "bedrock-sync-deleted");
    this.titleEl.detach();
    const wrap = this.contentEl.createDiv("sync-history");
    const left = wrap.createDiv("sync-history-sidebar");
    const head = left.createDiv("sync-history-file");
    setIcon(head.createSpan("sync-history-file-icon"), "trash-2");
    head.createSpan({ cls: "sync-history-file-name", text: "Deleted files" });
    const search = left.createDiv("search-input-container").createEl("input", { type: "search", placeholder: "Search deleted files…" });
    search.addEventListener("input", () => {
      this.query = search.value.toLowerCase();
      this.renderList();
    });
    this.listEl = left.createDiv("sync-history-list");
    const foot = left.createDiv("sync-history-footer");
    this.bulkBtn = foot.createEl("button", { text: "Restore files" });
    this.emptyBtn = foot.createEl("button", { cls: "mod-warning", text: "Empty" });
    this.emptyBtn.setAttr("aria-label", "Permanently delete these files and their history to free up space");
    this.bulkBtn.addEventListener("click", () => void this.restoreMany([...this.chosen]));
    this.emptyBtn.addEventListener("click", () => void this.empty());
    const right = wrap.createDiv("sync-history-content-container");
    const bar = right.createDiv("modal-setting-titlebar");
    this.titleTextEl = bar.createDiv("modal-setting-title");
    const actions = bar.createDiv("modal-setting-titlebar-actions");
    this.restoreBtn = actions.createEl("button", { cls: "mod-cta", text: "Restore" });
    this.restoreBtn.addEventListener("click", () => this.active && void this.restoreMany([this.active.fileId]));
    this.bodyEl = right.createDiv("sync-history-content");
  }

  async onOpen(): Promise<void> {
    this.listEl.createDiv({ cls: "sync-history-loading", text: "Loading deleted files…" });
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.items = (await this.client.trash()).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    } catch (e: any) {
      this.listEl.empty();
      this.listEl.createDiv({ cls: "sync-history-content-empty", text: `Can't load deleted files: ${e.message}` });
      return;
    }
    this.chosen = new Set([...this.chosen].filter((id) => this.items.some((i) => i.fileId === id)));
    this.renderList();
    this.show(this.items.find((i) => i.fileId === this.active?.fileId) ?? this.items[0] ?? null);
  }

  private renderList(): void {
    this.listEl.empty();
    const shown = this.items.filter((i) => !this.query || i.path.toLowerCase().includes(this.query));
    if (!this.items.length) this.listEl.createDiv({ cls: "sync-history-content-empty", text: "No deleted files. Files you delete stay here for 90 days." });
    let group = "";
    for (const it of shown) {
      const g = dayGroup(it.deletedAt);
      if (g !== group) {
        group = g;
        this.listEl.createDiv({ cls: "sync-history-group", text: g });
      }
      const row = this.listEl.createDiv({ cls: "sync-history-list-item tappable", attr: { "data-file-id": it.fileId } });
      const top = row.createDiv("sync-history-list-item-title");
      const cb = top.createEl("input", { type: "checkbox" });
      cb.checked = this.chosen.has(it.fileId);
      cb.disabled = !it.restorable;
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        cb.checked ? this.chosen.add(it.fileId) : this.chosen.delete(it.fileId);
        this.updateButtons();
      });
      top.createSpan({ cls: "sync-history-list-item-path", text: it.path });
      row.createDiv({ cls: "sync-history-list-item-meta", text: `Deleted ${formatTime(it.deletedAt)}${it.device ? ` on ${it.device}` : ""}${it.restorable ? "" : " · too old to restore"}` });
      row.addEventListener("click", () => this.show(it));
    }
    this.updateButtons();
  }

  private updateButtons(): void {
    const n = this.chosen.size;
    this.bulkBtn.setText(n ? `Restore ${n} file${n === 1 ? "" : "s"}` : "Restore files");
    this.bulkBtn.disabled = n === 0;
    this.bulkBtn.toggleClass("mod-cta", n > 0);
    this.emptyBtn.disabled = this.items.length === 0;
    this.listEl.querySelectorAll(".sync-history-list-item").forEach((el) => el.toggleClass("is-active", el.getAttribute("data-file-id") === this.active?.fileId));
  }

  private async show(it: SyncTrashItem | null): Promise<void> {
    this.active = it;
    this.updateButtons();
    this.titleTextEl.setText(it ? it.path : "");
    this.restoreBtn.disabled = !it?.restorable;
    if (!it) return renderText(this.bodyEl, null, "Pick a file on the left to see it.");
    if (!it.restorable) return renderText(this.bodyEl, null, "This file was deleted too long ago to restore.");
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: "sync-history-loading", text: "Loading…" });
    try {
      const c = await this.client.trashContent(it.fileId, it.path);
      if (this.active === it) renderText(this.bodyEl, c, "");
    } catch (e: any) {
      if (this.active === it) renderText(this.bodyEl, null, `Can't load this file: ${e.message}`);
    }
  }

  private async restoreMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    this.restoreBtn.disabled = true;
    this.bulkBtn.disabled = true;
    let ok = 0;
    let failed = 0;
    const places: string[] = [];
    for (const id of ids) {
      try {
        places.push(await this.client.restoreTrash(id));
        ok++;
      } catch {
        failed++;
      }
      this.chosen.delete(id);
    }
    new Notice(
      ok === 1 && !failed ? `Restored “${places[0]}”.` : `Restored ${ok} file${ok === 1 ? "" : "s"}${failed ? `; ${failed} couldn't be restored` : ""}.`,
    );
    await this.load();
  }

  private async empty(): Promise<void> {
    const ids = this.chosen.size ? [...this.chosen] : undefined;
    const n = ids?.length ?? this.items.length;
    const yes = await this.app.ui.confirm({
      title: "Empty deleted files",
      body: `Permanently delete ${n === this.items.length ? "all " : ""}${n} deleted file${n === 1 ? "" : "s"} and their history from your Toolbay account? This frees up space and can't be undone. Files in your vault aren't touched.`,
      cta: "Delete permanently",
      danger: true,
    });
    if (!yes) return;
    try {
      const r = await this.client.emptyTrash(ids);
      new Notice(`Deleted permanently. Freed ${formatBytes(r.freedBytes)}.`);
      this.chosen.clear();
      await this.load();
    } catch (e: any) {
      new Notice(`Couldn't empty: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------- activity log

const ACTION_TEXT: Record<SyncLogEntry["action"], string> = {
  upload: "Uploaded",
  download: "Downloaded",
  delete: "Deleted",
  rename: "Moved",
  merge: "Merged changes",
  kept: "Kept (edited here, deleted elsewhere)",
  conflict: "Conflict, both kept",
  error: "Problem",
  info: "",
};

export function logLine(e: SyncLogEntry): string {
  if (e.action === "info") return `${e.message ?? ""}${e.path ? ` (${e.path})` : ""}`;
  if (e.action === "error") return `${e.path ? `${e.path}: ` : ""}${e.message ?? "Sync problem"}`;
  if (e.action === "rename") return `${ACTION_TEXT.rename} ${e.from ?? "?"} → ${e.path}`;
  if (e.action === "conflict") return `${ACTION_TEXT.conflict}: ${e.path} and ${e.from}`;
  return `${ACTION_TEXT[e.action]} ${e.path}`;
}

export class ActivityLogModal extends Modal {
  private filter: "all" | "errors" | "conflicts" = "all";
  private entries: SyncLogEntry[] = [];
  private listEl: HTMLElement;
  private off: (() => void) | null = null;

  constructor(
    app: any,
    private client: SyncClient,
  ) {
    super(app);
    this.modalEl.addClass("mod-sync-log", "bedrock-sync-log");
    this.setTitle("Sync activity");
    const bar = this.contentEl.createDiv("sync-log-toolbar");
    const sel = bar.createEl("select", { cls: "dropdown" });
    for (const [v, t] of [
      ["all", "All"],
      ["errors", "Problems"],
      ["conflicts", "Conflicts"],
    ])
      sel.createEl("option", { value: v, text: t });
    sel.addEventListener("change", () => {
      this.filter = sel.value as any;
      this.render();
    });
    const copy = bar.createEl("button", { text: "Copy log" });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.visible().map((e) => `${new Date(e.time).toISOString()}  ${logLine(e)}`).join("\n"));
      new Notice("Copied the activity log.");
    });
    this.listEl = this.contentEl.createDiv("sync-log-container");
  }

  async onOpen(): Promise<void> {
    this.entries = await this.client.log().catch(() => []);
    this.render();
    this.off = this.client.onEvent((ev) => {
      if (ev.type === "log") {
        this.entries.push(ev.entry);
        this.render();
      }
    });
  }

  onClose(): void {
    this.off?.();
  }

  private visible(): SyncLogEntry[] {
    return this.entries.filter((e) => this.filter === "all" || (this.filter === "errors" ? e.action === "error" : e.action === "conflict"));
  }

  private render(): void {
    this.listEl.empty();
    const shown = this.visible().slice(-500).reverse();
    if (!shown.length) {
      this.listEl.createDiv({ cls: "sync-history-content-empty", text: this.filter === "all" ? "Nothing has synced yet." : "Nothing here." });
      return;
    }
    for (const e of shown) {
      const row = this.listEl.createDiv({ cls: `sync-log-item mod-${e.action}` });
      row.createSpan({ cls: "sync-log-time", text: formatTime(e.time) });
      row.createSpan({ cls: "sync-log-text", text: logLine(e) });
    }
  }
}

// ---------------------------------------------------------------- excluded folders

class FolderSuggest extends FuzzySuggestModal<string> {
  constructor(
    app: any,
    private folders: string[],
    private onPick: (f: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Pick a folder to stop syncing on this computer…");
  }
  getItems(): string[] {
    return this.folders;
  }
  getItemText(f: string): string {
    return f;
  }
  onChooseItem(f: string): void {
    this.onPick(f);
  }
}

export class ExcludedFoldersModal extends Modal {
  constructor(
    app: any,
    private client: SyncClient,
  ) {
    super(app);
    this.modalEl.addClass("bedrock-sync-excluded");
    this.setTitle("Excluded folders");
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Files in these folders stay on this computer and don't sync. Nothing is deleted on your other computers.",
    });
    const list = el.createDiv("sync-excluded-list");
    const folders = this.client.snapshot?.settings.excludedFolders ?? [];
    if (!folders.length) list.createDiv({ cls: "sync-history-content-empty", text: "No folders are excluded." });
    for (const f of folders) {
      const row = list.createDiv("sync-exclude-folder");
      setIcon(row.createSpan("sync-exclude-folder-icon"), "folder");
      row.createSpan({ cls: "sync-exclude-folder-name", text: f });
      const x = row.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Sync this folder again" } });
      setIcon(x, "x");
      x.addEventListener("click", async () => {
        await this.client.setSettings({ excludedFolders: folders.filter((g) => g !== f) });
        this.render();
      });
    }
    const btns = this.modalEl.querySelector(".modal-button-container") ?? this.modalEl.createDiv("modal-button-container");
    btns.empty();
    const add = btns.createEl("button", { cls: "mod-cta", text: "Exclude a folder" });
    add.addEventListener("click", () => {
      const all: string[] = this.app.vault
        .getAllFolders?.(false)
        ?.map((f: any) => f.path)
        .filter((p: string) => p && p !== "/" && !folders.includes(p))
        .sort() ?? [];
      new FolderSuggest(this.app, all, async (f) => {
        await this.client.setSettings({ excludedFolders: [...folders, f] });
        this.render();
      }).open();
    });
  }
}
