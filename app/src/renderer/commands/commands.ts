// Command registry + hotkey manager (Obsidian's app.commands / app.hotkeyManager).
// Custom hotkeys live in .obsidian/hotkeys.json: { "<command id>": [{modifiers:["Mod"], key:"P"}] }.
import type { App } from "../app";
import { eventModifiers, hotkeyLabel, modifiersToString, normaliseKey, type Modifier } from "./keymap";

export interface Hotkey {
  modifiers: Modifier[];
  key: string;
}

export interface Command {
  id: string;
  name: string;
  icon?: string;
  mobileOnly?: boolean;
  repeatable?: boolean;
  hotkeys?: Hotkey[];
  callback?: () => any;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: any, ctx: any) => any;
  editorCheckCallback?: (checking: boolean, editor: any, ctx: any) => boolean | void;
}

export class Commands {
  commands: Record<string, Command> = {};
  editorCommands: Record<string, Command> = {};

  constructor(private app: App) {}

  addCommand(cmd: Command): Command {
    this.commands[cmd.id] = cmd;
    if (cmd.editorCallback || cmd.editorCheckCallback) this.editorCommands[cmd.id] = cmd;
    this.app.hotkeyManager.bake();
    return cmd;
  }

  removeCommand(id: string): void {
    delete this.commands[id];
    delete this.editorCommands[id];
    this.app.hotkeyManager.bake();
  }

  findCommand(id: string): Command | undefined {
    return this.commands[id];
  }

  listCommands(): Command[] {
    return Object.values(this.commands).filter((c) => this.isAvailable(c));
  }

  private editorCtx(): { editor: any; view: any } | null {
    const view = this.app.workspace.activeEditor;
    if (!view?.editor) return null;
    return { editor: view.editor, view };
  }

  isAvailable(c: Command): boolean {
    try {
      if (c.checkCallback) return !!c.checkCallback(true);
      if (c.editorCheckCallback) {
        const ctx = this.editorCtx();
        return !!ctx && !!c.editorCheckCallback(true, ctx.editor, ctx.view);
      }
      if (c.editorCallback) return !!this.editorCtx();
      return !!c.callback;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  executeCommand(c: Command): boolean {
    try {
      if (c.checkCallback) {
        if (!c.checkCallback(true)) return false;
        c.checkCallback(false);
        return true;
      }
      if (c.editorCheckCallback) {
        const ctx = this.editorCtx();
        if (!ctx || !c.editorCheckCallback(true, ctx.editor, ctx.view)) return false;
        c.editorCheckCallback(false, ctx.editor, ctx.view);
        return true;
      }
      if (c.editorCallback) {
        const ctx = this.editorCtx();
        if (!ctx) return false;
        c.editorCallback(ctx.editor, ctx.view);
        return true;
      }
      if (c.callback) {
        c.callback();
        return true;
      }
    } catch (e) {
      console.error(`Command "${c.id}" failed`, e);
    }
    return false;
  }

  executeCommandById(id: string): boolean {
    const c = this.commands[id];
    return c ? this.executeCommand(c) : false;
  }
}

export class HotkeyManager {
  customKeys: Record<string, Hotkey[]> = {};
  private baked = new Map<string, string[]>(); // "mods|KEY" -> command ids
  private bakeTimer: any = null;

  constructor(private app: App) {}

  async load(): Promise<void> {
    try {
      this.customKeys = JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + "/hotkeys.json")) ?? {};
    } catch {
      this.customKeys = {};
    }
    this.bakeNow();
  }

  async save(): Promise<void> {
    await this.app.vault.adapter.write(this.app.vault.configDir + "/hotkeys.json", JSON.stringify(this.customKeys, null, 2));
  }

  getDefaultHotkeys(id: string): Hotkey[] {
    return this.app.commands.commands[id]?.hotkeys ?? [];
  }

  getHotkeys(id: string): Hotkey[] | undefined {
    return this.customKeys[id];
  }

  /** Effective hotkeys for a command: custom ones replace the defaults. */
  printHotkeyForCommand(id: string): string {
    const hk = (this.customKeys[id] ?? this.getDefaultHotkeys(id))[0];
    return hk ? hotkeyLabel(hk.modifiers, hk.key) : "";
  }

  setHotkeys(id: string, keys: Hotkey[]): void {
    this.customKeys[id] = keys;
    this.bakeNow();
    this.save();
  }

  removeHotkeys(id: string): void {
    delete this.customKeys[id];
    this.bakeNow();
    this.save();
  }

  bake(): void {
    clearTimeout(this.bakeTimer);
    this.bakeTimer = setTimeout(() => this.bakeNow(), 0);
  }

  private bakeNow(): void {
    this.baked.clear();
    for (const [id, cmd] of Object.entries(this.app.commands.commands)) {
      for (const hk of this.customKeys[id] ?? cmd.hotkeys ?? []) {
        const k = modifiersToString(hk.modifiers) + "|" + hk.key.toUpperCase();
        (this.baked.get(k) ?? this.baked.set(k, []).get(k)!).push(id);
      }
    }
  }

  /** Called on keydown (after scopes). Returns true if a command ran. */
  onTrigger(evt: KeyboardEvent): boolean {
    const k = modifiersToString(eventModifiers(evt)) + "|" + normaliseKey(evt).toUpperCase();
    const ids = this.baked.get(k);
    if (!ids) return false;
    for (const id of ids) {
      const c = this.app.commands.commands[id];
      if (c && (!evt.repeat || c.repeatable) && this.app.commands.executeCommand(c)) return true;
    }
    return false;
  }
}
