// Spellcheck helpers: suggestions for a misspelled word (Chromium's spellchecker through
// webFrame, in the renderer), "Add to dictionary", and the spellcheck languages list (session,
// in the main process). Languages persist in Chromium's own profile, like the original.
import type { Menu } from "../ui/menu";
import { EDITOR_IPC } from "../../shared/editor-ipc";

function webFrame(): any {
  try {
    return (window as any).require?.("electron")?.webFrame ?? null;
  } catch {
    return null;
  }
}

/** Suggestions for `word` when it is misspelled, else null. */
export function spellingSuggestions(word: string): string[] | null {
  const wf = webFrame();
  if (!wf?.isWordMisspelled || !word || !/\p{L}/u.test(word)) return null;
  try {
    if (!wf.isWordMisspelled(word)) return null;
    return (wf.getWordSuggestions?.(word) ?? []) as string[];
  } catch {
    return null;
  }
}

export function addToDictionary(word: string): Promise<boolean> {
  return (window as any).bedrockNative?.invoke(EDITOR_IPC.addToDictionary, word) ?? Promise.resolve(false);
}

export async function getSpellcheckLanguages(): Promise<{ available: string[]; current: string[] }> {
  return ((await (window as any).bedrockNative?.invoke(EDITOR_IPC.spellcheckInfo)) as any) ?? { available: [], current: [] };
}

export async function setSpellcheckLanguages(langs: string[]): Promise<string[]> {
  return ((await (window as any).bedrockNative?.invoke(EDITOR_IPC.setSpellcheckLanguages, langs)) as any) ?? [];
}

/** Add the spelling section (suggestions, "Add to dictionary") for `word` to a menu. */
export function addSpellingItems(m: Menu, word: string, replace: (s: string) => void): boolean {
  const sugg = spellingSuggestions(word);
  if (!sugg) return false;
  for (const s of sugg.slice(0, 5)) m.addItem((i) => i.setTitle(s).setSection("spellcheck").onClick(() => replace(s)));
  if (!sugg.length) m.addItem((i) => i.setTitle("No suggestions").setDisabled(true).setSection("spellcheck"));
  m.addItem((i) =>
    i
      .setTitle("Add to dictionary")
      .setIcon("book-plus")
      .setSection("spellcheck")
      .onClick(() => void addToDictionary(word)),
  );
  return true;
}
