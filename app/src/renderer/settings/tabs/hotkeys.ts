// Settings › Hotkeys: every command with its hotkeys; filter by text or by pressing keys;
// All / Assigned / Assigned by me / Unassigned / Conflicts; add, delete, restore default.
// Changes go to .obsidian/hotkeys.json (only commands you changed; [] removes a default).
import { BuiltinTab } from "./base";
import { SettingGroup } from "../render";
import { Setting, SearchComponent } from "../../ui/setting";
import { setIcon } from "../../dom/icons";
import { eventModifiers, hotkeyLabel, modifiersToString, normaliseKey } from "../../commands/keymap";

type Filter = "all" | "assigned" | "mine" | "unassigned" | "conflicts";
export interface HK {
  modifiers: string[];
  key: string;
}

/** While a hotkey is being recorded, window-level key handlers (settings window, app) stand back. */
export function captureKeys(on: boolean): void {
  (window as any).__bedrockRecordingHotkey = on;
}
export const isCapturingKeys = (): boolean => !!(window as any).__bedrockRecordingHotkey;

export const hotkeyId =(h: HK) => modifiersToString(h.modifiers) + "|" + String(h.key).toUpperCase();

/** Map "mods|KEY" -> command ids, for conflict marks. */
export function findConflicts(commands: { id: string }[], effective: (id: string) => HK[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of commands) for (const h of effective(c.id)) {
    const k = hotkeyId(h);
    (m.get(k) ?? m.set(k, []).get(k)!).push(c.id);
  }
  for (const [k, ids] of m) if (ids.length < 2) m.delete(k);
  return m;
}

export class HotkeysTab extends BuiltinTab {
  private query = "";
  private keyQuery: HK | null = null;
  private filter: Filter = "all";
  private recording: { id: string; cleanup: () => void } | null = null;
  constructor(app: any) {
    super(app, "hotkeys", "Hotkeys", "command");
  }
  getSettingDefinitions(): any[] {
    // Searchable entries for the settings search (the list itself is drawn by display()).
    return Object.values(this.app.commands.commands as Record<string, any>).map((c) => ({ name: c.name, searchable: true, render: () => undefined }));
  }
  private effective(id: string): HK[] {
    const hm = this.app.hotkeyManager;
    return (hm.getHotkeys(id) ?? hm.getDefaultHotkeys(id) ?? []) as HK[];
  }
  hide(): void {
    this.recording?.cleanup();
    this.recording = null;
    super.hide();
  }
  display(): void {
    const el = this.containerEl;
    el.empty();
    const g = new SettingGroup(el).addClass("mod-list", "mod-hotkeys");
    let search!: SearchComponent;
    g.addSearch((c) => {
      search = c;
      c.containerEl.addClass("mod-hotkey");
      c.setPlaceholder("Filter...");
      c.setValue(this.query);
      c.onChange((v) => {
        this.query = v;
        this.keyQuery = null;
        renderList();
      });
    });
    const deco = search.containerEl.createDiv({ cls: "input-right-decorator clickable-icon", attr: { "aria-label": "Search by hotkey" } });
    setIcon(deco, "keyboard");
    deco.addEventListener("click", () => {
      deco.addClass("is-active");
      search.setValue("");
      search.setPlaceholder("Press a hotkey...");
      search.inputEl.focus();
      const doc = search.inputEl.ownerDocument;
      captureKeys(true);
      const onKey = (e: KeyboardEvent) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        captureKeys(false);
        doc.removeEventListener("keydown", onKey, true);
        deco.removeClass("is-active");
        search.setPlaceholder("Filter...");
        if (e.key === "Escape") return;
        this.keyQuery = { modifiers: eventModifiers(e), key: normaliseKey(e) };
        this.query = "";
        search.setValue(hotkeyLabel(this.keyQuery.modifiers as any, this.keyQuery.key));
        renderList();
      };
      doc.addEventListener("keydown", onKey, true);
    });
    const control = g.searchEl.createDiv("setting-group-search-control");
    const filters = control.createDiv("setting-group-filters");
    const list = g.listEl;

    const renderFilters = (conflicts: number) => {
      filters.empty();
      if (conflicts) {
        const f = filters.createDiv({ cls: "setting-group-filter mod-error" });
        f.createSpan({ text: "Conflicts" });
        f.createSpan({ cls: "setting-group-filter-badge", text: String(conflicts) });
        f.toggleClass("is-active", this.filter === "conflicts");
        f.addEventListener("click", () => {
          this.filter = "conflicts";
          renderList();
        });
      } else if (this.filter === "conflicts") this.filter = "all";
      const opts: [Filter, string][] = [
        ["all", "All"],
        ["assigned", "Assigned"],
        ["mine", "Assigned by me"],
        ["unassigned", "Unassigned"],
      ];
      for (const [k, label] of opts) {
        const f = filters.createDiv({ cls: "setting-group-filter", text: label });
        f.toggleClass("is-active", this.filter === k);
        f.addEventListener("click", () => {
          this.filter = k;
          renderList();
        });
      }
    };

    const renderList = () => {
      const hm = this.app.hotkeyManager;
      const all = Object.values(this.app.commands.commands as Record<string, any>).sort((a, b) => a.name.localeCompare(b.name));
      const conflicts = findConflicts(all, (id) => this.effective(id));
      const conflictIds = new Set([...conflicts.values()].flat());
      renderFilters(conflictIds.size);
      list.empty();
      const q = this.query.toLowerCase().trim();
      const kq = this.keyQuery ? hotkeyId(this.keyQuery) : null;
      let shown = 0;
      for (const c of all) {
        const keys = this.effective(c.id);
        const custom = hm.getHotkeys(c.id);
        if (q && !q.split(/\s+/).every((w) => c.name.toLowerCase().includes(w))) continue;
        if (kq && !keys.some((h) => hotkeyId(h) === kq)) continue;
        if (this.filter === "assigned" && !keys.length) continue;
        if (this.filter === "mine" && !custom) continue;
        if (this.filter === "unassigned" && keys.length) continue;
        if (this.filter === "conflicts" && !conflictIds.has(c.id)) continue;
        shown++;
        const s = new Setting(list).setName(c.name);
        s.descEl.remove();
        const hkEl = s.controlEl.createDiv("setting-command-hotkeys");
        if (!keys.length) hkEl.createSpan({ cls: "setting-hotkey mod-empty", text: "Blank" });
        keys.forEach((h, i) => {
          const chip = hkEl.createSpan({ cls: "setting-hotkey", text: hotkeyLabel(h.modifiers as any, h.key) });
          if (conflicts.has(hotkeyId(h))) {
            chip.addClass("has-conflict");
            chip.setAttr("aria-label", "This hotkey is also used by another command");
          }
          const del = chip.createSpan({ cls: "setting-hotkey-icon setting-delete-hotkey", attr: { "aria-label": "Delete hotkey" } });
          setIcon(del, "x");
          del.addEventListener("click", () => {
            hm.setHotkeys(c.id, keys.filter((_, j) => j !== i));
            renderList();
          });
        });
        if (custom) {
          const r = s.controlEl.createSpan({ cls: "clickable-icon setting-restore-hotkey-button", attr: { "aria-label": "Restore default" } });
          setIcon(r, "rotate-ccw");
          r.addEventListener("click", () => {
            hm.removeHotkeys(c.id);
            renderList();
          });
        }
        const add = s.controlEl.createSpan({ cls: "clickable-icon setting-add-hotkey-button", attr: { "aria-label": "Customize this command" } });
        setIcon(add, "plus-circle");
        add.addEventListener("click", () => this.record(c.id, hkEl, keys, renderList));
      }
      if (!shown) {
        const s = new Setting(list).setClass("mod-empty-state").setName("No commands found.");
        s.descEl.remove();
      }
    };
    renderList();
  }

  /** Wait for a key combination and add it to the command. */
  private record(id: string, hkEl: HTMLElement, keys: HK[], done: () => void): void {
    this.recording?.cleanup();
    const chip = hkEl.createSpan({ cls: "setting-hotkey mod-active", text: "Press hotkey..." });
    hkEl.querySelector(".mod-empty")?.remove();
    const doc = hkEl.ownerDocument;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        const mods = eventModifiers(e);
        chip.setText(mods.length ? hotkeyLabel(mods, "").replace(/\s*\+\s*$/, "") + " + ..." : "Press hotkey...");
        return;
      }
      cleanup();
      if (e.key === "Escape" && !eventModifiers(e).length) {
        done();
        return;
      }
      const hk = { modifiers: eventModifiers(e), key: normaliseKey(e) };
      if (!keys.some((k) => hotkeyId(k) === hotkeyId(hk))) this.app.hotkeyManager.setHotkeys(id, [...keys, hk]);
      done();
    };
    const onDown = (e: MouseEvent) => {
      if (!chip.contains(e.target as Node)) {
        cleanup();
        done();
      }
    };
    const cleanup = () => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("mousedown", onDown, true);
      this.recording = null;
      captureKeys(false);
    };
    captureKeys(true);
    doc.addEventListener("keydown", onKey, true);
    setTimeout(() => doc.addEventListener("mousedown", onDown, true));
    this.recording = { id, cleanup };
  }
}
