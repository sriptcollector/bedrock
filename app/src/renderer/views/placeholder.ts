// Stand-in for a view type that isn't registered (yet): a plugin view whose plugin is off, or a
// built-in view still being built. It keeps the saved state so workspace.json round-trips, and
// the leaf switches to the real view as soon as that type is registered.
import { ItemView } from "../workspace/view";
import type { WorkspaceLeaf } from "../workspace/leaf";

const KNOWN: Record<string, { title: string; icon: string }> = {
  "file-explorer": { title: "Files", icon: "folder-closed" },
  search: { title: "Search", icon: "search" },
  bookmarks: { title: "Bookmarks", icon: "bookmark" },
  backlink: { title: "Backlinks", icon: "arrow-down-left" },
  "outgoing-link": { title: "Outgoing links", icon: "arrow-up-right" },
  tag: { title: "Tags", icon: "tags" },
  outline: { title: "Outline", icon: "list" },
  graph: { title: "Graph view", icon: "git-fork" },
  localgraph: { title: "Local graph", icon: "git-fork" },
  canvas: { title: "Canvas", icon: "layout-dashboard" },
  "all-properties": { title: "All properties", icon: "archive" },
  "file-properties": { title: "File properties", icon: "info" },
  bases: { title: "Base", icon: "table" },
  empty: { title: "New tab", icon: "file" },
};

export class PlaceholderView extends ItemView {
  placeholderType: string;
  private savedState: any = {};

  constructor(leaf: WorkspaceLeaf, type: string) {
    super(leaf);
    this.placeholderType = type;
    this.icon = KNOWN[type]?.icon ?? "box";
  }

  getViewType(): string {
    return this.placeholderType;
  }

  getDisplayText(): string {
    return this.savedState?.file ? String(this.savedState.file).split("/").pop()!.replace(/\.[^.]+$/, "") : KNOWN[this.placeholderType]?.title ?? this.placeholderType;
  }

  getState(): any {
    return this.savedState;
  }

  async setState(state: any): Promise<void> {
    this.savedState = state ?? {};
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    const box = this.contentEl.createDiv("bedrock-placeholder");
    const known = KNOWN[this.placeholderType];
    box.createDiv({ cls: "bedrock-placeholder-title", text: known ? known.title : `"${this.placeholderType}" view` });
    box.createDiv({
      cls: "bedrock-placeholder-desc",
      text: known ? "This view is coming in a later version." : "This view comes from a plugin that isn't turned on. Turn the plugin on in Settings → Community plugins to use it.",
    });
  }
}
