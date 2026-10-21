// DOM and built-in prototype helpers that Obsidian plugins expect to exist globally
// (createEl/createDiv/createSpan, el.empty(), el.addClass(), Array.prototype.first, ...).
// Written from the public obsidian.d.ts declarations.

export interface DomElementInfo {
  cls?: string | string[];
  text?: string | DocumentFragment;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
}

function applyInfo(el: HTMLElement, o?: DomElementInfo | string, cb?: (el: any) => void): void {
  if (typeof o === "string") o = { cls: o };
  if (o) {
    if (o.cls) el.addClasses(Array.isArray(o.cls) ? o.cls : o.cls.split(" ").filter(Boolean));
    if (o.text !== undefined) {
      if (typeof o.text === "string") el.textContent = o.text;
      else el.appendChild(o.text);
    }
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : String(v));
    if (o.title !== undefined) el.title = o.title;
    if (o.value !== undefined && "value" in el) (el as any).value = o.value;
    if (o.type) el.setAttribute("type", o.type);
    if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
    if (o.href) el.setAttribute("href", o.href);
    if (o.parent) {
      if (o.prepend) o.parent.insertBefore(el, o.parent.firstChild);
      else o.parent.appendChild(el);
    }
  }
  cb?.(el);
}

export function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string, cb?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyInfo(el, o, cb);
  return el;
}
export function createDiv(o?: DomElementInfo | string, cb?: (el: HTMLDivElement) => void): HTMLDivElement {
  return createEl("div", o, cb);
}
export function createSpan(o?: DomElementInfo | string, cb?: (el: HTMLSpanElement) => void): HTMLSpanElement {
  return createEl("span", o, cb);
}
export function createSvg(tag: string, o?: any, cb?: (el: SVGElement) => void): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (typeof o === "string") o = { cls: o };
  if (o?.cls) for (const c of Array.isArray(o.cls) ? o.cls : o.cls.split(" ")) c && el.classList.add(c);
  if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
  if (o?.parent) o.parent.appendChild(el);
  cb?.(el);
  return el;
}
export function createFragment(cb?: (el: DocumentFragment) => void): DocumentFragment {
  const f = document.createDocumentFragment();
  cb?.(f);
  return f;
}

let installed = false;

export function installDomHelpers(win: Window & typeof globalThis = window as any): void {
  if (installed) return;
  installed = true;
  const NP = win.Node.prototype as any;
  const EP = win.Element.prototype as any;
  const HP = win.HTMLElement.prototype as any;
  const DF = win.DocumentFragment.prototype as any;

  const defs = (proto: any, fns: Record<string, any>) => {
    for (const [k, v] of Object.entries(fns)) {
      if (!Object.prototype.hasOwnProperty.call(proto, k)) Object.defineProperty(proto, k, { value: v, configurable: true, writable: true });
    }
  };

  const nodeFns = {
    detach(this: Node) {
      this.parentNode?.removeChild(this);
    },
    empty(this: Node) {
      while (this.lastChild) this.removeChild(this.lastChild);
    },
    insertAfter(this: Node, node: Node, child: Node | null) {
      this.insertBefore(node, child ? child.nextSibling : this.firstChild);
      return node;
    },
    indexOf(this: Node, other: Node) {
      return Array.prototype.indexOf.call(this.childNodes, other);
    },
    setChildrenInPlace(this: Node, children: Node[]) {
      const set = new Set(children);
      for (const c of Array.from(this.childNodes)) if (!set.has(c)) this.removeChild(c);
      let prev: Node | null = null;
      for (const c of children) {
        const want = prev ? prev.nextSibling : this.firstChild;
        if (want !== c) this.insertBefore(c, want);
        prev = c;
      }
    },
    appendText(this: Node, t: string) {
      this.appendChild(document.createTextNode(t));
    },
    instanceOf(this: any, type: any) {
      return this instanceof type;
    },
    createEl(this: Node, tag: any, o?: any, cb?: any) {
      if (typeof o === "string") o = { cls: o };
      return createEl(tag, { ...(o ?? {}), parent: this }, cb);
    },
    createDiv(this: Node, o?: any, cb?: any) {
      return (this as any).createEl("div", o, cb);
    },
    createSpan(this: Node, o?: any, cb?: any) {
      return (this as any).createEl("span", o, cb);
    },
    createSvg(this: Node, tag: string, o?: any, cb?: any) {
      if (typeof o === "string") o = { cls: o };
      return createSvg(tag, { ...(o ?? {}), parent: this }, cb);
    },
  };
  defs(NP, nodeFns);
  defs(DF, { find: (DocumentFragment.prototype as any).querySelector, findAll: function (this: DocumentFragment, s: string) { return Array.from(this.querySelectorAll(s)); } });
  Object.defineProperty(NP, "doc", { get() { return this.ownerDocument ?? document; }, configurable: true });
  Object.defineProperty(NP, "win", { get() { return (this.ownerDocument ?? document).defaultView ?? window; }, configurable: true });
  Object.defineProperty(NP, "constructorWin", { get() { return window; }, configurable: true });

  defs(EP, {
    getText(this: Element) {
      return this.textContent ?? "";
    },
    setText(this: Element, v: string | DocumentFragment) {
      if (typeof v === "string") this.textContent = v;
      else {
        (this as any).empty();
        this.appendChild(v);
      }
    },
    addClass(this: Element, ...c: string[]) {
      for (const x of c) x && this.classList.add(...x.split(" ").filter(Boolean));
    },
    addClasses(this: Element, c: string[]) {
      for (const x of c) x && this.classList.add(x);
    },
    removeClass(this: Element, ...c: string[]) {
      for (const x of c) x && this.classList.remove(...x.split(" ").filter(Boolean));
    },
    removeClasses(this: Element, c: string[]) {
      for (const x of c) x && this.classList.remove(x);
    },
    toggleClass(this: Element, c: string | string[], v: boolean) {
      for (const x of Array.isArray(c) ? c : [c]) this.classList.toggle(x, v);
    },
    hasClass(this: Element, c: string) {
      return this.classList.contains(c);
    },
    setAttr(this: Element, k: string, v: any) {
      if (v === null || v === undefined || v === false) this.removeAttribute(k);
      else this.setAttribute(k, v === true ? "" : String(v));
    },
    setAttrs(this: Element, o: Record<string, any>) {
      for (const [k, v] of Object.entries(o)) (this as any).setAttr(k, v);
    },
    getAttr(this: Element, k: string) {
      return this.getAttribute(k);
    },
    matchParent(this: Element, sel: string, last?: Element) {
      let el: Element | null = this;
      while (el && el !== last) {
        if (el.matches(sel)) return el;
        el = el.parentElement;
      }
      return null;
    },
    getCssPropertyValue(this: Element, prop: string, pseudo?: string) {
      return getComputedStyle(this, pseudo).getPropertyValue(prop);
    },
    isActiveElement(this: Element) {
      return this.ownerDocument.activeElement === this;
    },
    find(this: Element, s: string) {
      return this.querySelector(s);
    },
    findAll(this: Element, s: string) {
      return Array.from(this.querySelectorAll(s));
    },
    findAllSelf(this: Element, s: string) {
      const r = Array.from(this.querySelectorAll(s));
      if (this.matches(s)) r.unshift(this);
      return r;
    },
  });

  defs(HP, {
    show(this: HTMLElement) {
      this.style.display = "";
      this.classList.remove("is-hidden-bedrock");
    },
    hide(this: HTMLElement) {
      this.style.display = "none";
    },
    toggle(this: HTMLElement, show: boolean) {
      show ? (this as any).show() : (this as any).hide();
    },
    toggleVisibility(this: HTMLElement, v: boolean) {
      this.style.visibility = v ? "" : "hidden";
    },
    isShown(this: HTMLElement) {
      return !!this.offsetParent || this.style.display !== "none" && this.isConnected && getComputedStyle(this).display !== "none";
    },
    setCssStyles(this: HTMLElement, s: Partial<CSSStyleDeclaration>) {
      Object.assign(this.style, s);
    },
    setCssProps(this: HTMLElement, p: Record<string, string>) {
      for (const [k, v] of Object.entries(p)) this.style.setProperty(k, v);
    },
    onClickEvent(this: HTMLElement, cb: (e: MouseEvent) => any, opts?: any) {
      this.addEventListener("click", cb, opts);
      this.addEventListener("auxclick", cb, opts);
    },
    onNodeInserted(this: HTMLElement, cb: () => any, once?: boolean) {
      const obs = new MutationObserver(() => {
        if (this.isConnected) {
          cb();
          if (once) obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => obs.disconnect();
    },
    onWindowMigrated(this: HTMLElement) {
      return () => {};
    },
    trigger(this: HTMLElement, type: string) {
      this.dispatchEvent(new Event(type));
    },
    on(this: HTMLElement, type: string, selector: string, listener: any, options?: any) {
      const h = (ev: Event) => {
        const t = (ev.target as Element)?.closest?.(selector);
        if (t && this.contains(t)) listener.call(this, ev, t);
      };
      ((this as any).__delegates ??= []).push({ type, selector, listener, options, h });
      this.addEventListener(type, h, options);
    },
    off(this: HTMLElement, type: string, selector: string, listener: any, options?: any) {
      const arr = (this as any).__delegates ?? [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const d = arr[i];
        if (d.type === type && d.selector === selector && d.listener === listener) {
          this.removeEventListener(type, d.h, options);
          arr.splice(i, 1);
        }
      }
    },
  });
  Object.defineProperty(HP, "innerWidth", { get() { return this.clientWidth; }, configurable: true });
  Object.defineProperty(HP, "innerHeight", { get() { return this.clientHeight; }, configurable: true });

  // SVGElement shares Element helpers; also expose setCssStyles.
  defs((win as any).SVGElement.prototype, { setCssStyles: HP.setCssStyles, setCssProps: HP.setCssProps });

  // Document helpers.
  defs(win.Document.prototype, {
    createEl(this: Document, tag: any, o?: any, cb?: any) {
      return createEl(tag, o, cb);
    },
  });

  // Globals.
  const g = win as any;
  g.createEl = createEl;
  g.createDiv = createDiv;
  g.createSpan = createSpan;
  g.createSvg = createSvg;
  g.createFragment = createFragment;
  g.activeWindow = win;
  g.activeDocument = win.document;
  g.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  g.nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
  g.isBoolean = (o: any) => typeof o === "boolean";
  g.fish = (s: string) => document.querySelector(s);
  g.fishAll = (s: string) => Array.from(document.querySelectorAll(s));
  g.ajax = undefined;
  g.ajaxPromise = undefined;
  g.ready = (fn: () => any) => (document.readyState !== "loading" ? fn() : document.addEventListener("DOMContentLoaded", fn));

  // Built-in prototype helpers.
  defs(Array.prototype, {
    first(this: any[]) {
      return this[0];
    },
    last(this: any[]) {
      return this[this.length - 1];
    },
    contains(this: any[], x: any) {
      return this.includes(x);
    },
    remove(this: any[], x: any) {
      const i = this.indexOf(x);
      if (i >= 0) this.splice(i, 1);
    },
    shuffle(this: any[]) {
      for (let i = this.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this[i], this[j]] = [this[j], this[i]];
      }
      return this;
    },
    unique(this: any[]) {
      return Array.from(new Set(this));
    },
    findLastIndex(this: any[], fn: any) {
      for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return i;
      return -1;
    },
  });
  defs(String.prototype, {
    contains(this: string, s: string) {
      return this.includes(s);
    },
    format(this: string, ...args: string[]) {
      return this.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? args[+i] : m));
    },
  });
  if (!(Math as any).clamp) (Math as any).clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  if (!(Math as any).square) (Math as any).square = (v: number) => v * v;
  if (!(Number as any).isNumber) (Number as any).isNumber = (v: any) => typeof v === "number";
  if (!(Object as any).isEmpty) (Object as any).isEmpty = (o: any) => !o || Object.keys(o).length === 0;
  if (!(Object as any).each)
    (Object as any).each = (o: any, cb: (v: any, k: string) => any) => {
      for (const k of Object.keys(o)) if (cb(o[k], k) === false) return false;
      return true;
    };
  if (!(Array as any).combine) (Array as any).combine = (arrs: any[][]) => ([] as any[]).concat(...arrs);
  if (!(String as any).isString) (String as any).isString = (v: any) => typeof v === "string";
  defs(win.Event.prototype, {
    instanceOf(this: any, t: any) {
      return this instanceof t;
    },
  });
  defs(win.UIEvent.prototype, {});
  Object.defineProperty(win.UIEvent.prototype, "targetNode", { get() { return this.target; }, configurable: true });
  Object.defineProperty(win.UIEvent.prototype, "win", { get() { return this.view ?? window; }, configurable: true });
  Object.defineProperty(win.UIEvent.prototype, "doc", { get() { return (this.view ?? window).document; }, configurable: true });
}
