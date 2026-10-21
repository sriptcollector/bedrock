// Settings › Editor
import { ipcRenderer } from "electron";
import { BuiltinTab } from "./base";
import type { Setting } from "../../ui/setting";
import { SETTINGS_IPC } from "../../../shared/ipc-settings";
import { setIcon } from "../../dom/icons";

const LANG_NAMES: Record<string, string> = {};
function langName(code: string): string {
  if (LANG_NAMES[code]) return LANG_NAMES[code];
  try {
    const n = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return (LANG_NAMES[code] = n ? `${n}` : code);
  } catch {
    return code;
  }
}

export function savedSpellcheckLanguages(app: any): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem("spellcheck-languages") ?? "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
  void app;
}
export async function applySpellcheckLanguages(app: any): Promise<void> {
  const langs = savedSpellcheckLanguages(app);
  if (langs?.length) await ipcRenderer.invoke(SETTINGS_IPC.setSpellcheckLanguages, langs).catch(() => undefined);
}

export class EditorTab extends BuiltinTab {
  private langs: { available: string[]; current: string[] } | null = null;
  constructor(app: any) {
    super(app, "editor", "Editor", "pen-line");
  }
  display(): void {
    if (!this.langs)
      ipcRenderer
        .invoke(SETTINGS_IPC.spellcheckLanguages)
        .then((l) => {
          this.langs = l;
          this.rerender();
        })
        .catch(() => undefined);
    super.display();
  }
  getControlValue(key: string): unknown {
    if (key === "livePreview") return this.app.vault.getConfig("livePreview") === false ? "source" : "live-preview";
    if (key === "editor-status") return !!this.app.internalPlugins?.plugins?.["editor-status"]?.enabled;
    return super.getControlValue(key);
  }
  setControlValue(key: string, value: unknown): void {
    if (key === "livePreview") {
      super.setControlValue("livePreview", value !== "source");
      return;
    }
    if (key === "editor-status") {
      void this.app.internalPlugins?.setEnabled?.("editor-status", !!value);
      return;
    }
    super.setControlValue(key, value);
  }
  getSettingDefinitions(): any[] {
    const t = (name: string, key: string, desc: string) => ({ name, desc, control: { type: "toggle", key } });
    const langs = this.langs;
    return [
      { name: "Default view for new tabs", desc: "Whether new tabs open notes for editing or for reading.", control: { type: "dropdown", key: "defaultViewMode", options: { source: "Editing view", preview: "Reading view" } } },
      { name: "Default editing mode", desc: "Live Preview hides Markdown symbols as you write; Source mode shows everything as typed.", control: { type: "dropdown", key: "livePreview", options: { "live-preview": "Live Preview", source: "Source mode" } } },
      t("Show editing mode in status bar", "editor-status", "Show which editing mode is on in the status bar, and click it to switch."),
      {
        type: "group",
        heading: "Display",
        items: [
          t("Inline title", "showInlineTitle", "Show the file name as an editable title at the top of each note."),
          t("Readable line length", "readableLineLength", "Keep lines to a comfortable reading width instead of the full window width."),
          t("Strict line breaks", "strictLineBreaks", "In reading view, join lines that aren't separated by a blank line, as standard Markdown does."),
          { name: "Properties in document", desc: "How a note's properties show at its top.", control: { type: "dropdown", key: "propertiesInDocument", options: { visible: "Visible", hidden: "Hidden", source: "Source" } } },
          t("Fold heading", "foldHeading", "Let headings be folded to hide the text below them."),
          t("Fold indent", "foldIndent", "Let indented blocks, such as nested list items, be folded."),
          t("Line numbers", "showLineNumber", "Number the lines in the editor's margin."),
          t("Indentation guides", "showIndentGuide", "Draw lines that show how deeply list items and code are indented."),
          t("Right-to-left (RTL)", "rightToLeft", "Write notes from right to left, for languages such as Arabic and Hebrew."),
          t("Show Mermaid diagrams in notes", "mermaid", "Draw Mermaid code blocks as diagrams instead of showing their code."),
        ],
      },
      {
        type: "group",
        heading: "Behavior",
        items: [
          {
            name: "Spellcheck",
            desc: "Underline misspelled words while you type.",
            render: (s: Setting) => {
              s.addToggle((tg) =>
                tg.setValue(this.app.vault.getConfig("spellcheck") !== false).onChange((v) => {
                  this.setControlValue("spellcheck", v);
                  this.rerender();
                }),
              );
            },
          },
          {
            name: "Spellcheck languages",
            desc: langs?.current?.length ? `Checking: ${langs.current.map(langName).join(", ")}.` : "Languages to check spelling in.",
            visible: () => this.app.vault.getConfig("spellcheck") !== false && process.platform !== "darwin",
            render: (s: Setting) => {
              const cur = langs?.current ?? [];
              for (const c of cur) {
                const chip = s.controlEl.createDiv({ cls: "setting-hotkey", text: langName(c) });
                const x = chip.createSpan({ cls: "setting-hotkey-icon setting-delete-hotkey", attr: { "aria-label": "Remove" } });
                setIcon(x, "x");
                x.addEventListener("click", () => this.setLangs(cur.filter((l) => l !== c)));
              }
              s.addDropdown((d) => {
                d.addOption("", "+");
                for (const l of (langs?.available ?? []).filter((l) => !cur.includes(l)).sort((a, b) => langName(a).localeCompare(langName(b)))) d.addOption(l, langName(l));
                d.setValue("").onChange((v) => v && this.setLangs([...cur, v]));
              });
            },
          },
          t("Auto-pair brackets", "autoPairBrackets", "Type the closing bracket or quote for you."),
          t("Auto-pair Markdown syntax", "autoPairMarkdown", "Type the closing symbol for bold, italic, code and highlight for you."),
          t("Smart lists", "smartIndentList", "Continue lists on Enter and keep numbered lists in order."),
          t("Indent using tabs", "useTab", "Indent with tab characters. Turn off to indent with spaces."),
          {
            name: "Indent visual width",
            desc: "How many spaces wide a tab looks.",
            render: (s: Setting) => {
              s.addExtraButton((b) =>
                b
                  .setIcon("rotate-ccw")
                  .setTooltip("Restore default")
                  .onClick(() => {
                    this.setControlValue("tabSize", 4);
                    this.rerender();
                  }),
              );
              const v0 = Number(this.app.vault.getConfig("tabSize")) || 4;
              const val = s.controlEl.createSpan({ cls: "slider-value", text: String(v0) });
              s.addSlider((sl) =>
                sl
                  .setLimits(2, 8, 1)
                  .setValue(v0)
                  .setDynamicTooltip()
                  .onChange((v) => {
                    val.setText(String(v));
                    this.setControlValue("tabSize", v);
                  }),
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          t("Convert pasted HTML to Markdown", "autoConvertHtml", "When you paste formatted text from a web page, turn it into Markdown."),
          t("Vim key bindings", "vimMode", "Edit with Vim keyboard commands."),
        ],
      },
    ];
  }
  private async setLangs(l: string[]): Promise<void> {
    localStorage.setItem("spellcheck-languages", JSON.stringify(l));
    const cur = await ipcRenderer.invoke(SETTINGS_IPC.setSpellcheckLanguages, l).catch(() => l);
    if (this.langs) this.langs.current = cur;
    this.rerender();
  }
}
