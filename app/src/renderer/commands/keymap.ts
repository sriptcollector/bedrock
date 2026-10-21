// Platform, Keymap and Scope (obsidian API). "Mod" means Ctrl on Windows/Linux and Cmd on macOS.

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";

const nav = typeof navigator !== "undefined" ? navigator : ({ platform: process.platform, userAgent: "" } as any);
const isMac = /mac/i.test(nav.platform ?? "") || process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: isMac,
  isWin,
  isLinux,
  isSafari: false,
  resourcePathPrefix: "file:///",
};

export interface KeymapInfo {
  modifiers: string | null;
  key: string | null;
}

export interface KeymapEventHandler extends KeymapInfo {
  scope: Scope;
  func: (evt: KeyboardEvent, ctx: KeymapInfo & { vkey: string }) => any;
}

export function eventModifiers(evt: KeyboardEvent | MouseEvent): Modifier[] {
  const m: Modifier[] = [];
  if (isMac ? evt.metaKey : evt.ctrlKey) m.push("Mod");
  if (isMac && evt.ctrlKey) m.push("Ctrl");
  if (!isMac && evt.metaKey) m.push("Meta");
  if (evt.altKey) m.push("Alt");
  if (evt.shiftKey) m.push("Shift");
  return m;
}

/** Normalise a key name the way hotkeys.json stores it ("P", "ArrowLeft", ",", "F2"). */
export function normaliseKey(evt: KeyboardEvent): string {
  const code = evt.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const map: Record<string, string> = {
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    Space: " ",
  };
  if (map[code]) return map[code];
  const k = evt.key;
  return k.length === 1 ? k.toUpperCase() : k;
}

export function modifiersToString(mods: string[]): string {
  return [...mods].sort().join(",");
}

export function hotkeyLabel(mods: string[], key: string): string {
  const names: Record<string, string> = isMac
    ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
    : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };
  const order = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];
  const parts = [...mods].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => names[m] ?? m);
  const keyName = key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, "");
  return isMac ? parts.join("") + keyName : [...parts, keyName].join(" + ");
}

export class Scope {
  keys: KeymapEventHandler[] = [];
  parent?: Scope;
  tabFocusContainerEl: HTMLElement | null = null;

  constructor(parent?: Scope) {
    this.parent = parent;
  }

  register(modifiers: Modifier[] | null, key: string | null, func: KeymapEventHandler["func"]): KeymapEventHandler {
    const h: KeymapEventHandler = { scope: this, modifiers: modifiers ? modifiersToString(modifiers) : null, key, func };
    this.keys.push(h);
    return h;
  }

  unregister(h: KeymapEventHandler): void {
    this.keys.remove(h);
  }

  setTabFocusContainerEl(el: HTMLElement | null): void {
    this.tabFocusContainerEl = el;
  }

  /** Returns false if handled and the event should stop. */
  handleKey(evt: KeyboardEvent, info: KeymapInfo & { vkey: string }): boolean | undefined {
    for (const h of this.keys) {
      const modOk = h.modifiers === null || h.modifiers === info.modifiers;
      const keyOk = h.key === null || h.key.toLowerCase() === (info.key ?? "").toLowerCase() || h.key === info.vkey;
      if (modOk && keyOk) {
        const r = h.func(evt, info);
        if (r === false) return false;
      }
    }
    return this.parent?.handleKey(evt, info);
  }
}

export class Keymap {
  scopes: Scope[] = [];
  rootScope: Scope;

  constructor(root: Scope) {
    this.rootScope = root;
  }

  pushScope(scope: Scope): void {
    this.scopes.remove(scope);
    this.scopes.push(scope);
  }

  popScope(scope: Scope): void {
    this.scopes.remove(scope);
  }

  getRootScope(): Scope {
    return this.rootScope;
  }

  /** Dispatch a keydown to the top scope (falls through parents to the root). */
  onKeyEvent(evt: KeyboardEvent): boolean | undefined {
    const scope = this.scopes[this.scopes.length - 1] ?? this.rootScope;
    const mods = eventModifiers(evt);
    const info = { modifiers: modifiersToString(mods), key: normaliseKey(evt), vkey: evt.key };
    return scope.handleKey(evt, info);
  }

  static isModifier(evt: MouseEvent | TouchEvent | KeyboardEvent, modifier: Modifier): boolean {
    const e = evt as KeyboardEvent;
    switch (modifier) {
      case "Mod":
        return isMac ? e.metaKey : e.ctrlKey;
      case "Ctrl":
        return e.ctrlKey;
      case "Meta":
        return e.metaKey;
      case "Shift":
        return e.shiftKey;
      case "Alt":
        return e.altKey;
    }
  }

  /** Mod/Ctrl-click opens in a new tab, Mod+Alt in a split, Mod+Alt+Shift in a window. */
  static isModEvent(evt?: UserEventLike | null): boolean | "tab" | "split" | "window" {
    if (!evt) return false;
    const e = evt as MouseEvent;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e instanceof MouseEvent && e.button === 1) return "tab";
    if (mod && e.altKey && e.shiftKey) return "window";
    if (mod && e.altKey) return "split";
    if (mod) return "tab";
    return false;
  }

  static compileModifiers(mods: Modifier[]): string {
    return modifiersToString(mods);
  }
}

type UserEventLike = MouseEvent | KeyboardEvent | TouchEvent | PointerEvent;
