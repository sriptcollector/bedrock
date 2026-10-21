<p align="center"><img src="assets/icon.png" width="96" alt=""></p>

# Bedrock notes app

**Bedrock by Toolbay** is a free, open-source notes app for plain Markdown files on your own
computer, with sync to your other computers built in. It opens your existing Obsidian vaults and
works with their themes, snippets and community plugins.

- Notes are ordinary `.md` files in a folder. Nothing is locked in.
- Links between notes (`[[like this]]`), embeds, tags, properties, callouts, math, diagrams.
- Live preview while you type, a source mode, and a reading view.
- Tabs, splits, stacked tabs, pinned tabs, a file explorer, a quick switcher and a command palette.
- Your vault syncs end-to-end encrypted when you're signed in to Toolbay. Signed out, everything
  works offline.
- Free. No plans, limits, trials or telemetry.

## Install

Get it from the Toolbay app, or download the latest installer from
[Releases](https://github.com/sriptcollector/bedrock/releases): `Bedrock_<version>_x64-setup.exe`
on Windows (installs for your user, no admin prompt), `.dmg` on macOS.

On first start Bedrock makes your vault at `Documents\Bedrock` with a short welcome note. To use an
existing Obsidian vault, go to Settings › General › Advanced and either open it as a separate vault
or import it into your synced vault.

## Build from source

```
npm install
npm start -w app        # run
npm test -w app         # unit tests
npm run dist -w app     # installer
```

Contributor rules: [AGENTS.md](AGENTS.md). Code layout: [app/README-DEV.md](app/README-DEV.md).
Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

<sub>Inspired by Obsidian. Bedrock is an independent open-source project and is not affiliated with
or endorsed by Obsidian or Dynalist Inc. MIT licensed, © Toolbay contributors.</sub>
