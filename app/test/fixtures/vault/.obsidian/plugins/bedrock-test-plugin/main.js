// A CommonJS plugin written the way community plugins are bundled.
var obsidian = require("obsidian");
var view = require("@codemirror/view");
var fs = require("fs");

class CountView extends obsidian.ItemView {
  getViewType() { return "bedrock-test-view"; }
  getDisplayText() { return "Test view"; }
  getIcon() { return "dice"; }
  async onOpen() { this.contentEl.createEl("h4", { text: "Files: " + this.app.vault.getMarkdownFiles().length }); }
}

class TestSettingTab extends obsidian.PluginSettingTab {
  display() {
    new obsidian.Setting(this.containerEl).setName("Greeting").addText((t) => t.setValue(this.plugin.data.greeting).onChange((v) => { this.plugin.data.greeting = v; this.plugin.saveData(this.plugin.data); }));
  }
}

class TestPlugin extends obsidian.Plugin {
  async onload() {
    this.data = Object.assign({ greeting: "hello", loads: 0 }, await this.loadData());
    this.data.loads++;
    await this.saveData(this.data);
    const report = { api: [], errors: [] };
    try {
      this.addCommand({ id: "say-hello", name: "Say hello", callback: () => new obsidian.Notice(this.data.greeting) });
      this.addCommand({ id: "insert-date", name: "Insert date", editorCallback: (editor) => editor.replaceSelection(obsidian.moment().format("YYYY-MM-DD")) });
      report.api.push("addCommand");
      this.addRibbonIcon("dice", "Test ribbon", () => {}); report.api.push("addRibbonIcon");
      this.addStatusBarItem().setText("test plugin"); report.api.push("addStatusBarItem");
      this.registerView("bedrock-test-view", (leaf) => new CountView(leaf)); report.api.push("registerView");
      this.registerMarkdownPostProcessor((el) => { el.querySelectorAll("p").forEach((p) => p.dataset.testPlugin = "1"); }); report.api.push("registerMarkdownPostProcessor");
      this.registerMarkdownCodeBlockProcessor("bedrock-test", (src, el) => el.createEl("b", { text: "processed: " + src.trim() })); report.api.push("registerMarkdownCodeBlockProcessor");
      this.registerEditorExtension(view.EditorView.updateListener.of(() => {})); report.api.push("registerEditorExtension(@codemirror/view)");
      this.registerEvent(this.app.vault.on("modify", () => {})); report.api.push("vault.on");
      this.registerEvent(this.app.workspace.on("file-open", () => {})); report.api.push("workspace.on");
      this.addSettingTab(new TestSettingTab(this.app, this)); report.api.push("addSettingTab");
      const f = this.app.metadataCache.getFirstLinkpathDest("Beta", "");
      report.api.push("metadataCache:" + (f ? f.path : "none"));
      report.api.push("normalizePath:" + obsidian.normalizePath("a//b\c/"));
      report.api.push("fs:" + (typeof fs.readFileSync));
      report.api.push("platform:" + obsidian.Platform.isDesktopApp);
      this.app.workspace.onLayoutReady(() => { report.api.push("onLayoutReady"); });
    } catch (e) { report.errors.push(String(e && e.stack || e)); }
    window.__bedrockTestPlugin = report;
  }
  onunload() { window.__bedrockTestPluginUnloaded = true; }
}
module.exports = TestPlugin;
