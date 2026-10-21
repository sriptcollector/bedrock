// @vitest-environment happy-dom
// Snapshot every embed case through the real renderer (reading view and live preview share
// renderEmbed): notes, headings, blocks, nested embeds, images with sizes, Markdown images, PDF
// page/height, audio, video, other files, missing targets, self-embeds and the depth limit.
import { describe, expect, it } from "vitest";
import { installDomHelpers } from "../../src/renderer/dom/augment";
installDomHelpers(window as any);
import { renderMarkdownInto } from "../../src/renderer/markdown/renderer";
import { Component } from "../../src/renderer/api/events";
import { parseMetadata } from "../../src/core/parse";

const texts: Record<string, string> = {
  "Note.md": "# Note\n\nIntro paragraph.\n\n## Part A\n\nText of A ^blk1\n\n## Part B\n\nText of B\n\n- item one\n- item two ^li2\n",
  "Outer.md": "Outer text\n\n![[Note#Part B]]\n",
  "Loop.md": "Loop\n\n![[Loop]]\n",
};
const binaries = ["img.png", "clip.mp3", "movie.mp4", "doc.pdf", "data.zip", "Board.canvas"];

function file(path: string) {
  const name = path.split("/").pop()!;
  const ext = name.split(".").pop()!;
  return { path, name, extension: ext, basename: name.replace(/\.[^.]+$/, ""), stat: { mtime: 1, ctime: 1, size: 1 }, parent: { path: "/" } };
}
const files = [...Object.keys(texts), ...binaries].map(file);
const caches = Object.fromEntries(Object.entries(texts).map(([p, t]) => [p, parseMetadata(t)]));
const app: any = {
  vault: {
    getConfig: () => undefined,
    getResourcePath: (f: any) => `app://local/${f.path}?123`,
    cachedRead: async (f: any) => texts[f.path] ?? "",
  },
  metadataCache: {
    getFirstLinkpathDest: (link: string) => files.find((f) => f.path === link || f.basename === link || f.name === link) ?? null,
    getFileCache: (f: any) => caches[f.path] ?? null,
  },
  workspace: { openLinkText() {}, trigger() {}, getLeaf: () => ({ openFile() {} }) },
};

async function render(md: string, sourcePath = "Source.md"): Promise<string> {
  const el = document.createElement("div");
  const comp = new Component();
  comp.load();
  await renderMarkdownInto(app, md, el, sourcePath, comp, { embedDepth: 0 });
  // Strip the per-render data so snapshots are stable.
  return el.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");
}

const CASES: Record<string, string> = {
  "note": "![[Note]]",
  "heading": "![[Note#Part A]]",
  "block": "![[Note#^blk1]]",
  "list item block": "![[Note#^li2]]",
  "nested (note that embeds a heading)": "![[Outer]]",
  "missing note": "![[Nowhere]]",
  "missing heading": "![[Note#No such heading]]",
  "self embed": "![[Loop]]",
  "image": "![[img.png]]",
  "image width": "![[img.png|300]]",
  "image width x height": "![[img.png|100x50]]",
  "image alt and width": "![[img.png|A picture|200]]",
  "markdown image to a vault file with size": "![alt|100x50](img.png)",
  "external markdown image with size": "![web|120](https://example.com/a.png)",
  "pdf": "![[doc.pdf]]",
  "pdf page": "![[doc.pdf#page=3]]",
  "pdf height": "![[doc.pdf#height=400]]",
  "pdf page and height": "![[doc.pdf#page=2&height=300]]",
  "audio": "![[clip.mp3]]",
  "video": "![[movie.mp4]]",
  "other file": "![[data.zip]]",
  "canvas": "![[Board.canvas]]",
};

describe("embed rendering", () => {
  for (const [name, md] of Object.entries(CASES)) {
    it(name, async () => {
      expect(await render(md, name === "self embed" ? "Loop.md" : "Source.md")).toMatchSnapshot();
    });
  }
});
