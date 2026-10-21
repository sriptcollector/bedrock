// The vault's in-memory file tree (obsidian.d.ts TAbstractFile / TFile / TFolder).
import type { Vault } from "./vault";

export interface FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export abstract class TAbstractFile {
  declare vault: Vault;
  declare path: string;
  declare name: string;
  declare parent: TFolder | null;
  deleted = false;

  constructor(vault: Vault, path: string) {
    this.vault = vault;
    this.parent = null;
    this.setPath(path);
  }

  setPath(path: string): void {
    this.path = path;
    this.name = path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1);
  }

  getNewPathAfterRename(name: string): string {
    const parent = this.parent;
    return parent && !parent.isRoot() ? parent.path + "/" + name : name;
  }
}

export class TFile extends TAbstractFile {
  stat: FileStats = { ctime: 0, mtime: 0, size: 0 };
  // `declare`: set by setPath() inside the base constructor, so no field initializer may reset them.
  declare basename: string;
  declare extension: string;

  setPath(path: string): void {
    super.setPath(path);
    const i = this.name.lastIndexOf(".");
    this.basename = i > 0 ? this.name.slice(0, i) : this.name;
    this.extension = i > 0 ? this.name.slice(i + 1).toLowerCase() : "";
  }

  getShortName(): string {
    return this.extension === "md" ? this.basename : this.name;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === "/";
  }

  getFileCount(): number {
    let n = 0;
    for (const c of this.children) n += c instanceof TFolder ? c.getFileCount() : 1;
    return n;
  }

  getParentPrefix(): string {
    return this.isRoot() ? "" : this.path + "/";
  }
}
