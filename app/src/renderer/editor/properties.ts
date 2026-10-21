// Properties widget: the editable view of a note's YAML frontmatter shown at the top of the note.
// Types (text, list, number, checkbox, date, datetime, tags, aliases) are stored vault-wide in
// .obsidian/types.json like Obsidian; untyped keys are inferred from their values.
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { AbstractInputSuggest } from "./suggest";
import { prepareFuzzySearch } from "../ui/search";

/** Fuzzy-ranked string suggestions under a property key or value input. */
class StringSuggest extends AbstractInputSuggest<string> {
  constructor(app: any, el: HTMLInputElement | HTMLDivElement, private source: () => string[], pick: (v: string) => void) {
    super(app, el);
    this.onSelect((v) => pick(v));
  }
  protected getSuggestions(query: string): string[] {
    const all = [...new Set(this.source())];
    const q = query.trim();
    if (!q) return all.sort((a, b) => a.localeCompare(b)).slice(0, 50);
    const f = prepareFuzzySearch(q);
    return all
      .map((v) => ({ v, r: f(v) }))
      .filter((x) => x.r && x.v !== q)
      .sort((a, b) => b.r!.score - a.r!.score)
      .map((x) => x.v)
      .slice(0, 50);
  }
  renderSuggestion(v: string, el: HTMLElement): void {
    el.setText(v);
  }
}

export type PropertyType = "text" | "multitext" | "number" | "checkbox" | "date" | "datetime" | "tags" | "aliases";

const TYPE_LABELS: [PropertyType, string, string][] = [
  ["text", "Text", "text"],
  ["multitext", "List", "list"],
  ["number", "Number", "binary"],
  ["checkbox", "Checkbox", "check-square"],
  ["date", "Date", "calendar"],
  ["datetime", "Date & time", "clock"],
];

export class PropertyTypes {
  types: Record<string, PropertyType> = {};
  constructor(private app: any) {}
  async load(): Promise<void> {
    try {
      const j = JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + "/types.json"));
      this.types = j?.types ?? {};
    } catch {
      this.types = {};
    }
  }
  async save(): Promise<void> {
    await this.app.vault.adapter.write(this.app.vault.configDir + "/types.json", JSON.stringify({ types: this.types }, null, 2));
  }
  get(key: string, value: any): PropertyType {
    const k = key.toLowerCase();
    if (k === "tags" || k === "tag") return "tags";
    if (k === "aliases" || k === "alias") return "aliases";
    if (k === "cssclasses" || k === "cssclass") return "multitext";
    const t = this.types[key] ?? this.types[k];
    if (t) return t;
    if (Array.isArray(value)) return "multitext";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    return "text";
  }
  set(key: string, t: PropertyType): void {
    this.types[key] = t;
    this.save();
  }
}

function typeIcon(t: PropertyType): string {
  if (t === "tags") return "tags";
  if (t === "aliases") return "forward";
  return TYPE_LABELS.find((x) => x[0] === t)?.[2] ?? "text";
}

function coerce(value: any, t: PropertyType): any {
  switch (t) {
    case "multitext":
    case "tags":
    case "aliases":
      if (value == null || value === "") return [];
      return Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return value === true || value === "true";
    default:
      if (Array.isArray(value)) return value.join(", ");
      return value == null ? "" : value;
  }
}

/**
 * Renders `frontmatter` into `el` and calls `onChange(next)` with a new object whenever the
 * person edits something. Keys keep their order.
 */
export class PropertiesEditor {
  el: HTMLElement;
  private fm: Record<string, any> = {};
  private listEl: HTMLElement;
  collapsed = false;

  constructor(private app: any, private onChange: (fm: Record<string, any>) => void) {
    this.el = createDiv({ cls: "metadata-container", attr: { tabindex: "-1" } });
    const heading = this.el.createDiv("metadata-properties-heading");
    const fold = heading.createDiv("collapse-indicator collapse-icon");
    setIcon(fold, "chevron-down");
    heading.createDiv({ cls: "metadata-properties-title", text: "Properties" });
    heading.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.el.toggleClass("is-collapsed", this.collapsed);
    });
    this.listEl = this.el.createDiv("metadata-content").createDiv("metadata-properties");
    const add = this.el.querySelector(".metadata-content")!.createDiv({ cls: "metadata-add-button text-icon-button", attr: { tabindex: "0" } });
    setIcon(add.createSpan("text-button-icon"), "plus");
    add.createSpan({ cls: "text-button-label", text: "Add property" });
    add.addEventListener("click", () => this.addProperty());
  }

  get types(): PropertyTypes {
    return this.app.propertyTypes;
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.el.toggleClass("is-collapsed", this.collapsed);
  }

  private propertyNames(): string[] {
    return Object.keys(this.app.metadataCache?.getAllPropertyInfos?.() ?? {});
  }
  private valuesFor(key: string, t: PropertyType): string[] {
    if (t === "tags") return Object.keys(this.app.metadataCache?.getTags?.() ?? {}).map((x) => x.replace(/^#/, ""));
    return (this.app.metadataCache?.getFrontmatterPropertyValuesForKey?.(key) ?? []).filter((v: string) => v && v.length < 200);
  }

  hasFocus(): boolean {
    return this.el.contains(document.activeElement);
  }

  setFrontmatter(fm: Record<string, any> | null): void {
    this.fm = fm ? { ...fm } : {};
    if (this.hasFocus()) return; // don't yank the field from under the cursor
    this.render();
  }

  private commit(): void {
    this.onChange({ ...this.fm });
  }

  private render(): void {
    this.listEl.empty();
    this.el.toggleClass("mod-empty", Object.keys(this.fm).length === 0);
    for (const [k, v] of Object.entries(this.fm)) this.renderRow(k, v);
  }

  private addProperty(): void {
    let k = "";
    const row = this.listEl.createDiv("metadata-property");
    const keyEl = row.createDiv("metadata-property-key");
    setIcon(keyEl.createSpan("metadata-property-icon"), "text");
    const input = keyEl.createEl("input", { cls: "metadata-property-key-input", attr: { type: "text", placeholder: "Property name" } });
    input.focus();
    new StringSuggest(this.app, input, () => this.propertyNames().filter((n) => !(n in this.fm)), (v) => {
      input.value = v;
      input.blur();
    });
    const done = () => {
      k = input.value.trim();
      row.remove();
      if (k && !(k in this.fm)) {
        this.fm[k] = this.types.get(k, null) === "multitext" ? [] : "";
        this.render();
        this.commit();
        (this.listEl.querySelector(`[data-property-key="${CSS.escape(k)}"] .metadata-property-value input, [data-property-key="${CSS.escape(k)}"] .metadata-property-value [contenteditable]`) as HTMLElement | null)?.focus();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        input.value = "";
        input.blur();
      }
    });
    input.addEventListener("blur", done, { once: true });
  }

  private renderRow(key: string, value: any): void {
    const t = this.types.get(key, value);
    const row = this.listEl.createDiv({ cls: "metadata-property", attr: { "data-property-key": key, "data-property-type": t } });
    const keyEl = row.createDiv("metadata-property-key");
    const icon = keyEl.createSpan({ cls: "metadata-property-icon clickable-icon", attr: { "aria-label": "Property type" } });
    setIcon(icon, typeIcon(t));
    icon.addEventListener("click", (e) => this.typeMenu(e, key));
    const keyInput = keyEl.createEl("input", { cls: "metadata-property-key-input", attr: { type: "text", value: key, autocapitalize: "none", spellcheck: "false" } });
    new StringSuggest(this.app, keyInput, () => this.propertyNames().filter((n) => !(n in this.fm)), (v) => {
      keyInput.value = v;
      keyInput.dispatchEvent(new Event("change"));
    });
    keyInput.addEventListener("change", () => {
      const nk = keyInput.value.trim();
      if (!nk || nk === key || nk in this.fm) {
        keyInput.value = key;
        return;
      }
      const next: Record<string, any> = {};
      for (const [k, v] of Object.entries(this.fm)) next[k === key ? nk : k] = v;
      this.fm = next;
      this.commit();
      this.render();
    });
    const valEl = row.createDiv("metadata-property-value");
    const set = (v: any) => {
      this.fm[key] = v;
      this.commit();
    };
    switch (t) {
      case "checkbox": {
        const cb = valEl.createEl("input", { cls: "metadata-input-checkbox", attr: { type: "checkbox" } });
        cb.checked = value === true;
        cb.addEventListener("change", () => set(cb.checked));
        break;
      }
      case "number": {
        const inp = valEl.createEl("input", { cls: "metadata-input metadata-input-number", attr: { type: "number", value: value ?? "" } });
        inp.addEventListener("change", () => set(inp.value === "" ? null : Number(inp.value)));
        break;
      }
      case "date":
      case "datetime": {
        const inp = valEl.createEl("input", { cls: "metadata-input metadata-input-text mod-date", attr: { type: t === "date" ? "date" : "datetime-local", max: t === "date" ? "9999-12-31" : "9999-12-31T23:59" } });
        inp.value = typeof value === "string" ? (t === "date" ? value.slice(0, 10) : value.slice(0, 16)) : "";
        inp.addEventListener("change", () => set(inp.value || null));
        break;
      }
      case "multitext":
      case "tags":
      case "aliases": {
        const list = coerce(value, t) as any[];
        const box = valEl.createDiv("multi-select-container");
        const renderPills = () => {
          box.querySelectorAll(".multi-select-pill").forEach((p) => p.remove());
          list.forEach((item, i) => {
            const pill = createDiv("multi-select-pill");
            pill.createDiv({ cls: "multi-select-pill-content", text: String(item) });
            const x = pill.createDiv("multi-select-pill-remove-button");
            setIcon(x, "x");
            x.addEventListener("click", () => {
              list.splice(i, 1);
              set(list.slice());
              renderPills();
            });
            if (t === "tags") pill.addClass("mod-tag");
            box.insertBefore(pill, input);
          });
        };
        const input = box.createDiv({ cls: "multi-select-input", attr: { contenteditable: "true", tabindex: "0" } });
        const addFromInput = () => {
          const parts = (input.textContent ?? "")
            .split(",")
            .map((s) => s.trim().replace(t === "tags" ? /^#/ : /^$/, ""))
            .filter(Boolean);
          input.textContent = "";
          if (!parts.length) return;
          list.push(...parts);
          set(list.slice());
          renderPills();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addFromInput();
          } else if (e.key === "Backspace" && !input.textContent && list.length) {
            list.pop();
            set(list.slice());
            renderPills();
          }
        });
        input.addEventListener("blur", () => setTimeout(addFromInput, 120));
        new StringSuggest(this.app, input, () => this.valuesFor(key, t).filter((v) => !list.includes(v)), (v) => {
          input.textContent = v;
          addFromInput();
          input.focus();
        });
        renderPills();
        break;
      }
      default: {
        const div = valEl.createDiv({ cls: "metadata-input-longtext", attr: { contenteditable: "true", tabindex: "0", placeholder: "Empty" } });
        div.textContent = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
        new StringSuggest(this.app, div, () => this.valuesFor(key, t), (v) => {
          div.textContent = v;
          div.blur();
        });
        div.addEventListener("blur", () => {
          const v = div.textContent ?? "";
          if (v !== String(this.fm[key] ?? "")) set(v);
        });
        div.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            div.blur();
          }
        });
      }
    }
    keyEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) =>
        i
          .setTitle("Remove")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            delete this.fm[key];
            this.commit();
            this.render();
          }),
      );
      m.showAtMouseEvent(e);
    });
  }

  private typeMenu(e: MouseEvent, key: string): void {
    const m = new Menu();
    const cur = this.types.get(key, this.fm[key]);
    for (const [t, label, icon] of TYPE_LABELS) {
      m.addItem((i) =>
        i
          .setTitle(label)
          .setIcon(icon)
          .setChecked(cur === t)
          .onClick(() => {
            this.types.set(key, t);
            this.fm[key] = coerce(this.fm[key], t);
            this.commit();
            this.render();
          }),
      );
    }
    m.addSeparator();
    m.addItem((i) =>
      i
        .setTitle("Remove")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => {
          delete this.fm[key];
          this.commit();
          this.render();
        }),
    );
    m.showAtMouseEvent(e);
  }
}
