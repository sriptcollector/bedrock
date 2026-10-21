// FileSystemAdapter: the DataAdapter for a vault folder on disk (obsidian.d.ts DataAdapter).
// All paths are vault-relative normalized paths; config files under .obsidian go through here too.
import fs from "node:fs";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { ipcRenderer } from "electron";
import { IPC } from "../../shared/ipc";

export interface Stat {
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  size: number;
}

export interface ListedFiles {
  files: string[];
  folders: string[];
}

export interface DataWriteOptions {
  ctime?: number;
  mtime?: number;
}

export class FileSystemAdapter {
  basePath: string;
  fs = fs;
  fsPromises = fs.promises;
  path = nodePath;
  url = require("node:url");
  /** Paths we just wrote, so the watcher can tell our own writes from external ones. */
  recentWrites = new Map<string, number>();

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  getName(): string {
    return nodePath.basename(this.basePath);
  }
  getBasePath(): string {
    return this.basePath;
  }
  getFullPath(p: string): string {
    return p === "/" || p === "" ? this.basePath : nodePath.join(this.basePath, p);
  }
  getFullRealPath(p: string): string {
    return this.getFullPath(p);
  }
  getFilePath(p: string): string {
    return pathToFileURL(this.getFullPath(p)).href;
  }

  async exists(p: string, sensitive?: boolean): Promise<boolean> {
    try {
      await fs.promises.access(this.getFullPath(p));
      if (sensitive) {
        const dir = nodePath.dirname(this.getFullPath(p));
        return (await fs.promises.readdir(dir)).includes(nodePath.basename(p));
      }
      return true;
    } catch {
      return false;
    }
  }

  async stat(p: string): Promise<Stat | null> {
    try {
      const s = await fs.promises.stat(this.getFullPath(p));
      return { type: s.isDirectory() ? "folder" : "file", ctime: s.birthtimeMs || s.ctimeMs, mtime: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }

  async list(p: string): Promise<ListedFiles> {
    const out: ListedFiles = { files: [], folders: [] };
    const ents = await fs.promises.readdir(this.getFullPath(p), { withFileTypes: true });
    const prefix = p === "/" || p === "" ? "" : p + "/";
    for (const e of ents) (e.isDirectory() ? out.folders : out.files).push(prefix + e.name);
    return out;
  }

  read(p: string): Promise<string> {
    return fs.promises.readFile(this.getFullPath(p), "utf8");
  }

  async readBinary(p: string): Promise<ArrayBuffer> {
    const b = await fs.promises.readFile(this.getFullPath(p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }

  private mark(p: string): void {
    this.recentWrites.set(p, Date.now());
    if (this.recentWrites.size > 500) {
      const cutoff = Date.now() - 5000;
      for (const [k, t] of this.recentWrites) if (t < cutoff) this.recentWrites.delete(k);
    }
  }

  async write(p: string, data: string, opts?: DataWriteOptions): Promise<void> {
    await this.writeAny(p, data, opts);
  }

  async writeBinary(p: string, data: ArrayBuffer, opts?: DataWriteOptions): Promise<void> {
    await this.writeAny(p, Buffer.from(data), opts);
  }

  private async writeAny(p: string, data: string | Buffer, opts?: DataWriteOptions): Promise<void> {
    const full = this.getFullPath(p);
    this.mark(p);
    await fs.promises.mkdir(nodePath.dirname(full), { recursive: true });
    // Write to a temp file then rename, so a crash or a sync read never sees half a note.
    const tmp = nodePath.join(nodePath.dirname(full), `.${nodePath.basename(full)}.${process.pid}.tmp`);
    try {
      await fs.promises.writeFile(tmp, data);
      await fs.promises.rename(tmp, full);
    } catch {
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
      await fs.promises.writeFile(full, data);
    }
    if (opts?.mtime || opts?.ctime) {
      const t = (opts.mtime ?? Date.now()) / 1000;
      await fs.promises.utimes(full, t, t).catch(() => undefined);
    }
  }

  async append(p: string, data: string, _o?: DataWriteOptions): Promise<void> {
    this.mark(p);
    await fs.promises.appendFile(this.getFullPath(p), data);
  }

  async appendBinary(p: string, data: ArrayBuffer, _o?: DataWriteOptions): Promise<void> {
    this.mark(p);
    await fs.promises.appendFile(this.getFullPath(p), Buffer.from(data));
  }

  async process(p: string, fn: (d: string) => string, opts?: DataWriteOptions): Promise<string> {
    const next = fn(await this.read(p));
    await this.write(p, next, opts);
    return next;
  }

  getResourcePath(p: string): string {
    let mtime = 0;
    try {
      mtime = Math.floor(fs.statSync(this.getFullPath(p)).mtimeMs);
    } catch {
      /* missing */
    }
    return pathToFileURL(this.getFullPath(p)).href + "?" + mtime;
  }

  async mkdir(p: string): Promise<void> {
    this.mark(p);
    await fs.promises.mkdir(this.getFullPath(p), { recursive: true });
  }

  async trashSystem(p: string): Promise<boolean> {
    this.mark(p);
    return ipcRenderer.invoke(IPC.trashItem, this.getFullPath(p));
  }

  async trashLocal(p: string): Promise<void> {
    this.mark(p);
    const name = nodePath.basename(p);
    let dest = ".trash/" + name;
    let n = 1;
    while (await this.exists(dest)) {
      const ext = nodePath.extname(name);
      dest = `.trash/${name.slice(0, name.length - ext.length)} ${n++}${ext}`;
    }
    await fs.promises.mkdir(this.getFullPath(".trash"), { recursive: true });
    await fs.promises.rename(this.getFullPath(p), this.getFullPath(dest));
  }

  async rmdir(p: string, recursive: boolean): Promise<void> {
    this.mark(p);
    await fs.promises.rm(this.getFullPath(p), { recursive, force: false });
  }

  async remove(p: string): Promise<void> {
    this.mark(p);
    await fs.promises.unlink(this.getFullPath(p));
  }

  async rename(p: string, np: string): Promise<void> {
    this.mark(p);
    this.mark(np);
    const dest = this.getFullPath(np);
    await fs.promises.mkdir(nodePath.dirname(dest), { recursive: true });
    if (p.toLowerCase() === np.toLowerCase() && p !== np) {
      // Case-only rename on case-insensitive file systems: go through a temp name.
      const tmp = dest + ".rename-tmp";
      await fs.promises.rename(this.getFullPath(p), tmp);
      await fs.promises.rename(tmp, dest);
      return;
    }
    if (await this.exists(np)) throw new Error("Destination file already exists!");
    await fs.promises.rename(this.getFullPath(p), dest);
  }

  async copy(p: string, np: string): Promise<void> {
    this.mark(np);
    const dest = this.getFullPath(np);
    if (await this.exists(np)) throw new Error("Destination file already exists!");
    await fs.promises.mkdir(nodePath.dirname(dest), { recursive: true });
    await fs.promises.cp(this.getFullPath(p), dest, { recursive: true });
  }

  static readLocalFile(p: string): Promise<ArrayBuffer> {
    return fs.promises.readFile(p).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }

  static mkdir(p: string): Promise<void> {
    return fs.promises.mkdir(p, { recursive: true }).then(() => undefined);
  }
}
