// Tab drag and drop: reorder within a tab bar, move to another tab group, or drop on a pane's
// edge to split it (left/right/top/bottom) or its centre to join that group. Files dragged from
// the file explorer can be dropped onto a pane to open them there.
import type { WorkspaceLeaf } from "./leaf";
import type { WorkspaceTabs } from "./items";
import type { Workspace } from "./workspace";

export const FILE_DRAG_TYPE = "application/x-bedrock-file";

type Zone = "left" | "right" | "top" | "bottom" | "center";

export class TabDnd {
  dragLeaf: WorkspaceLeaf | null = null;
  private overlayEl: HTMLElement;
  private indicatorEl: HTMLElement;

  constructor(private ws: Workspace) {
    this.overlayEl = createDiv("workspace-drop-overlay");
    this.indicatorEl = createDiv("workspace-drop-insert-indicator");
  }

  private hide(): void {
    this.overlayEl.detach();
    this.indicatorEl.detach();
  }

  attachLeaf(leaf: WorkspaceLeaf): void {
    const h = leaf.tabHeaderEl;
    h.addEventListener("dragstart", (e) => {
      this.dragLeaf = leaf;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", leaf.getDisplayText());
      document.body.addClass("is-dragging-tab");
      h.addClass("is-being-dragged");
    });
    h.addEventListener("dragend", (e) => {
      this.dragLeaf = null;
      document.body.removeClass("is-dragging-tab");
      h.removeClass("is-being-dragged");
      this.hide();
      // Dropped outside the window (nothing took the drop): the tab moves to a new window there.
      const win = h.ownerDocument.defaultView ?? window;
      const outside = e.screenX < win.screenX || e.screenY < win.screenY || e.screenX > win.screenX + win.outerWidth || e.screenY > win.screenY + win.outerHeight;
      if (e.dataTransfer?.dropEffect === "none" && outside && (e.screenX || e.screenY) && this.ws.isRootLeaf(leaf))
        this.ws.moveLeafToPopout(leaf, { x: e.screenX - 40, y: e.screenY - 20 });
    });
  }

  attachTabs(tabs: WorkspaceTabs): void {
    const bar = tabs.tabHeaderContainerEl;
    const insertIndex = (x: number) => {
      const headers = tabs.children.map((l) => l.tabHeaderEl.getBoundingClientRect());
      let i = 0;
      while (i < headers.length && x > headers[i].left + headers[i].width / 2) i++;
      return i;
    };
    bar.addEventListener("dragover", (e) => {
      if (!this.dragLeaf) return;
      e.preventDefault();
      const i = insertIndex(e.clientX);
      const headers = tabs.children.map((l) => l.tabHeaderEl.getBoundingClientRect());
      const br = bar.getBoundingClientRect();
      const x = i < headers.length ? headers[i].left : headers.length ? headers[headers.length - 1].right : br.left + 4;
      this.overlayEl.detach();
      document.body.appendChild(this.indicatorEl);
      Object.assign(this.indicatorEl.style, { left: x - 1 + "px", top: br.top + 4 + "px", height: br.height - 8 + "px" });
    });
    bar.addEventListener("dragleave", (e) => {
      if (!bar.contains(e.relatedTarget as Node)) this.indicatorEl.detach();
    });
    bar.addEventListener("drop", (e) => {
      if (!this.dragLeaf) return;
      e.preventDefault();
      const leaf = this.dragLeaf;
      let i = insertIndex(e.clientX);
      if (leaf.parent === tabs && tabs.children.indexOf(leaf) < i) i--;
      this.hide();
      this.ws.moveLeafToTabs(leaf, tabs, i);
    });

    const content = tabs.tabsContainerEl;
    content.addEventListener("dragover", (e) => {
      const isFile = e.dataTransfer?.types.includes(FILE_DRAG_TYPE);
      if (!this.dragLeaf && !isFile) return;
      e.preventDefault();
      const zone = isFile ? "center" : this.zoneFor(content, e, tabs.isSidebar);
      this.showOverlay(content, zone);
    });
    content.addEventListener("dragleave", (e) => {
      if (!content.contains(e.relatedTarget as Node)) this.overlayEl.detach();
    });
    content.addEventListener("drop", (e) => {
      const filePath = e.dataTransfer?.getData(FILE_DRAG_TYPE);
      if (filePath) {
        e.preventDefault();
        this.hide();
        const f = this.ws.app.vault.getFileByPath(filePath);
        const leaf = tabs.children[tabs.currentTab];
        if (f && leaf) leaf.openFile(f, { active: true });
        return;
      }
      if (!this.dragLeaf) return;
      e.preventDefault();
      const zone = this.zoneFor(content, e, tabs.isSidebar);
      const leaf = this.dragLeaf;
      this.hide();
      if (zone === "center") this.ws.moveLeafToTabs(leaf, tabs, tabs.children.length);
      else this.ws.moveLeafToSplit(leaf, tabs, zone);
    });
  }

  private zoneFor(el: HTMLElement, e: DragEvent, sidebar: boolean): Zone {
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (sidebar) return fy < 0.3 ? "top" : fy > 0.7 ? "bottom" : "center";
    const edge = 0.25;
    const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
    const min = (Object.entries(d) as [Zone, number][]).sort((a, b) => a[1] - b[1])[0];
    return min[1] < edge ? min[0] : "center";
  }

  private showOverlay(el: HTMLElement, zone: Zone): void {
    const r = el.getBoundingClientRect();
    let { left, top, width, height } = r;
    if (zone === "left") width /= 2;
    if (zone === "right") {
      left += width / 2;
      width /= 2;
    }
    if (zone === "top") height /= 2;
    if (zone === "bottom") {
      top += height / 2;
      height /= 2;
    }
    this.indicatorEl.detach();
    document.body.appendChild(this.overlayEl);
    Object.assign(this.overlayEl.style, { left: left + 4 + "px", top: top + 4 + "px", width: width - 8 + "px", height: height - 8 + "px" });
    this.overlayEl.setAttr("data-zone", zone);
  }
}
