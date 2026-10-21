// IPC channels for editor features (see main/editor-ipc.ts).
export const EDITOR_IPC = {
  pickPdfPath: "bedrock:editor-pick-pdf-path",
  printToPdf: "bedrock:editor-print-to-pdf",
  spellcheckInfo: "bedrock:editor-spellcheck-info",
  setSpellcheckLanguages: "bedrock:editor-spellcheck-set",
  addToDictionary: "bedrock:editor-spellcheck-add-word",
} as const;
