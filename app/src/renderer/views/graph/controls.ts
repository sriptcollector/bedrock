// The graph settings panel (Filters, Groups, Display, Forces), built on the DOM classes themes target:
// .graph-controls, .graph-control-section.mod-*, .tree-item-self, .setting-item.mod-toggle/.mod-slider,
// .graph-color-group, .slider-value.
import { setIcon } from "../../dom/icons";
import {
  DISPLAY_DEFAULTS,
  FILTER_DEFAULTS,
  FORCE_DEFAULTS,
  LOCAL_FILTER_DEFAULTS,
  hexToInt,
  intToHex,
  newGroupColor,
  type ColorGroup,
  type GraphOptions,
} from "./options";

export interface ControlsHost {
  local: boolean;
  options: GraphOptions;
  isDark(): boolean;
  /** An option changed: re-render (if needed) and save. */
  onOption(key: string, value: any, rerender: "data" | "render" | "forces" | "search" | "none"): void;
  onReset(): void;
  onAnimate(): void;
  onSave(): void;
}

type Listener = (v?: any) => any;

class Section {
  el: HTMLElement;
  selfEl: HTMLElement;
  iconEl: HTMLElement;
  childrenEl: HTMLElement;
  collapsed = true;
  constructor(parent: HTMLElement, public id: string, title: string, private onToggle: (c: boolean) => void) {
    this.el = parent.createDiv(`tree-item graph-control-section mod-${id}`);
    this.selfEl = this.el.createDiv("tree-item-self mod-collapsible");
    this.iconEl = this.selfEl.createDiv("tree-item-icon collapse-icon");
    setIcon(this.iconEl, "right-triangle");
    this.selfEl.createDiv("tree-item-inner").createEl("header", { cls: "graph-control-section-header", text: title });
    this.childrenEl = this.el.createDiv("tree-item-children");
    this.selfEl.addEventListener("click", () => {
      this.setCollapsed(!this.collapsed);
      this.onToggle(this.collapsed);
    });
  }
  setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.el.toggleClass("is-collapsed", c);
    this.iconEl.toggleClass("is-collapsed", c);
  }
}

function settingRow(parent: HTMLElement, name: string, cls: string, tooltip?: string): { el: HTMLElement; control: HTMLElement } {
  const el = parent.createDiv({ cls: "setting-item" + (cls ? " " + cls : ""), attr: { tabindex: "-1" } });
  const info = el.createDiv("setting-item-info");
  const nameEl = info.createDiv({ cls: "setting-item-name", text: name });
  if (tooltip) nameEl.setAttr("aria-label", tooltip);
  info.createDiv("setting-item-description");
  const control = el.createDiv("setting-item-control");
  return { el, control };
}

function formatSlider(v: number, step: number | "any"): string {
  return step !== "any" && Number.isInteger(step) ? String(Math.round(v)) : v.toFixed(2);
}

export class GraphControls {
  el: HTMLElement;
  private listeners: Record<string, Listener> = {};
  private sections: Record<string, Section> = {};
  searchInput: HTMLInputElement;
  private searchContainer: HTMLElement;
  private groupsEl: HTMLElement;
  private groupRows: { el: HTMLElement; query: HTMLInputElement; color: HTMLInputElement }[] = [];

  constructor(parent: HTMLElement, private host: ControlsHost) {
    const el = (this.el = parent.createDiv({ cls: "graph-controls", attr: { "data-ignore-swipe": "true" } }));
    const btn = (cls: string, icon: string, label: string, cb: () => void) => {
      const b = el.createDiv({ cls: `clickable-icon graph-controls-button ${cls}`, attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", cb);
      return b;
    };
    btn("mod-close", "x", "Close", () => {
      el.addClass("is-close");
      host.onSave();
    });
    btn("mod-open", "settings", "Open graph settings", () => {
      el.removeClass("is-close");
      host.onSave();
    });
    if (!host.local) btn("mod-animate", "wand-2", "Play timelapse", () => host.onAnimate());
    btn("mod-reset", "rotate-ccw", "Restore default settings", () => host.onReset());

    // Filters
    const filter = this.section("filter", "Filters");
    const search = settingRow(filter.childrenEl, "", "mod-search-setting");
    this.searchContainer = search.control.createDiv("search-input-container");
    this.searchInput = this.searchContainer.createEl("input", { type: "search", attr: { enterkeyhint: "search", spellcheck: "false", placeholder: "Search files..." } });
    const clear = this.searchContainer.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "Clear search" } });
    clear.addEventListener("click", () => {
      this.searchInput.value = "";
      this.onSearchInput();
      this.searchInput.focus();
    });
    this.searchInput.addEventListener("input", () => this.onSearchInput());
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) host.onOption("search", this.searchInput.value, "search");
    });
    this.listeners.search = (v) => {
      if (typeof v === "string") {
        this.searchInput.value = v;
        this.searchContainer.toggleClass("has-value", !!v);
      }
      return this.searchInput.value;
    };
    if (host.local) {
      this.slider(filter.childrenEl, "Depth", "localJumps", 1, 5, 1, "data", "mod-local-jumps", "How many links away from this note to show");
      this.toggle(filter.childrenEl, "Incoming links", "localBacklinks", "data", "Show notes that link to this one");
      this.toggle(filter.childrenEl, "Outgoing links", "localForelinks", "data", "Show notes this one links to");
      this.toggle(filter.childrenEl, "Neighbor links", "localInterlinks", "data", "Also show links between the notes around this one");
    }
    this.toggle(filter.childrenEl, "Tags", "showTags", "data", "Show tags as their own nodes, linked to the notes that use them");
    this.toggle(filter.childrenEl, "Attachments", "showAttachments", "data", "Show images, PDFs and other files");
    this.toggle(filter.childrenEl, "Existing files only", "hideUnresolved", "data", "Hide links to notes that don't exist yet");
    if (!host.local) this.toggle(filter.childrenEl, "Orphans", "showOrphans", "data", "Show notes with no links");

    // Groups
    const groups = this.section("color-groups", "Groups");
    this.groupsEl = groups.childrenEl;
    this.listeners.colorGroups = (v) => {
      if (Array.isArray(v)) this.setGroups(v);
      return this.getGroups();
    };

    // Display
    const display = this.section("display", "Display");
    this.toggle(display.childrenEl, "Arrows", "showArrow", "render", "Show which way each link points when zoomed in");
    this.slider(display.childrenEl, "Text fade threshold", "textFadeMultiplier", -3, 3, 0.1, "render");
    this.slider(display.childrenEl, "Node size", "nodeSizeMultiplier", 0.1, 5, "any", "render");
    this.slider(display.childrenEl, "Link thickness", "lineSizeMultiplier", 0.1, 5, "any", "render");
    if (!host.local) {
      const row = settingRow(display.childrenEl, "", "");
      const b = row.control.createEl("button", { text: "Animate" });
      b.addEventListener("click", () => host.onAnimate());
    }

    // Forces
    const forces = this.section("forces", "Forces");
    this.slider(forces.childrenEl, "Center force", "centerStrength", 0, 1, "any", "forces");
    this.slider(forces.childrenEl, "Repel force", "repelStrength", 0, 20, "any", "forces");
    this.slider(forces.childrenEl, "Link force", "linkStrength", 0, 1, "any", "forces");
    this.slider(forces.childrenEl, "Link distance", "linkDistance", 30, 500, 1, "forces");
  }

  private section(id: string, title: string): Section {
    const s = new Section(this.el, id, title, (c) => {
      this.host.options["collapse-" + id] = c;
      this.host.onSave();
    });
    this.sections[id] = s;
    this.listeners["collapse-" + id] = (v) => {
      if (typeof v === "boolean") s.setCollapsed(v);
      return s.collapsed;
    };
    return s;
  }

  private searchTimer: any = null;
  private onSearchInput(): void {
    this.searchContainer.toggleClass("has-value", !!this.searchInput.value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.host.onOption("search", this.searchInput.value, "search"), 250);
  }

  setSearching(on: boolean): void {
    this.searchContainer.toggleClass("is-loading", on);
  }

  private toggle(parent: HTMLElement, name: string, key: string, kind: "data" | "render", tooltip: string): void {
    const row = settingRow(parent, name, "mod-toggle", tooltip);
    const box = row.control.createEl("label", { cls: "checkbox-container", attr: { tabindex: "0" } });
    box.createEl("input", { type: "checkbox", attr: { tabindex: "-1" } });
    let value = false;
    const set = (v: boolean) => {
      value = v;
      box.toggleClass("is-enabled", v);
    };
    const flip = (e: Event) => {
      e.preventDefault();
      set(!value);
      this.host.onOption(key, value, kind);
    };
    box.addEventListener("click", flip);
    box.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") flip(e);
    });
    this.listeners[key] = (v) => {
      if (typeof v === "boolean") set(v);
      return value;
    };
  }

  private slider(parent: HTMLElement, name: string, key: string, min: number, max: number, step: number | "any", kind: "data" | "render" | "forces", cls = "", tooltip?: string): void {
    const row = settingRow(parent, name, "mod-slider" + (cls ? " " + cls : ""), tooltip);
    const valueEl = row.control.createSpan("slider-value");
    const input = row.control.createEl("input", { cls: "slider", type: "range", attr: { "data-ignore-swipe": "true", min: String(min), max: String(max), step: String(step) } });
    const show = () => {
      const v = Number(input.value);
      valueEl.setText(formatSlider(v, step));
      input.style.setProperty("--slider-fill-ratio", String((v - min) / (max - min)));
    };
    input.addEventListener("input", () => {
      show();
      this.host.onOption(key, Number(input.value), kind);
    });
    this.listeners[key] = (v) => {
      if (typeof v === "number") {
        input.value = String(v);
        show();
      }
      return Number(input.value);
    };
  }

  // ---------- colour groups ----------
  private setGroups(groups: ColorGroup[]): void {
    this.groupsEl.empty();
    this.groupRows = [];
    const container = this.groupsEl.createDiv("graph-color-groups-container");
    for (const g of groups) this.addGroupRow(container, g);
    const btnWrap = this.groupsEl.createDiv("graph-color-button-container");
    const b = btnWrap.createEl("button", { text: "New group" });
    b.addEventListener("click", () => {
      this.addGroupRow(container, { query: "", color: newGroupColor(this.groupRows.length, this.host.isDark()) });
      this.commitGroups();
    });
  }

  private addGroupRow(container: HTMLElement, g: ColorGroup): void {
    const el = container.createDiv("graph-color-group");
    const query = el.createEl("input", { type: "text", attr: { spellcheck: "false", placeholder: "Enter query..." } });
    query.value = g.query;
    let t: any = null;
    query.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => this.commitGroups(), 250);
    });
    const color = el.createEl("input", { type: "color", attr: { "aria-label": "Change the colour, or drag to reorder" } });
    color.value = intToHex(g.color.rgb);
    color.addEventListener("input", () => this.commitGroups());
    color.addEventListener("mousedown", (e) => this.onDragGroup(e, row));
    const del = el.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Delete group" } });
    setIcon(del, "x");
    const row = { el, query, color };
    del.addEventListener("click", () => {
      this.groupRows.remove(row);
      el.detach();
      this.commitGroups();
    });
    this.groupRows.push(row);
  }

  private onDragGroup(e: MouseEvent, row: { el: HTMLElement; query: HTMLInputElement; color: HTMLInputElement }): void {
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const rect = row.el.getBoundingClientRect();
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    let ghost: HTMLElement | null = null;
    const dropIndex = (y: number) => {
      let i = 0;
      for (; i < this.groupRows.length; i++) {
        const r = this.groupRows[i].el.getBoundingClientRect();
        if (y < r.top + r.height / 2) return i;
      }
      return i;
    };
    const move = (ev: MouseEvent) => {
      if (!ghost) {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (dx * dx + dy * dy < 25) return;
        ev.preventDefault();
        this.groupRows.remove(row);
        ghost = row.el.cloneNode(true) as HTMLElement;
        ghost.addClass("drag-ghost");
        ghost.style.width = rect.width + "px";
        document.body.appendChild(ghost);
        document.body.addClass("is-grabbing");
        row.el.detach();
      }
      ghost.style.left = ev.clientX - offX + "px";
      ghost.style.top = ev.clientY - offY + "px";
      const idx = dropIndex(ev.clientY);
      this.groupRows.forEach((r, i) => (r.el.style.top = i < idx ? "0" : `${row.el.offsetHeight || rect.height}px`));
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!ghost) return;
      ghost.detach();
      document.body.removeClass("is-grabbing");
      const idx = dropIndex(ev.clientY);
      this.groupRows.splice(idx, 0, row);
      const groups = this.getGroups();
      this.setGroups(groups);
      this.host.onOption("colorGroups", groups, "search");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  private commitGroups(): void {
    this.host.onOption("colorGroups", this.getGroups(), "search");
  }

  getGroups(): ColorGroup[] {
    return this.groupRows.map((r) => ({ query: r.query.value, color: { a: 1, rgb: hexToInt(r.color.value) } }));
  }

  // ---------- options in/out ----------
  setOptions(o: Partial<GraphOptions>): void {
    for (const [k, v] of Object.entries(o)) this.listeners[k]?.(v);
    if (typeof o.close === "boolean") this.el.toggleClass("is-close", o.close);
  }

  getOptions(into: Record<string, any>): void {
    for (const [k, fn] of Object.entries(this.listeners)) {
      const v = fn();
      if (v !== undefined) into[k] = v;
    }
    into.close = this.el.hasClass("is-close");
  }

  /** What "Restore default settings" puts back (collapse state and colour groups are cleared too). */
  static resetValues(local: boolean): Record<string, any> {
    return {
      ...FILTER_DEFAULTS,
      ...(local ? LOCAL_FILTER_DEFAULTS : {}),
      colorGroups: [],
      ...DISPLAY_DEFAULTS,
      ...FORCE_DEFAULTS,
    };
  }
}
