// Setting + value components (obsidian API): the rows used in settings tabs and modals.
import { setIcon } from "../dom/icons";

export abstract class BaseComponent {
  disabled = false;
  then(cb: (c: this) => any): this {
    cb(this);
    return this;
  }
  setDisabled(d: boolean): this {
    this.disabled = d;
    return this;
  }
}

export abstract class ValueComponent<T> extends BaseComponent {
  registerOptionListener(listeners: Record<string, (v?: T) => T>, key: string): this {
    listeners[key] = (v?: T) => {
      if (v !== undefined) this.setValue(v);
      return this.getValue();
    };
    return this;
  }
  abstract getValue(): T;
  abstract setValue(v: T): this;
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  private cb: ((e: MouseEvent) => any) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.buttonEl = containerEl.createEl("button");
    this.buttonEl.addEventListener("click", (e) => this.cb?.(e));
  }
  setDisabled(d: boolean): this {
    super.setDisabled(d);
    this.buttonEl.disabled = d;
    return this;
  }
  setCta(): this {
    this.buttonEl.addClass("mod-cta");
    return this;
  }
  removeCta(): this {
    this.buttonEl.removeClass("mod-cta");
    return this;
  }
  setWarning(): this {
    this.buttonEl.addClass("mod-warning");
    return this;
  }
  setTooltip(t: string): this {
    this.buttonEl.setAttr("aria-label", t);
    return this;
  }
  setButtonText(t: string): this {
    this.buttonEl.setText(t);
    return this;
  }
  setIcon(i: string): this {
    this.buttonEl.empty();
    setIcon(this.buttonEl, i);
    return this;
  }
  setClass(c: string): this {
    this.buttonEl.addClass(c);
    return this;
  }
  onClick(cb: (e: MouseEvent) => any): this {
    this.cb = cb;
    return this;
  }
}

export class ExtraButtonComponent extends BaseComponent {
  extraSettingsEl: HTMLElement;
  private cb: (() => any) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.extraSettingsEl = containerEl.createDiv("clickable-icon extra-setting-button");
    this.extraSettingsEl.addEventListener("click", () => !this.disabled && this.cb?.());
    setIcon(this.extraSettingsEl, "settings");
  }
  setTooltip(t: string): this {
    this.extraSettingsEl.setAttr("aria-label", t);
    return this;
  }
  setIcon(i: string): this {
    setIcon(this.extraSettingsEl, i);
    return this;
  }
  onClick(cb: () => any): this {
    this.cb = cb;
    return this;
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement;
  private value = false;
  private cb: ((v: boolean) => any) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.toggleEl = containerEl.createDiv("checkbox-container");
    this.toggleEl.createEl("input", { type: "checkbox", attr: { tabindex: 0 } });
    this.toggleEl.addEventListener("click", (e) => {
      e.preventDefault();
      if (!this.disabled) this.onClick();
    });
  }
  setDisabled(d: boolean): this {
    super.setDisabled(d);
    this.toggleEl.toggleClass("is-disabled", d);
    return this;
  }
  getValue(): boolean {
    return this.value;
  }
  setValue(v: boolean): this {
    this.value = !!v;
    this.toggleEl.toggleClass("is-enabled", this.value);
    return this;
  }
  setTooltip(t: string): this {
    this.toggleEl.setAttr("aria-label", t);
    return this;
  }
  onClick(): void {
    this.setValue(!this.value);
    this.cb?.(this.value);
  }
  onChange(cb: (v: boolean) => any): this {
    this.cb = cb;
    return this;
  }
}

export class AbstractTextComponent<T extends HTMLInputElement | HTMLTextAreaElement> extends ValueComponent<string> {
  inputEl: T;
  private cb: ((v: string) => any) | null = null;
  constructor(inputEl: T) {
    super();
    this.inputEl = inputEl;
    this.inputEl.addEventListener("input", () => this.onChanged());
  }
  setDisabled(d: boolean): this {
    super.setDisabled(d);
    this.inputEl.disabled = d;
    return this;
  }
  getValue(): string {
    return this.inputEl.value;
  }
  setValue(v: string): this {
    this.inputEl.value = v ?? "";
    return this;
  }
  setPlaceholder(p: string): this {
    this.inputEl.placeholder = p;
    return this;
  }
  onChanged(): void {
    this.cb?.(this.getValue());
  }
  onChange(cb: (v: string) => any): this {
    this.cb = cb;
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(containerEl: HTMLElement) {
    super(containerEl.createEl("input", { type: "text", attr: { spellcheck: "false" } }));
  }
}
export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  clearButtonEl: HTMLElement;
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    const wrap = containerEl.createDiv("search-input-container");
    super(wrap.createEl("input", { type: "search", attr: { spellcheck: "false", enterkeyhint: "search" } }));
    this.containerEl = wrap;
    this.clearButtonEl = wrap.createDiv("search-input-clear-button");
    this.clearButtonEl.addEventListener("click", () => {
      this.setValue("");
      this.onChanged();
      this.inputEl.focus();
    });
  }
  setClass(c: string): this {
    this.containerEl.addClass(c);
    return this;
  }
}
export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(containerEl: HTMLElement) {
    super(containerEl.createEl("textarea"));
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  private cb: ((v: string) => any) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.selectEl = containerEl.createEl("select", "dropdown");
    this.selectEl.addEventListener("change", () => this.cb?.(this.selectEl.value));
  }
  setDisabled(d: boolean): this {
    super.setDisabled(d);
    this.selectEl.disabled = d;
    return this;
  }
  addOption(value: string, display: string): this {
    this.selectEl.createEl("option", { value, text: display });
    return this;
  }
  addOptions(o: Record<string, string>): this {
    for (const [k, v] of Object.entries(o)) this.addOption(k, v);
    return this;
  }
  getValue(): string {
    return this.selectEl.value;
  }
  setValue(v: string): this {
    this.selectEl.value = v;
    return this;
  }
  onChange(cb: (v: string) => any): this {
    this.cb = cb;
    return this;
  }
}

export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement;
  private cb: ((v: number) => any) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.sliderEl = containerEl.createEl("input", { type: "range", cls: "slider" });
    this.sliderEl.addEventListener("input", () => this.cb?.(this.getValue()));
  }
  setLimits(min: number | null, max: number | null, step: number | "any"): this {
    if (min !== null) this.sliderEl.min = String(min);
    if (max !== null) this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  showTooltip(): void {}
  getValue(): number {
    return Number(this.sliderEl.value);
  }
  setValue(v: number): this {
    this.sliderEl.value = String(v);
    return this;
  }
  getValuePretty(): string {
    return String(this.getValue());
  }
  setInstant(_i: boolean): this {
    return this;
  }
  onChange(cb: (v: number) => any): this {
    this.cb = cb;
    return this;
  }
}

export class ColorComponent extends ValueComponent<string> {
  colorPickerEl: HTMLInputElement;
  private cb: ((v: string) => any) | null = null;
  constructor(containerEl: HTMLElement) {
    super();
    this.colorPickerEl = containerEl.createEl("input", { type: "color" });
    this.colorPickerEl.addEventListener("input", () => this.cb?.(this.getValue()));
  }
  getValue(): string {
    return this.colorPickerEl.value;
  }
  setValue(v: string): this {
    this.colorPickerEl.value = v;
    return this;
  }
  getValueRgb(): { r: number; g: number; b: number } {
    const h = this.getValue().replace("#", "");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  getValueHsl(): { h: number; s: number; l: number } {
    const { r, g, b } = this.getValueRgb();
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: (h / 6) * 360, s, l };
  }
  setValueRgb(c: { r: number; g: number; b: number }): this {
    return this.setValue("#" + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, "0")).join(""));
  }
  setValueHsl(_c: any): this {
    return this;
  }
  onChange(cb: (v: string) => any): this {
    this.cb = cb;
    return this;
  }
}

export class MomentFormatComponent extends TextComponent {
  sampleEl: HTMLElement | null = null;
  setDefaultFormat(f: string): this {
    this.setPlaceholder(f);
    return this;
  }
  setSampleEl(el: HTMLElement): this {
    this.sampleEl = el;
    return this;
  }
  updateSample(): void {}
}

export class ProgressBarComponent extends ValueComponent<number> {
  private el: HTMLElement;
  private v = 0;
  constructor(containerEl: HTMLElement) {
    super();
    this.el = containerEl.createDiv("setting-progress-bar").createDiv("setting-progress-bar-inner");
  }
  getValue(): number {
    return this.v;
  }
  setValue(v: number): this {
    this.v = v;
    this.el.style.width = Math.max(0, Math.min(100, v)) + "%";
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: BaseComponent[] = [];

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv("setting-item");
    this.infoEl = this.settingEl.createDiv("setting-item-info");
    this.nameEl = this.infoEl.createDiv("setting-item-name");
    this.descEl = this.infoEl.createDiv("setting-item-description");
    this.controlEl = this.settingEl.createDiv("setting-item-control");
  }

  setName(n: string | DocumentFragment): this {
    this.nameEl.empty();
    typeof n === "string" ? this.nameEl.setText(n) : this.nameEl.appendChild(n);
    return this;
  }
  setDesc(d: string | DocumentFragment): this {
    this.descEl.empty();
    typeof d === "string" ? this.descEl.setText(d) : this.descEl.appendChild(d);
    return this;
  }
  setClass(c: string): this {
    this.settingEl.addClass(c);
    return this;
  }
  setTooltip(t: string): this {
    this.nameEl.setAttr("aria-label", t);
    return this;
  }
  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }
  setDisabled(d: boolean): this {
    this.settingEl.toggleClass("is-disabled", d);
    for (const c of this.components) c.setDisabled(d);
    return this;
  }
  private add<C extends BaseComponent>(c: C, cb: (c: C) => any): this {
    this.components.push(c);
    cb(c);
    return this;
  }
  addButton(cb: (c: ButtonComponent) => any): this {
    return this.add(new ButtonComponent(this.controlEl), cb);
  }
  addExtraButton(cb: (c: ExtraButtonComponent) => any): this {
    return this.add(new ExtraButtonComponent(this.controlEl), cb);
  }
  addToggle(cb: (c: ToggleComponent) => any): this {
    return this.add(new ToggleComponent(this.controlEl), cb);
  }
  addText(cb: (c: TextComponent) => any): this {
    return this.add(new TextComponent(this.controlEl), cb);
  }
  addSearch(cb: (c: SearchComponent) => any): this {
    return this.add(new SearchComponent(this.controlEl), cb);
  }
  addTextArea(cb: (c: TextAreaComponent) => any): this {
    return this.add(new TextAreaComponent(this.controlEl), cb);
  }
  addMomentFormat(cb: (c: MomentFormatComponent) => any): this {
    return this.add(new MomentFormatComponent(this.controlEl), cb);
  }
  addDropdown(cb: (c: DropdownComponent) => any): this {
    return this.add(new DropdownComponent(this.controlEl), cb);
  }
  addColorPicker(cb: (c: ColorComponent) => any): this {
    return this.add(new ColorComponent(this.controlEl), cb);
  }
  addProgressBar(cb: (c: ProgressBarComponent) => any): this {
    return this.add(new ProgressBarComponent(this.controlEl), cb);
  }
  addSlider(cb: (c: SliderComponent) => any): this {
    return this.add(new SliderComponent(this.controlEl), cb);
  }
  then(cb: (s: this) => any): this {
    cb(this);
    return this;
  }
  clear(): this {
    this.controlEl.empty();
    this.components = [];
    return this;
  }
}

export abstract class SettingTab {
  app: any;
  containerEl: HTMLElement;
  icon = "settings";
  id = "";
  name = "";
  constructor() {
    this.containerEl = createDiv("vertical-tab-content");
  }
  abstract display(): void;
  hide(): void {
    this.containerEl.empty();
  }
}

export abstract class PluginSettingTab extends SettingTab {
  plugin: any;
  constructor(app: any, plugin: any) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.id = plugin?.manifest?.id ?? "";
    this.name = plugin?.manifest?.name ?? "";
  }
}
