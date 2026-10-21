// Vim mode extras: ex commands that act on the app (:w saves, :q closes the tab, :wq both,
// :e <note> opens a note, :sp / :vs split).
import { Vim, getCM } from "@replit/codemirror-vim";

let done = false;

function ownerOf(cm: any): any {
  const view = cm?.cm6 ?? cm;
  const app = (window as any).app;
  if (!app) return null;
  let found: any = null;
  app.workspace.iterateAllLeaves?.((leaf: any) => {
    if (leaf.view?.cm === view) found = leaf.view;
  });
  return found ?? app.workspace.activeEditor;
}

export function setupVimMappings(): void {
  if (done) return;
  done = true;
  Vim.defineEx("write", "w", (cm: any) => {
    ownerOf(cm)?.save?.();
  });
  Vim.defineEx("quit", "q", (cm: any) => {
    const v = ownerOf(cm);
    v?.leaf?.detach?.();
  });
  Vim.defineEx("wq", "wq", (cm: any) => {
    const v = ownerOf(cm);
    Promise.resolve(v?.save?.()).then(() => v?.leaf?.detach?.());
  });
  Vim.defineEx("xit", "x", (cm: any) => {
    const v = ownerOf(cm);
    Promise.resolve(v?.save?.()).then(() => v?.leaf?.detach?.());
  });
  Vim.defineEx("edit", "e", (cm: any, params: any) => {
    const v = ownerOf(cm);
    const name = (params?.args ?? []).join(" ");
    if (name) (window as any).app?.workspace.openLinkText(name, v?.file?.path ?? "", false);
  });
  Vim.defineEx("split", "sp", (cm: any) => {
    const v = ownerOf(cm);
    if (v?.leaf) (window as any).app?.workspace.duplicateLeaf?.(v.leaf, "split", "horizontal");
  });
  Vim.defineEx("vsplit", "vs", (cm: any) => {
    const v = ownerOf(cm);
    if (v?.leaf) (window as any).app?.workspace.duplicateLeaf?.(v.leaf, "split", "vertical");
  });
  void getCM;
}
