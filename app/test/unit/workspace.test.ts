// @vitest-environment happy-dom
// Workspace layout model: load Obsidian's workspace.json shape, round-trip it, split / move / close.
import { beforeEach, describe, expect, it } from "vitest";
import { installDomHelpers } from "../../src/renderer/dom/augment";
installDomHelpers(window as any);
import { Workspace } from "../../src/renderer/workspace/workspace";
import { ViewRegistry } from "../../src/renderer/workspace/registry";
import { ItemView } from "../../src/renderer/workspace/view";
import { WorkspaceSplit, WorkspaceTabs } from "../../src/renderer/workspace/items";

class TestView extends ItemView {
  type: string;
  state: any = {};
  navigation = true;
  constructor(leaf: any, type: string) {
    super(leaf);
    this.type = type;
  }
  getViewType() {
    return this.type;
  }
  getDisplayText() {
    return this.state.file ?? this.type;
  }
  getState() {
    return this.state;
  }
  async setState(s: any) {
    this.state = s ?? {};
  }
}

// A layout as Obsidian 1.x writes it (ids, tabs inside splits, sidebars with width/collapsed).
const OBSIDIAN_LAYOUT = {
  main: {
    id: "m1",
    type: "split",
    children: [
      {
        id: "t1",
        type: "tabs",
        children: [
          { id: "l1", type: "leaf", state: { type: "graph", state: {}, icon: "lucide-git-fork", title: "Graph view" } },
          { id: "l2", type: "leaf", state: { type: "markdown", state: { file: "A.md", mode: "source", source: false }, icon: "lucide-file", title: "A" } },
        ],
        currentTab: 1,
      },
      { id: "t2", type: "tabs", children: [{ id: "l3", type: "leaf", pinned: true, state: { type: "markdown", state: { file: "B.md", mode: "preview" } } }] },
    ],
    direction: "vertical",
  },
  left: {
    id: "s1",
    type: "split",
    children: [{ id: "t3", type: "tabs", children: [{ id: "l4", type: "leaf", state: { type: "file-explorer", state: { sortOrder: "alphabetical" } } }] }],
    direction: "horizontal",
    width: 280,
  },
  right: {
    id: "s2",
    type: "split",
    children: [{ id: "t4", type: "tabs", children: [{ id: "l5", type: "leaf", state: { type: "outline", state: { file: "A.md" } } }] }],
    direction: "horizontal",
    width: 300,
    collapsed: true,
  },
  "left-ribbon": { hiddenItems: { "switcher:open": false } },
  active: "l2",
  lastOpenFiles: ["A.md", "B.md"],
};

let ws: Workspace;
let saved: string | null;

beforeEach(() => {
  document.body.innerHTML = "";
  saved = null;
  const registry = new ViewRegistry();
  for (const t of ["markdown", "file-explorer", "empty"]) registry.registerView(t, (leaf) => new TestView(leaf, t));
  const app: any = {
    vault: { configDir: ".obsidian", getName: () => "Test", adapter: { read: async () => { throw new Error("none"); }, write: async (_p: string, d: string) => void (saved = d) }, getFileByPath: () => null },
    brand: { displayName: "Bedrock" },
  };
  ws = new Workspace(app, registry);
  app.workspace = ws;
  document.body.appendChild(ws.containerEl);
});

const strip = (x: any): any => {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === "object") {
    const o: any = {};
    for (const [k, v] of Object.entries(x)) if (!["icon", "title", "dimension"].includes(k)) o[k] = strip(v);
    return o;
  }
  return x;
};

describe("workspace layout", () => {
  it("loads Obsidian's workspace.json and round-trips it (unknown view types preserved)", async () => {
    await ws.changeLayout(JSON.parse(JSON.stringify(OBSIDIAN_LAYOUT)));
    const out = ws.getLayout();
    const want = strip(OBSIDIAN_LAYOUT);
    delete want["left-ribbon"];
    const got = strip(out);
    delete got["left-ribbon"];
    // Pinned is stored on the leaf; Obsidian also mirrors it - compare the parts that matter.
    expect(got.main).toEqual(want.main);
    expect(got.left).toEqual(want.left);
    expect(got.right).toEqual(want.right);
    expect(got.active).toBe("l2");
    expect(got.lastOpenFiles).toEqual(["A.md", "B.md"]);
    expect(ws.rightSplit.collapsed).toBe(true);
    expect(ws.leftSplit.size).toBe(280);
  });

  it("activates the saved active leaf and shows its tab", async () => {
    await ws.changeLayout(JSON.parse(JSON.stringify(OBSIDIAN_LAYOUT)));
    expect(ws.activeLeaf?.id).toBe("l2");
    const t1 = ws.rootSplit.children[0] as WorkspaceTabs;
    expect(t1.currentTab).toBe(1);
    expect(t1.children[1].tabHeaderEl.classList.contains("is-active")).toBe(true);
  });

  it("splits right and down, nesting splits as needed", async () => {
    await ws.changeLayout(ws.defaultLayout());
    const leaf = ws.getMostRecentLeaf()!;
    const right = ws.createLeafBySplit(leaf, "vertical");
    expect(ws.rootSplit.children.length).toBe(2);
    const down = ws.createLeafBySplit(right, "horizontal");
    const second = ws.rootSplit.children[1];
    expect(second).toBeInstanceOf(WorkspaceSplit);
    expect((second as WorkspaceSplit).direction).toBe("horizontal");
    expect(down.parent?.parent).toBe(second);
    const layout = ws.getLayout();
    expect(layout.main.children[1].type).toBe("split");
    expect(layout.main.children[1].children.length).toBe(2);
  });

  it("moves a tab into another group and collapses empty groups/splits", async () => {
    await ws.changeLayout(ws.defaultLayout());
    const a = ws.getMostRecentLeaf()!;
    const b = ws.createLeafBySplit(a, "vertical");
    expect(ws.rootSplit.children.length).toBe(2);
    ws.moveLeafToTabs(b, a.parent as WorkspaceTabs, 0);
    expect(ws.rootSplit.children.length).toBe(1);
    expect((a.parent as WorkspaceTabs).children[0]).toBe(b);
  });

  it("drop on an edge splits; closing the last tab leaves an empty tab", async () => {
    await ws.changeLayout(ws.defaultLayout());
    const a = ws.getMostRecentLeaf()!;
    const b = ws.createLeafInTabs(a.parent as WorkspaceTabs);
    ws.moveLeafToSplit(b, a.parent as WorkspaceTabs, "bottom");
    expect((ws.rootSplit.children[0] as WorkspaceSplit).direction).toBe("horizontal");
    b.detach();
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.rootSplit.children.length).toBe(1);
    a.detach();
    await new Promise((r) => setTimeout(r, 10));
    let n = 0;
    ws.iterateRootLeaves(() => {
      n++;
    });
    expect(n).toBe(1);
    expect(ws.getMostRecentLeaf()!.view.getViewType()).toBe("empty");
  });

  it("keeps per-leaf back/forward history", async () => {
    await ws.changeLayout(ws.defaultLayout());
    const leaf = ws.getMostRecentLeaf()!;
    await leaf.setViewState({ type: "markdown", state: { file: "A.md" } });
    await leaf.setViewState({ type: "markdown", state: { file: "B.md" } });
    expect(leaf.history.backHistory.length).toBe(1);
    await leaf.history.back();
    expect(leaf.view.getState().file).toBe("A.md");
    await leaf.history.forward();
    expect(leaf.view.getState().file).toBe("B.md");
  });

  it("stacked tabs serialize", async () => {
    await ws.changeLayout(ws.defaultLayout());
    const t = ws.getMostRecentLeaf()!.parent as WorkspaceTabs;
    t.setStacked(true);
    expect(ws.getLayout().main.children[0].stacked).toBe(true);
  });
});
