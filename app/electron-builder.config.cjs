// electron-builder config. Product name, ids and repo come from brand.json (one place to rename).
const brand = require("../brand.json");
const pkg = require("./package.json");
const [owner, repo] = brand.repo.split("/");

module.exports = {
  appId: brand.appId,
  productName: brand.displayName,
  executableName: brand.exeName,
  copyright: "Copyright © Toolbay contributors. MIT License.",
  directories: { output: "release", buildResources: "build-res" },
  files: ["dist/**/*", "!dist/**/*.map", "package.json"],
  asar: true,
  asarUnpack: ["**/*.node", "dist/index-worker.js"],
  extraMetadata: { main: "dist/main.js", name: brand.name, version: pkg.version },
  publish: [{ provider: "github", owner, repo, releaseType: "release" }],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build-res/icon.ico",
    artifactName: `${brand.displayName}_\${version}_x64-setup.\${ext}`,
  },
  nsis: {
    // Per-user, one click, no admin prompt (Toolbay rule 1). The hub runs it with /S.
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: brand.displayName,
    uninstallDisplayName: brand.displayName,
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    icon: "build-res/icon.icns",
    category: "public.app-category.productivity",
    artifactName: `${brand.displayName}_\${version}_\${arch}.\${ext}`,
    hardenedRuntime: true,
  },
  dmg: { title: `${brand.displayName} \${version}` },
  linux: { target: ["AppImage"], icon: "build-res/icon.png", category: "Office" },
};
