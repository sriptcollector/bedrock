// Menu / MenuItem (obsidian API): context menus.
import { Component } from "../api/events";
import { setIcon } from "../dom/icons";

let openMenu: Menu | null = null;
const SECTION_ORDER = ["title", "pane", "", "new", "open", "action-primary", "action", "find", "clipboard", "selection", "type", "info", "view", "zoom", "system", "close", "danger"];

export class MenuItem {
  dom: HTMLElement;
  titleEl: HTMLElement;
  iconEl: HTMLElement;
  callback: ((evt: MouseEvent | KeyboardEvent) => any) | null = null;
  disabled = false;
  checked: boolean | null = null;
  section = "";
  submenu: Menu | null = null;

  constructor(private menu: Menu) {
    this.dom = createDiv("menu-item tappable");
    this.iconEl = this.dom.createDiv("menu-item-icon");
    this.titleEl = this.dom.createDiv("menu-item-title");
    this.dom.addEventListener("click", (e) => {
      if (this.disabled) return;
      if (this.submenu) return;
      this.menu.rootMenu().hide();
      this.callback?.(e);
    });
    this.dom.addEventListener("mouseenter", () => {
      // Only one submenu open per menu.
      for (const it of this.menu.items) if (it !== "separator" && it !== this) it.submenu?.hide();
      if (this.submenu && !this.disabled) {
        const r = this.dom.getBoundingClientRect();
        this.submenu.showAtPosition({ x: r.right, y: r.top - 7, flipX: r.left }, this.dom.ownerDocument);
      }
    });
  }

  setTitle(t: string | DocumentFragment): this {
    this.titleEl.empty();
    if (typeof t === "string") this.titleEl.setText(t);
    else this.titleEl.appendChild(t);
    return this;
  }
  setIcon(icon: string | null): this {
    this.iconEl.empty();
    if (icon) setIcon(this.iconEl, icon);
    return this;
  }
  setChecked(c: boolean | null): this {
    this.checked = c;
    this.dom.toggleClass("mod-checked", !!c);
    return this;
  }
  setDisabled(d: boolean): this {
    this.disabled = d;
    this.dom.toggleClass("is-disabled", d);
    return this;
  }
  setIsLabel(l: boolean): this {
    this.dom.toggleClass("is-label", l);
    return this;
  }
  setWarning(w: boolean): this {
    this.dom.toggleClass("is-warning", w);
    return this;
  }
  setSection(s: string): this {
    this.section = s;
    return this;
  }
  onClick(cb: (evt: MouseEvent | KeyboardEvent) => any): this {
    this.callback = cb;
    return this;
  }
  setSubmenu(): Menu {
    this.submenu = new Menu();
    this.submenu.parentMenu = this.menu;
    this.dom.addClass("has-submenu");
    return this.submenu;
  }
}

export class Menu extends Component {
  dom: HTMLElement;
  items: (MenuItem | "separator")[] = [];
  /** Optional fixed order of sections (unknown sections go where "" is, else last). */
  sectionOrder: string[] | null = null;
  private hideCbs: (() => any)[] = [];
  private useNative = false;

  constructor() {
    super();
    this.dom = createDiv("menu");
    this.dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setNoIcon(): this {
    this.dom.addClass("mod-no-icon");
    return this;
  }
  setUseNativeMenu(v: boolean): this {
    this.useNative = v;
    return this;
  }

  addItem(cb: (item: MenuItem) => any): this {
    const it = new MenuItem(this);
    cb(it);
    this.items.push(it);
    return this;
  }

  addSeparator(): this {
    this.items.push("separator");
    return this;
  }

  /** Items in display order, with separators between sections. */
  orderedEntries(): (MenuItem | "separator")[] {
    // Group by section (in insertion order), separators between groups.
    const order: string[] = [];
    for (const it of this.items) if (it !== "separator" && !order.includes(it.section)) order.push(it.section);
    const ins = order.slice();
    if (this.sectionOrder) {
      // setSectionOrder(): the caller's order, "" marks where unknown sections go.
      const so = this.sectionOrder;
      const unknownAt = so.includes("") ? so.indexOf("") : so.length;
      const rank = (sec: string) => (so.includes(sec) && sec !== "" ? so.indexOf(sec) : unknownAt);
      order.sort((a, b) => rank(a) - rank(b) || ins.indexOf(a) - ins.indexOf(b));
    } else {
      // Well-known sections keep a fixed order (plugins add to them); others go before "system".
      const rank = (sec: string) => {
        const i = SECTION_ORDER.indexOf(sec);
        return i >= 0 ? i : SECTION_ORDER.indexOf("system") - 0.5;
      };
      order.sort((a, b) => rank(a) - rank(b) || ins.indexOf(a) - ins.indexOf(b));
    }
    if (order.length <= 1) return [...this.items];
    const out: (MenuItem | "separator")[] = [];
    for (const sec of order) {
      if (out.length) out.push("separator");
      for (const it of this.items) if (it !== "separator" && it.section === sec) out.push(it);
    }
    return out;
  }

  private render(): void {
    this.dom.empty();
    for (const it of this.orderedEntries()) {
      if (it === "separator") this.dom.createDiv("menu-separator");
      else this.dom.appendChild(it.dom);
    }
  }

  /** Settings › Interface › Native menus: the operating system draws the menu. */
  private async showNative(pos: { x: number; y: number; left?: boolean }): Promise<void> {
    const toTemplate = (m: Menu): any[] =>
      m.orderedEntries().map((it) =>
        it === "separator" ? { type: "separator" } : { label: it.titleEl.textContent ?? "", checked: it.checked, disabled: it.disabled, submenu: it.submenu ? toTemplate(it.submenu) : undefined },
      );
    const { ipcRenderer } = require("electron");
    const path: number[] | null = await ipcRenderer.invoke("bedrock:native-menu", { items: toTemplate(this), x: pos.x, y: pos.y });
    let m: Menu = this;
    let chosen: MenuItem | null = null;
    for (const i of path ?? []) {
      const e = m.orderedEntries()[i];
      if (!e || e === "separator") break;
      chosen = e;
      if (e.submenu) m = e.submenu;
    }
    for (const cb of this.hideCbs.splice(0)) cb();
    if (chosen && !chosen.submenu) chosen.callback?.(new MouseEvent("click"));
  }
  showAtMouseEvent(evt: MouseEvent): this {
    evt.preventDefault?.();
    const doc = ((evt.target as Node | null)?.ownerDocument ?? (evt as any).view?.document) as Document | undefined;
    return this.showAtPosition({ x: evt.clientX, y: evt.clientY }, doc);
  }

  showAtPosition(pos: { x: number; y: number; width?: number; overlap?: boolean; left?: boolean; flipX?: number }, docArg?: Document): this {
    if (!this.parentMenu && openMenu && openMenu !== this) openMenu.hide();
    const targetDoc: Document = docArg ?? (window as any).activeDocument ?? window.document;
    if (!this.parentMenu && targetDoc === window.document && (this.useNative || (window as any).app?.vault?.getConfig?.("nativeMenus"))) {
      void this.showNative(pos);
      return this;
    }
    this.render();
    // Popout windows (settings) show menus in their own document.
    const document: Document = docArg ?? (window as any).activeDocument ?? window.document;
    const win = document.defaultView ?? window;
    document.body.appendChild(this.dom);
    this.load();
    const r = this.dom.getBoundingClientRect();
    let x = pos.left === true ? pos.x - r.width : pos.x;
    let y = pos.y;
    // Not enough room: open to the other side of the point (or of the parent item for
    // submenus), like the original; clamp only as a last resort.
    if (x + r.width > win.innerWidth - 4) {
      const flip = (pos.flipX ?? x) - r.width;
      x = flip >= 4 ? flip : Math.max(4, win.innerWidth - r.width - 4);
    }
    if (y + r.height > win.innerHeight - 4) {
      const flip = this.parentMenu ? win.innerHeight - r.height - 4 : y - r.height;
      y = flip >= 4 ? flip : Math.max(4, win.innerHeight - r.height - 4);
    }
    this.dom.style.left = x + "px";
    this.dom.style.top = y + "px";
    if (this.parentMenu) return this;
    openMenu = this;
    const off = (e: MouseEvent) => {
      if (!this.containsTarget(e.target as Node)) this.hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.hide();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", off, true);
      document.addEventListener("keydown", key, true);
    });
    this.register(() => {
      document.removeEventListener("mousedown", off, true);
      document.removeEventListener("keydown", key, true);
    });
    return this;
  }

  parentMenu: Menu | null = null;

  rootMenu(): Menu {
    let m: Menu = this;
    while (m.parentMenu) m = m.parentMenu;
    return m;
  }

  /** True when the node is inside this menu or one of its open submenus. */
  containsTarget(n: Node | null): boolean {
    if (!n) return false;
    if (this.dom.contains(n)) return true;
    return this.items.some((it) => it !== "separator" && !!it.submenu?.dom.isConnected && it.submenu.containsTarget(n));
  }

  hide(): this {
    this.dom.detach();
    for (const it of this.items) if (it !== "separator") it.submenu?.hide();
    this.unload();
    if (openMenu === this) openMenu = null;
    for (const cb of this.hideCbs.splice(0)) cb();
    return this;
  }

  close(): void {
    this.hide();
  }

  onHide(cb: () => any): void {
    this.hideCbs.push(cb);
  }

  static forEvent(evt: MouseEvent): Menu {
    const m = new Menu();
    setTimeout(() => m.showAtMouseEvent(evt));
    return m;
  }
}
