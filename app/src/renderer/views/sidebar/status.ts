// Status bar items owned by the sidebar features: "N backlinks" (opens Backlinks) and
// "N properties" (opens File properties), placed before the editor status and word count.
import { Component } from "../../api/events";
import type { TFile } from "../../vault/files";
import { computeLinked } from "./backlinks";

export class SidebarStatus extends Component {
  backlinkEl: HTMLElement;
  propsEl: HTMLElement;
  private timer: any = null;

  constructor(private app: any) {
    super();
    const bar: HTMLElement = app.statusBar.containerEl;
    this.propsEl = createDiv("status-bar-item plugin-properties mod-clickable");
    this.backlinkEl = createDiv("status-bar-item plugin-backlink mod-clickable");
    bar.prepend(this.propsEl);
    bar.prepend(this.backlinkEl);
    this.backlinkEl.addEventListener("click", () => app.commands.executeCommandById("backlink:open-backlinks"));
    this.propsEl.addEventListener("click", () => app.commands.executeCommandById("properties:open-local"));
  }

  onload(): void {
    const ws = this.app.workspace;
    const sched = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.update(), 150);
    };
    this.registerEvent(ws.on("file-open", sched));
    this.registerEvent(ws.on("active-leaf-change", sched));
    this.registerEvent(this.app.metadataCache.on("resolved", sched));
    this.registerEvent(this.app.metadataCache.on("changed", sched));
    this.register(() => {
      this.backlinkEl.remove();
      this.propsEl.remove();
    });
    sched();
  }

  async update(): Promise<void> {
    const f: TFile | null = this.app.workspace.getActiveFile();
    const isMd = !!f && f.extension === "md" && this.app.workspace.activeEditor?.file === f;
    if (!f || !isMd) {
      this.backlinkEl.setText("");
      this.propsEl.setText("");
      return;
    }
    const n = (await computeLinked(this.app, f)).length;
    if (this.app.workspace.getActiveFile() !== f) return;
    this.backlinkEl.setText(`${n} ${n === 1 ? "backlink" : "backlinks"}`);
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    const p = fm ? Object.keys(fm).filter((k) => k !== "position").length : 0;
    this.propsEl.setText(p ? `${p} ${p === 1 ? "property" : "properties"}` : "");
  }
}
