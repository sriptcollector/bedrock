// The main window's side of agent access: the main process (main/agents/host.ts) runs every agent
// operation and sends the writes here, so they go through app.vault like an edit made in the app:
// open editors update right away and every view gets the usual create/modify/rename events.
// Also answers "which note is open?" and "open this note". Only the main (synced) vault window
// registers.
import { ipcRenderer } from "electron";
import { IPC } from "../../shared/ipc";
import { dirname } from "../../core/path";

type Req = { id: string; op: string; args: any };

export function mountAgentBridge(app: any): void {
  if (app.boot?.isMainVault === false) return;
  const vault = app.vault;

  const ensureFolder = async (folder: string) => {
    if (!folder || vault.getAbstractFileByPath(folder)) return;
    await ensureFolder(dirname(folder));
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder).catch(() => undefined);
  };

  const ops: Record<string, (a: any) => Promise<any>> = {
    write: async ({ path, text }) => {
      const f = vault.getFileByPath(path);
      if (f) return void (await vault.modify(f, text));
      if (await vault.adapter.exists(path)) {
        // On disk but not in the tree yet (the watcher hasn't caught up): write, then let the
        // vault pick it up now.
        await vault.adapter.write(path, text);
        await vault.onExternalChange(path);
        return;
      }
      await ensureFolder(dirname(path));
      await vault.create(path, text);
    },
    rename: async ({ from, to }) => {
      const f = vault.getAbstractFileByPath(from);
      if (!f) {
        await vault.adapter.rename(from, to);
        await vault.onExternalChange(from);
        await vault.onExternalChange(to);
        return;
      }
      await ensureFolder(dirname(to));
      await vault.rename(f, to);
    },
    trash: async ({ path }) => {
      const before = new Set<string>(((await vault.adapter.list(".trash").catch(() => ({ files: [] }))).files ?? []) as string[]);
      const f = vault.getAbstractFileByPath(path);
      if (f) await vault.trash(f, false);
      else await vault.adapter.trashLocal(path);
      const after: string[] = ((await vault.adapter.list(".trash").catch(() => ({ files: [] }))).files ?? []) as string[];
      return after.find((p) => !before.has(p)) ?? ".trash/" + path.split("/").pop();
    },
    active: async () => app.workspace.getActiveFile()?.path ?? null,
    open: async ({ path, newTab, line }) => {
      const f = vault.getFileByPath(path);
      if (!f) throw Object.assign(new Error(`“${path}” isn't in the vault yet. Try again in a moment.`), { code: "not_found" });
      const leaf = app.workspace.getLeaf(newTab ? "tab" : false);
      await leaf.openFile(f, { active: true });
      if (line && leaf.view?.setEphemeralState) leaf.view.setEphemeralState({ line: Math.max(0, line - 1) });
      app.workspace.setActiveLeaf?.(leaf, { focus: true });
    },
  };

  ipcRenderer.on(IPC.agentRequest, async (_e, req: Req) => {
    const fn = ops[req?.op];
    try {
      if (!fn) throw new Error(`Unknown operation “${req?.op}”.`);
      ipcRenderer.send(IPC.agentResponse, { id: req.id, ok: true, value: await fn(req.args ?? {}) });
    } catch (e: any) {
      ipcRenderer.send(IPC.agentResponse, { id: req.id, ok: false, error: { code: e?.code === "not_found" ? "not_found" : "unavailable", message: String(e?.message ?? e) } });
    }
  });
  ipcRenderer.send(IPC.agentBridgeReady, { vaultPath: app.boot.vaultPath });
}
