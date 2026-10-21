// Declarative settings (obsidian.d.ts 1.13+): SettingGroup, SettingPage and the renderer that
// turns `getSettingDefinitions()` items into rows. Our own built-in tabs are written with the
// same definitions, which also feeds the settings search.
import { setIcon } from "../dom/icons";
import { Setting, SearchComponent, ExtraButtonComponent, type BaseComponent } from "../ui/setting";
import { FileSuggest, FolderSuggest } from "./suggest";
import { FilePickerModal } from "./file-picker";

export class SettingGroup {
  groupEl: HTMLElement;
  headingEl: HTMLElement | null = null;
  headingSetting: Setting | null = null;
  searchEl: HTMLElement;
  listEl: HTMLElement;
  private headerControlEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement) {
    this.groupEl = containerEl.createDiv("setting-group");
    this.searchEl = this.groupEl.createDiv("setting-group-search");
    this.listEl = this.groupEl.createDiv("setting-items");
  }
  private ensureHeading(): Setting {
    if (!this.headingSetting) {
      const s = new Setting(this.groupEl).setHeading();
      this.groupEl.insertBefore(s.settingEl, this.groupEl.firstChild);
      this.headingSetting = s;
      this.headingEl = s.settingEl;
      this.headerControlEl = s.controlEl;
    }
    return this.headingSetting;
  }
  setHeading(text: string | DocumentFragment): this {
    this.ensureHeading().setName(text);
    return this;
  }
  addClass(...classes: string[]): this {
    this.groupEl.addClasses(classes);
    return this;
  }
  addSetting(cb: (setting: Setting) => void): this {
    cb(new Setting(this.listEl));
    return this;
  }
  addSearch(cb: (component: SearchComponent) => any): this {
    const c = new SearchComponent(this.searchEl);
    cb(c);
    return this;
  }
  addExtraButton(cb: (component: ExtraButtonComponent) => any): this {
    this.ensureHeading();
    cb(new ExtraButtonComponent(this.headerControlEl!));
    return this;
  }
}

export abstract class SettingPage {
  rootEl: HTMLElement;
  titlebarEl: HTMLElement;
  containerEl: HTMLElement;
  title = "";
  backButtonEl: HTMLElement;
  titleEl: HTMLElement;
  constructor() {
    this.rootEl = createDiv("setting-page vertical-tab-content");
    this.titlebarEl = this.rootEl.createDiv("setting-page-titlebar");
    this.backButtonEl = this.titlebarEl.createDiv({ cls: "clickable-icon setting-page-back-button", attr: { "aria-label": "Back" } });
    setIcon(this.backButtonEl, "chevron-left");
    this.titleEl = this.titlebarEl.createDiv("setting-page-title");
    this.containerEl = this.rootEl.createDiv("setting-page-content");
  }
  abstract display(): void;
  hide(): void {
    this.containerEl.empty();
  }
}

/** A page built from inline definitions (`{type: "page", items}`). */
export class DefinitionPage extends SettingPage {
  constructor(private tab: any, private def: any) {
    super();
    this.title = def.name;
  }
  display(): void {
    this.containerEl.empty();
    const items = typeof this.def.items === "function" ? this.def.items() : this.def.items ?? [];
    renderDefinitions(this.tab, items, this.containerEl);
  }
}

// ---------------------------------------------------------------- rendering
const evalBool = (v: any, dflt = true): boolean => (v === undefined ? dflt : typeof v === "function" ? !!v() : !!v);

interface Bound {
  def: any;
  el: HTMLElement;
  setting?: Setting;
}

/** Live render state for a tab, so refreshDomState() can re-apply visible/disabled. */
const boundByTab = new WeakMap<object, Bound[]>();

export function refreshDomState(tab: object): void {
  for (const b of boundByTab.get(tab) ?? []) {
    b.el.toggle(evalBool(b.def.visible));
    const dis = b.def.control ? evalBool(b.def.control.disabled, false) : evalBool(b.def.disabled, false);
    if (b.setting) b.setting.setDisabled(dis);
  }
}

const isGroup = (d: any) => d && (d.type === "group" || d.type === "list");

/** Render definitions into containerEl (a tab's containerEl or a page's content). */
export function renderDefinitions(tab: any, items: any[], containerEl: HTMLElement): void {
  const bound: Bound[] = boundByTab.get(tab) ?? [];
  if (containerEl === tab.containerEl) bound.length = 0;
  boundByTab.set(tab, bound);
  let implicit: SettingGroup | null = null;
  for (const item of items) {
    if (!item) continue;
    if (isGroup(item)) {
      implicit = null;
      if (!evalBool(item.visible)) continue;
      renderGroup(tab, item, containerEl, bound);
      continue;
    }
    if (!implicit) implicit = new SettingGroup(containerEl);
    renderItem(tab, item, implicit, bound, -1);
  }
}

function renderGroup(tab: any, def: any, containerEl: HTMLElement, bound: Bound[]): SettingGroup {
  const g = new SettingGroup(containerEl);
  if (def.type === "list") g.addClass("mod-list", "mod-no-icon");
  if (def.cls) g.addClass(...String(def.cls).split(" ").filter(Boolean));
  if (def.heading) g.setHeading(def.heading);
  for (const cb of def.extraButtons ?? []) g.addExtraButton(cb);
  if (def.addItem) {
    g.addExtraButton((b: ExtraButtonComponent) =>
      b
        .setIcon("plus")
        .setTooltip(def.addItem.name)
        .onClick(() => def.addItem.action(b.extraSettingsEl)),
    );
  }
  const rows: { def: any; el: HTMLElement }[] = [];
  const children: any[] = def.items ?? [];
  children.forEach((child, i) => {
    const el = renderItem(tab, child, g, bound, i, def);
    if (el) rows.push({ def: child, el });
  });
  if (!children.length && def.emptyState) {
    const s = new Setting(g.listEl).setClass("mod-empty-state");
    s.setName(def.emptyState);
    s.descEl.remove();
  }
  if (def.search) {
    let query = (tab as any).__groupQueries?.[def.heading ?? ""] ?? "";
    g.addSearch((c) => {
      c.setPlaceholder(def.search.placeholder ?? "Search...");
      c.setValue(query);
      const apply = () => {
        query = c.getValue();
        ((tab as any).__groupQueries ??= {})[def.heading ?? ""] = query;
        for (const r of rows) {
          if (r.def.searchable === false) continue;
          r.el.toggle(!query || def.search.match(r.def, query.toLowerCase()));
        }
      };
      c.onChange(apply);
      apply();
    });
  }
  return g;
}

function renderItem(tab: any, def: any, group: SettingGroup, bound: Bound[], index: number, parent?: any): HTMLElement | null {
  if (!evalBool(def.visible)) return null;
  const s = new Setting(group.listEl);
  const el = s.settingEl;
  bound.push({ def, el, setting: s });
  if (def.type === "page") {
    el.addClass("mod-navigable", "tappable");
    s.setName(def.name);
    if (def.desc) s.setDesc(def.desc);
    const dv = typeof def.displayValue === "function" ? def.displayValue() : def.displayValue;
    if (dv) s.controlEl.createDiv({ cls: "setting-item-value", text: dv });
    const st = typeof def.status === "function" ? def.status() : def.status;
    if (st === "warning") el.addClass("mod-warning");
    setIcon(s.controlEl.createDiv("setting-item-chevron"), "chevron-right");
    el.addEventListener("click", () => tab.app?.setting?.openPage?.(def.page ? def.page() : new DefinitionPage(tab, def)));
    return el;
  }
  s.setName(def.name ?? "");
  if (def.desc) s.setDesc(def.desc);
  if (def.render) {
    const cleanup = def.render(s, group);
    if (typeof cleanup === "function") (tab.__cleanups ??= []).push(cleanup);
  } else if (def.action) {
    el.addClass("mod-clickable", "tappable");
    el.addEventListener("click", () => !el.hasClass("is-disabled") && def.action(el, index));
  } else if (def.control) {
    renderControl(tab, s, def.control);
  }
  if (parent?.type === "list") {
    if (parent.onDelete) {
      s.addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip("Delete")
          .onClick(() => parent.onDelete(index)),
      );
    }
  }
  const dis = def.control ? evalBool(def.control.disabled, false) : evalBool(def.disabled, false);
  if (dis) s.setDisabled(true);
  return el;
}

function renderControl(tab: any, s: Setting, c: any): void {
  const get = () => {
    const v = tab.getControlValue(c.key);
    return v === undefined || v === null ? c.defaultValue : v;
  };
  const errEl = () => {
    let e = s.infoEl.querySelector(".setting-item-error") as HTMLElement | null;
    if (!e) e = s.infoEl.createDiv("setting-item-error");
    return e;
  };
  const commit = async (v: any) => {
    if (c.validate) {
      const msg = await c.validate(v);
      if (msg) {
        errEl().setText(String(msg));
        s.settingEl.addClass("has-error");
        return;
      }
      s.infoEl.querySelector(".setting-item-error")?.remove();
      s.settingEl.removeClass("has-error");
    }
    await tab.setControlValue(c.key, v);
    tab.refreshDomState?.();
  };
  const runInitialValidate = async () => {
    if (!c.validate) return;
    const msg = await c.validate(get());
    if (msg) {
      errEl().setText(String(msg));
      s.settingEl.addClass("has-error");
    }
  };
  switch (c.type) {
    case "toggle":
      s.addToggle((t) => t.setValue(!!get()).onChange(commit));
      break;
    case "dropdown":
      s.addDropdown((d) => d.addOptions(c.options ?? {}).setValue(String(get() ?? "")).onChange(commit));
      break;
    case "text":
      s.addText((t) => {
        t.setValue(get() ?? "");
        if (c.placeholder) t.setPlaceholder(c.placeholder);
        t.onChange(commit);
      });
      break;
    case "textarea":
      s.addTextArea((t) => {
        t.setValue(get() ?? "");
        if (c.placeholder) t.setPlaceholder(c.placeholder);
        if (c.rows) t.inputEl.rows = c.rows;
        t.onChange(commit);
      });
      break;
    case "number":
      s.addText((t) => {
        t.inputEl.type = "number";
        if (c.min !== undefined) t.inputEl.min = String(c.min);
        if (c.max !== undefined) t.inputEl.max = String(c.max);
        if (c.step !== undefined) t.inputEl.step = String(c.step);
        t.setValue(String(get() ?? ""));
        if (c.placeholder) t.setPlaceholder(c.placeholder);
        t.onChange((v) => {
          const n = parseFloat(v);
          commit(Number.isFinite(n) ? n : c.defaultValue ?? 0);
        });
      });
      break;
    case "slider":
      s.addSlider((sl) => {
        sl.setLimits(c.min, c.max, c.step).setValue(Number(get() ?? c.min));
        const fmt = c.displayFormat ?? ((v: number) => String(v));
        const valEl = s.controlEl.createSpan({ cls: "slider-value", text: fmt(sl.getValue()) });
        s.controlEl.insertBefore(valEl, sl.sliderEl);
        if (!valEl.textContent) valEl.hide();
        sl.onChange((v) => {
          valEl.setText(fmt(v));
          commit(v);
        });
      });
      break;
    case "color":
      s.settingEl.addClass("mod-toggle");
      s.addColorPicker((cp) => cp.setValue(get() || "#000000").onChange(commit));
      break;
    case "file":
      fileCombobox(tab.app, s.controlEl, get() ?? "", c.placeholder ?? "No file selected", c.filter, (v) => commit(v));
      break;
    case "folder":
      s.addText((t) => {
        t.setValue(get() ?? "");
        if (c.placeholder) t.setPlaceholder(c.placeholder);
        new FolderSuggest(tab.app, t.inputEl, c.filter, c.includeRoot).onSelect((v) => t.setValue(v));
        t.onChange(commit);
      });
      break;
    case "secret":
      s.addText((t) => {
        const app = tab.app;
        t.setPlaceholder("Choose a secret");
        t.setValue(get() ?? "");
        new SecretSuggest(app, t.inputEl).onSelect((v) => t.setValue(v));
        t.onChange(commit);
      });
      break;
  }
  void runInitialValidate();
}

/** "File to open" / "Template file location": a combobox button that opens a file picker. */
export function fileCombobox(app: any, parent: HTMLElement, value: string, placeholder: string, filter: ((f: any) => boolean) | undefined, onChange: (v: string) => void): HTMLElement {
  const box = parent.createDiv({ cls: "combobox-button mod-file", attr: { tabindex: "0" } });
  const iconEl = box.createDiv("combobox-button-icon");
  iconEl.hide();
  const label = box.createDiv({ cls: "combobox-button-label", attr: { placeholder } });
  const clear = box.createDiv("combobox-clear-button");
  setIcon(clear, "x");
  setIcon(box.createDiv("combobox-button-chevron"), "chevrons-up-down");
  const show = (v: string) => {
    label.setText(v ? v.replace(/\.md$/, "") : "");
    box.toggleClass("has-value", !!v);
    clear.toggle(!!v);
  };
  show(value);
  clear.addEventListener("click", (e) => {
    e.stopPropagation();
    show("");
    onChange("");
  });
  const pick = () => {
    new FilePickerModal(app, filter, (f: any) => {
      show(f.path);
      onChange(f.path);
    }).open();
  };
  box.addEventListener("click", pick);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick();
    }
  });
  return box;
}

class SecretSuggest extends FileSuggest {
  getSuggestions(q: string): string[] {
    const ids: string[] = this.app.secretStorage?.listSecrets?.() ?? [];
    return ids.filter((i) => i.toLowerCase().includes(q.toLowerCase()));
  }
}

/** Flatten definitions for search: [{name, desc, aliases, pagePath}] */
export interface SearchEntry {
  name: string;
  desc: string;
  aliases: string[];
  group: string | null;
  pages: string[];
}
export function indexDefinitions(items: any[], group: string | null = null, pages: string[] = [], out: SearchEntry[] = []): SearchEntry[] {
  for (const it of items ?? []) {
    if (!it) continue;
    if (isGroup(it)) {
      if (it.visible === false) continue;
      indexDefinitions(it.items ?? [], it.heading ?? null, pages, out);
      continue;
    }
    const searchable = it.searchable === undefined ? true : typeof it.searchable === "function" ? it.searchable() : it.searchable;
    if (!searchable || it.visible === false) continue;
    const desc = typeof it.desc === "string" ? it.desc : it.desc?.textContent ?? "";
    out.push({ name: it.name ?? "", desc, aliases: it.aliases ?? [], group, pages });
    if (it.type === "page" && Array.isArray(it.items)) indexDefinitions(it.items, null, [...pages, it.name], out);
  }
  return out;
}

export type { BaseComponent };
