// Menu / MenuItem (obsidian API): context menus.
import { Component } from "../api/events";
import { setIcon } from "../dom/icons";

let openMenu: Menu | null = null;

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
      this.menu.hide();
      this.callback?.(e);
    });
    this.dom.addEventListener("mouseenter", () => {
      if (this.submenu) {
        const r = this.dom.getBoundingClientRect();
        this.submenu.showAtPosition({ x: r.right, y: r.top });
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
    this.dom.addClass("has-submenu");
    return this.submenu;
  }
}

export class Menu extends Component {
  dom: HTMLElement;
  items: (MenuItem | "separator")[] = [];
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

  private render(): void {
    this.dom.empty();
    // Group by section (in insertion order), separators between groups.
    const order: string[] = [];
    for (const it of this.items) if (it !== "separator" && !order.includes(it.section)) order.push(it.section);
    let first = true;
    if (order.length > 1) {
      for (const sec of order) {
        if (!first) this.dom.createDiv("menu-separator");
        first = false;
        for (const it of this.items) if (it !== "separator" && it.section === sec) this.dom.appendChild(it.dom);
      }
    } else {
      for (const it of this.items) {
        if (it === "separator") this.dom.createDiv("menu-separator");
        else this.dom.appendChild(it.dom);
      }
    }
  }

  showAtMouseEvent(evt: MouseEvent): this {
    evt.preventDefault?.();
    const doc = ((evt.target as Node | null)?.ownerDocument ?? (evt as any).view?.document) as Document | undefined;
    return this.showAtPosition({ x: evt.clientX, y: evt.clientY }, doc);
  }

  showAtPosition(pos: { x: number; y: number; width?: number; overlap?: boolean; left?: boolean }, docArg?: Document): this {
    if (openMenu && openMenu !== this && !openMenu.dom.contains(this.dom)) openMenu.hide();
    this.render();
    // Popout windows (settings) show menus in their own document.
    const document: Document = docArg ?? (window as any).activeDocument ?? window.document;
    const win = document.defaultView ?? window;
    document.body.appendChild(this.dom);
    this.load();
    const r = this.dom.getBoundingClientRect();
    let x = pos.x;
    let y = pos.y;
    if (x + r.width > win.innerWidth - 4) x = Math.max(4, win.innerWidth - r.width - 4);
    if (y + r.height > win.innerHeight - 4) y = Math.max(4, win.innerHeight - r.height - 4);
    this.dom.style.left = x + "px";
    this.dom.style.top = y + "px";
    openMenu = this;
    const off = (e: MouseEvent) => {
      if (!this.dom.contains(e.target as Node)) this.hide();
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
