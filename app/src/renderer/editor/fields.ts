// State fields Obsidian exposes to editor extensions (obsidian API: editorInfoField,
// editorViewField, editorEditorField, editorLivePreviewField).
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** The MarkdownView (MarkdownFileInfo) that owns this editor. Set with `.init(() => view)`. */
export const editorInfoField = StateField.define<any>({
  create: () => null,
  update: (v) => v,
});

/** Same as editorInfoField (older name). */
export const editorViewField = editorInfoField;

/** The CodeMirror EditorView itself. */
export const editorEditorField = StateField.define<EditorView | null>({
  create: () => null,
  update: (v) => v,
});

export const setLivePreview = StateEffect.define<boolean>();

/** True in live preview, false in source mode. */
export const editorLivePreviewField = StateField.define<boolean>({
  create: () => true,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setLivePreview)) v = e.value;
    return v;
  },
});
