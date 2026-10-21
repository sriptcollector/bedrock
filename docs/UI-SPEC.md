# Bedrock UI spec (measured from Obsidian 1.14.4)

What this is: measurements taken from the running Obsidian 1.14.4 desktop app (Windows 11, default theme, default
accent, base font size 16) so Bedrock's default theme can match it pixel for pixel. Every number here was read with
`getComputedStyle` and `getBoundingClientRect` over the Chrome DevTools Protocol on 2026-10-21. These are facts
about the rendered result, written as tables. No Obsidian CSS or JS is copied here; write our own stylesheet that
produces these values.

How it was measured:
- Main window content size 1280 x 800 CSS px, devicePixelRatio 1. Electron 43.3.0, Chrome 150.0.7871.212.
- Vault: the deterministic demo vault (`tbv-scratch/demo-vault`, built by `scripts/make-demo-vault.js`). Bedrock should be checked against the same vault.
- Light theme = Obsidian's "moonstone" class `theme-light`; dark = "obsidian" class `theme-dark`. Both on `body`.
- Reference screenshots (not in this repo, never commit them): `C:\Users\orion\tbv-scratch\ref\index.md`.
- Column key: **box** = width x height at x,y (px). **font** = size, weight (if not 400), line height. Colors are hex (`#rrggbb/alpha` when translucent). Borders: T/R/B/L sides. Values that are browser defaults (no padding, no shadow, ...) are left blank.
- Machine-readable data: `docs/reference/css-variables.json` (every variable, both themes), `commands.json`, `settings.json`.

Contents: 1. Global facts. 2. Per-screen measurements. 3. Icons. 4. DOM structure. 5. Motion. 6. CSS variables (all 1177, both themes).

## 1. Global facts

| Fact | Value |
|---|---|
| Body classes (Windows, default) | `mod-windows is-frameless is-hidden-frameless obsidian-app styled-scrollbars show-inline-title is-floating-nav auto-full-screen show-ribbon show-view-header` + `theme-light` or `theme-dark` (+ `is-focused` when the window has focus) |
| Popout windows add | `is-popout-window` (settings window also `is-popout-modal`) |
| Interface font stack (`--font-interface`) | ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif (Bedrock: same stack; on Windows it resolves to Segoe UI) |
| Text font (`--font-text`) | '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif |
| Monospace (`--font-monospace-default`) | ui-monospace, SFMono-Regular, "Cascadia Mono", "Roboto Mono", "DejaVu Sans Mono", "Liberation Mono", Menlo, Monaco, "Consolas", "Source Code Pro", monospace |
| Base font size (`--font-text-size`) | 16px (setting "Font size", default 16) |
| UI font sizes | smaller 12px, small 13px, medium 15px, large 20px |
| Line height | normal 1.5, tight 1.3 |
| Readable line width (`--file-line-width`) | 700px |
| Accent | hue 258, sat 88%, light 66% = `#8a5cf5` (setting default) |
| Radii | s 4px, m 8px, l 12px, xl 24px |
| Icon sizes | xs 14px, s 16px, m 16px, l 18px, xl 32px; stroke 2px (s 2px, m 2px, l 1.75px) |
| Header height (`--header-height`) | 40px |
| Ribbon width (`--ribbon-width`) | 44px |
| Sidebar default width | 300 px (stored in workspace.json `left.width` / `right.width`) |
| Tab bar / titlebar | No native title bar by default ("Window frame style: Hidden"). The tab header row doubles as the title bar; minimize, maximize and close buttons sit at the top right of the window (sizes in section 2). |
| Scrollbars | styled (`styled-scrollbars` body class) |
| Icons | Lucide icon set, inline SVG, class `svg-icon lucide-<name>`, 24x24 viewBox, sized by CSS. A few custom icons: `links-coming-in`, `links-going-out`, `right-triangle`, `sidebar-left`, `sidebar-right`. |

## 2. Per-screen measurements

Each table: one row per element. Light colors first, dark colors second. Geometry is the same in both themes unless noted.

### Window shell, ribbon, sidebars, tabs, status bar

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| body | `body` | 1280x800 @0,0 |  |  | 15px lh 19.5px |  |  | #222222 | #ffffff | #dadada | #1c1c1c |  |
| app container | `.app-container` | 1280x800 @0,0 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| workspace | `.workspace` | 1280x800 @0,0 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | transition padding-left 0.1s ease-in |
| left ribbon | `.workspace-ribbon.side-dock-ribbon` | 44x760 @0,40 | 8px 4px 12px | 40px 0px 0px | 15px lh 19.5px |  | R:1px solid #e4e4e4 | #5c5c5c | #f6f6f6 | #b3b3b3 | #282828 | gap 4px; icon sidebar-toggle-button-icon 16px; dark border R:1px solid #333333 |
| ribbon action button | `.side-dock-ribbon-action` | 28x24 @8,48 | 4px 6px | 0px 3.5px | 15px lh 19.5px | 4px |  | #5c5c5c |  | #b3b3b3 |  | icon lucide-file-search 16px |
| ribbon settings area | `.side-dock-settings` | 35x0 @4,788 |  | 532px 0px 0px | 15px lh 19.5px |  |  | #5c5c5c |  | #b3b3b3 |  | gap 6px |
| left sidebar split | `.workspace-split.mod-left-split` | 300x800 @44,0 |  |  | 15px lh 19.5px |  |  | #222222 | #f6f6f6 | #dadada | #282828 |  |
| sidebar tab header container | `.mod-left-split .workspace-tab-header-container` | 300x40 @44,0 | 0px 8px |  | 15px lh 19.5px |  | B:1px solid #e4e4e4 | #222222 | #f6f6f6 | #dadada | #282828 | ; dark border B:1px solid #333333 |
| sidebar tab header (icon tab) | `.mod-left-split .workspace-tab-header` | 28x25 @52,7 |  |  | 15px lh 19.5px | 4px |  | #5c5c5c | oklch(0 0 none / 0.067) | #b3b3b3 | oklch(0.999994 0.0000497986 none / 0.067) | icon lucide-folder-closed 16px |
| sidebar tab header active | `.mod-left-split .workspace-tab-header.is-active` | 28x25 @52,7 |  |  | 15px lh 19.5px | 4px |  | #5c5c5c | oklch(0 0 none / 0.067) | #b3b3b3 | oklch(0.999994 0.0000497986 none / 0.067) | icon lucide-folder-closed 16px |
| sidebar toggle button | `.sidebar-toggle-button.mod-left` | 44x39 @0,0 | 8px 0px 7px |  | 15px lh 19.5px |  |  | #5c5c5c |  | #b3b3b3 |  | icon sidebar-toggle-button-icon 16px |
| vault profile footer | `.workspace-sidedock-vault-profile` | 300x41.9 @44,758 | 8px |  | 15px lh 19.5px |  | T:1px solid #e4e4e4 | #222222 | #f6f6f6 | #dadada | #282828 | gap 4px; dark border T:1px solid #333333 |
| vault switcher name | `.workspace-drawer-vault-name, .workspace-sidedock-vault-profile .workspace-drawer-vault-switcher` | 224x24.9 @52,767 | 4px 8px |  | 15px lh 19.5px | 4px |  | #222222 |  | #dadada |  | gap 8px |
| resize handle | `.workspace-leaf-resize-handle` | 3x800 @341,0 |  |  | 15px lh 19.5px |  | R:1px solid #e4e4e4 | #808080 |  | #808080 |  | transition background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, opacity 0.2s ease-in-out; cursor col-resize; dark border R:1px solid #333333 |
| root split | `.workspace-split.mod-root` | 936x800 @344,0 |  |  | 15px lh 19.5px |  |  | #222222 | #ffffff | #dadada | #1c1c1c |  |
| main tab header container | `.mod-root .workspace-tab-header-container` | 936x40 @344,0 | 0px 134px 0px 8px |  | 15px lh 19.5px |  | B:1px solid #e4e4e4 | #222222 | #f6f6f6 | #dadada | #282828 | ; dark border B:1px solid #333333 |
| main tab header (active) | `.mod-root .workspace-tab-header.is-active` | 200x34 @352,6 | 1px 4px 4px |  | 15px lh 19.5px | 10px 10px 0px 0px |  | #5c5c5c | #ffffff | #b3b3b3 | #1c1c1c | shadow #e4e4e4 0px 0px 0px 1px; dark shadow #333333 0px 0px 0px 1px |
| tab title text | `.mod-root .workspace-tab-header.is-active .workspace-tab-header-inner-title` | 161x16.9 @362,13 |  |  | 13px lh 16.9px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| tab close button | `.mod-root .workspace-tab-header.is-active .workspace-tab-header-inner-close-button` | 20x20 @525,12 | 2px |  | 15px lh 19.5px | 8px |  | #5c5c5c |  | #b3b3b3 |  | icon lucide-x 16px |
| new tab button | `.mod-root .workspace-tab-header-new-tab` | 24x39 @560,0 | 8px 0px 6px | 0px 4px 0px 8px | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | icon lucide-plus 16px |
| tab list dropdown button | `.mod-root .workspace-tab-header-tab-list` | 24x39 @1084,0 | 8px 0px 6px | 0px 2px 0px 0px | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | icon lucide-chevron-down 16px |
| titlebar window controls | `.titlebar-button-container.mod-right` | 132x39 @1148,0 |  |  | 15px w700 lh 19.5px |  |  | #5c5c5c | #f6f6f6 | #b3b3b3 | #282828 |  |
| titlebar button | `.titlebar-button` | 0x0 @0,0 | 4px 8px |  | 15px w700 lh 19.5px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| view header | `.view-header` | 936x38 @344,40 | 0px 12px |  | 15px lh 19.5px |  | B:1px solid #000000/0.00 | #222222 | #ffffff | #dadada | #1c1c1c | gap 8px |
| view header title container | `.view-header-title-container` | 756x37 @420,40 |  |  | 13px lh 16.9px |  |  | #222222 |  | #dadada |  | gap 4px |
| view header title / breadcrumb | `.view-header-title` | 53.2x16.9 @420,50 |  |  | 13px lh 16.9px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| view action button | `.view-action` | 28x24 @1184,47 | 4px 6px |  | 13px | 4px |  | #8a5cf5 |  | #a68af9 |  | transition none; icon lucide-bookmark 16px |
| back/forward nav button | `.view-header-nav-buttons button` | 28x24 @356,47 | 4px 6px |  | 13px | 4px |  | #5c5c5c |  | #b3b3b3 |  | opacity 0.4; transition none; icon lucide-arrow-left 16px; cursor not-allowed |
| view content | `.view-content` | 936x722 @344,78 |  |  | 15px lh 19.5px |  |  | #222222 | #ffffff | #dadada | #1c1c1c |  |
| status bar | `.status-bar` | 362.3x27 @918,773 | 4px 8px 4px 4px |  | 12px lh 15.6px | 8px 0px 0px | T:1px solid #e4e4e4 L:1px solid #e4e4e4 | #5c5c5c | #f6f6f6 | #b3b3b3 | #282828 | gap 4px; dark border T:1px solid #333333 L:1px solid #333333 |
| status bar item | `.status-bar-item` | 66.1x18 @923,778 | 3px 4px |  | 12px lh 12px | 4px |  | #5c5c5c |  | #b3b3b3 |  |  |

### File explorer

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nav header | `.workspace-leaf-content[data-type=file-explorer] .nav-header` | 300x40 @44,40 | 8px |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| nav buttons container | `.nav-buttons-container` | 284x24 @52,48 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | gap 2px |
| nav action button | `.nav-action-button` | 28x24 @120,48 | 4px 6px |  | 15px lh 19.5px | 4px |  | #5c5c5c |  | #b3b3b3 |  | icon lucide-edit 16px |
| nav files container | `.nav-files-container` | 300x678.1 @44,80 | 4px 12px 24px |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| folder row | `.nav-folder-title` | 264x24.9 @56,84 | 4px 8px 4px 24px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #5c5c5c |  | #b3b3b3 |  |  |
| folder collapse chevron | `.nav-folder-collapse-indicator, .tree-item-icon.collapse-icon` | 16x16.9 @60,88 |  | 0px 0px 0px -20px | 13px lh 16.9px |  |  | #5c5c5c |  | #b3b3b3 |  | opacity 0.85; icon right-triangle 10px |
| folder children (indent guide) | `.nav-folder-children` | 252x78.8 @68,111 | 0px 0px 0px 4px | 0px 0px 0px 12px | 15px lh 19.5px |  | L:1px solid oklch(0 0 none / 0.12) | #222222 |  | #dadada |  | ; dark border L:1px solid oklch(0.999994 0.0000497986 none / 0.12) |
| file row | `.nav-file-title` | 264x24.9 @56,111 | 4px 8px 4px 41px | 0px 0px 2px -17px | 13px lh 16.9px | 8px |  | #5c5c5c |  | #b3b3b3 |  |  |
| file row active | `.nav-file-title.is-active` | 264x24.9 @56,488 | 4px 8px 4px 41px | 0px 0px 2px -17px | 13px lh 16.9px | 8px |  | #222222 | oklch(0 0 none / 0.067) | #dadada | oklch(0.999994 0.0000497986 none / 0.067) |  |
| file title text | `.nav-file-title-content` | 55.1x16.9 @97,115 |  |  | 13px lh 16.9px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| file extension tag | `.nav-file-tag` | 27.8x13.5 @284,117 | 0px 4px | 0px 0px 0px 132.141px | 9px w600 lh 13.5px | 4px |  | #ababab |  | #666666 |  | uppercase; ls 0.45px |

### Live Preview editor

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| markdown source view | `.markdown-source-view.mod-cm6` | 936x722 @344,78 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| cm-editor | `.cm-editor` | 936x722 @344,78 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| cm-scroller | `.cm-scroller` | 936x722 @344,78 | 32px |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| cm-sizer | `.cm-sizer` | 700x1543.4 @456,110 |  | 0px 80px | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| cm-content | `.cm-content` | 700x1193.2 @456,460 | 0px 0px 361px |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| cm-line | `.cm-line` | 700x49.1 @456,460 | 16px 0px 0px |  | 25.888px w700 lh 31.0656px |  |  | #222222 |  | #dadada |  | ls -0.38832px |
| inline title | `.inline-title` | 700x31.1 @456,110 |  | 0px 0px 12.944px | 25.888px w700 lh 31.0656px |  |  | #222222 |  | #dadada |  | ls -0.38832px |
| properties container | `.metadata-container` | 700x274.2 @452,154 | 8px 0px | 0px 0px 32px | 16px lh 24px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| properties heading | `.metadata-properties-heading` | 82.6x27.2 @452,162 | 4px | 0px 0px 8px | 16px lh 19.2px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| property row | `.metadata-property` | 700x29 @452,197 |  |  | 16px lh 24px | 6px |  | #5c5c5c |  | #b3b3b3 |  |  |
| property key | `.metadata-property-key` | 144x29 @452,197 |  |  | 16px lh 24px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| property key icon | `.metadata-property-icon` | 20x28 @452,197 | 4px 0px |  | 16px lh 24px |  |  | #5c5c5c |  | #b3b3b3 |  | icon lucide-forward 16px |
| property key input | `.metadata-property-key-input` | 124x28 @472,197 | 4px 8px |  | 14px |  |  | #5c5c5c |  | #b3b3b3 |  | transition none; cursor text |
| property value | `.metadata-property-value` | 556x29 @596,197 |  |  | 16px lh 24px |  |  | #5c5c5c |  | #b3b3b3 |  | gap 4px |
| multi-select pill (alias) | `.metadata-property[data-property-key="aliases"] .multi-select-pill` | 53.5x18.2 @604,203 |  |  | 14px lh 18.2px | 28px |  | #222222 |  | #dadada |  | gap 2px; icon lucide-x 14px |
| tag pill | `.metadata-property[data-property-key="tags"] .multi-select-pill` | 66.9x21 @604,233 | 3.5px 0px |  | 14px lh 14px | 28px |  | #8a5cf5 | oklch(0.653792 0.189218 293.559 / 0.1) | #a68af9 | oklch(0.603458 0.21722 292.49 / 0.1) | gap 2px; cursor pointer |
| checkbox property | `.metadata-property[data-property-key="published"] input[type=checkbox]` | 16x16 @604,362 |  | 4px 8px | 14px | 4px | T:1px solid #9873f7 R:1px solid #9873f7 B:1px solid #9873f7 L:1px solid #9873f7 | #000000 | #9873f7 | #ffffff | #8a5cf5 | transition box-shadow 0.15s ease-in-out; dark border T:1px solid #8a5cf5 R:1px solid #8a5cf5 B:1px solid #8a5cf5 L:1px solid #8a5cf5 |
| date property input | `.metadata-property[data-property-key="created"] input` | 124x28 @472,261 | 4px 8px |  | 14px |  |  | #5c5c5c |  | #b3b3b3 |  | transition none; cursor text |
| add property button | `.metadata-add-button` | 114.6x29 @452,391 | 4px 4px 4px 6px | 7px 0px 0px | 14px lh 21px | 5px |  | #5c5c5c |  | #b3b3b3 |  | gap 4px |
| H1 line | `.HyperMD-header-1` | 700x49.1 @456,460 | 16px 0px 0px |  | 25.888px w700 lh 31.0656px |  |  | #222222 |  | #dadada |  | ls -0.38832px |
| H1 text | `.cm-header-1` | 21.7x34 @456,476 |  |  | 25.888px w700 lh 31.0656px |  |  | #ababab |  | #666666 |  | ls -0.38832px |
| H1 formatting # (when visible) | `.cm-formatting-header` | 21.7x34 @456,476 |  |  | 25.888px w700 lh 31.0656px |  |  | #ababab |  | #666666 |  | ls -0.38832px |
| H2 line | `.HyperMD-header-2` | 700x46.1 @456,605 | 16px 0px 0px |  | 23.392px w680 lh 28.0704px |  |  | #222222 |  | #dadada |  | ls -0.257312px |
| H2 text | `.cm-header-2` | 142.6x31 @456,621 |  |  | 23.392px w680 lh 28.0704px |  |  | #222222 |  | #dadada |  | ls -0.257312px |
| bold | `.cm-strong` | 198.7x21 @604,534 |  |  | 16px w600 lh 24px |  |  | #222222 |  | #dadada |  |  |
| italic | `.cm-em` | 33.2x21 @853,534 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| strikethrough | `.cm-strikethrough` | 94.9x21 @935,534 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  | line-through |
| highlight | `.cm-highlight` | 63.1x21 @1038,534 |  |  | 16px lh 24px |  |  | #222222 | oklch(0.770907 0.157719 86.6498 / 0.3) | #dadada | oklch(0.88004 0.131911 107.863 / 0.3) |  |
| inline code | `.cm-inline-code` | 98.6x20.2 @456,560 | 2.1px 4.2px |  | 14px lh 21px | 4px |  | #222222 | #fafafa | #dadada | #232323 |  |
| internal link text | `.cm-hmd-internal-link` | 108.9x21 @479,652 |  |  | 16px lh 24px |  |  | #8a5cf5 |  | #a68af9 |  |  |
| unresolved link | `.is-unresolved` | 109.7x21 @592,784 |  |  | 16px lh 24px |  |  | #8a5cf5 |  | #a68af9 |  | opacity 0.7 |
| list line | `.HyperMD-list-line` | 700x25.2 @456,651 | 0px 0px 1.2px 22px |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| list bullet | `.list-bullet` | 6.4x24 @468,651 |  |  | 16px lh 24px |  |  | #000000/0.00 |  | #000000/0.00 |  |  |
| task checkbox | `.task-list-item-checkbox` | 16x16 @463,883 |  | 0px 3.33333px 0px 11.3333px | 13.3333px | 4px | T:1px solid #ababab R:1px solid #ababab B:1px solid #ababab L:1px solid #ababab | #000000 |  | #ffffff |  | transition box-shadow 0.15s ease-in-out; dark border T:1px solid #666666 R:1px solid #666666 B:1px solid #666666 L:1px solid #666666 |
| tag in text | `.cm-hashtag` | 17.4x26 @632,878 | 3.5px 0px 3.5px 9.1px |  | 14px lh 21px | 28px 0px 0px 28px |  | #8a5cf5 | oklch(0.653792 0.189218 293.559 / 0.1) | #a68af9 | oklch(0.603458 0.21722 292.49 / 0.1) | cursor pointer |
| callout | `.workspace-leaf.mod-active .callout` | not present in this state |||||||||||
| callout title | `.workspace-leaf.mod-active .callout-title` | not present in this state |||||||||||
| callout icon | `.workspace-leaf.mod-active .callout-icon` | not present in this state |||||||||||
| callout content | `.workspace-leaf.mod-active .callout-content` | not present in this state |||||||||||
| external link | `.workspace-leaf.mod-active .cm-url, .external-link` | not present in this state |||||||||||
| fold indicator | `.cm-fold-indicator` | 0x31.1 @456,478 |  |  | 25.888px w700 lh 31.0656px |  |  | #222222 |  | #dadada |  | icon right-triangle 10px; ls -0.38832px |

### Callouts in Live Preview

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| callout widget | `.cm-callout` | 700x100.8 @456,580 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| callout | `.callout` | 700x100.8 @456,580 | 12px 12px 12px 24px |  | 16px lh 24px | 4px |  | #222222 | oklch(0.550587 0.189745 256.787 / 0.1) | #dadada | oklch(0.602893 0.217554 257.503 / 0.1) |  |
| callout title | `.callout-title` | 664x20.8 @480,592 |  |  | 16px lh 20.8px |  |  | #086ddd |  | #027aff |  | gap 4px |
| callout icon | `.callout-icon` | 16x20.8 @480,592 |  |  | 16px lh 20.8px |  |  | #086ddd |  | #027aff |  | icon lucide-pencil 16px |
| callout fold chevron | `.callout-fold` | 24x20.8 @617,842 | 0px 8px 0px 0px |  | 16px lh 20.8px |  |  | #ec7500 |  | #e9973f |  | icon lucide-chevron-down 16px |
| callout content | `.callout-content` | 664x56 @480,613 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| external link | `.external-link` | 14.4x21 @647,900 | 0px 14.4px 0px 0px |  | 16px lh 24px |  |  | #ababab |  | #666666 |  | transition opacity 0.14s ease-in-out; underline; cursor pointer |

### Source mode

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cm-content (source) | `.cm-content` | 700x1334.2 @456,154 | 0px 0px 361px |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| frontmatter line | `.cm-line.HyperMD-frontmatter, .cm-hmd-frontmatter` | 24.6x16 @456,159 |  |  | 14px lh 21px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| formatting chars | `.cm-formatting` | 21.7x34 @456,346 |  |  | 25.888px w700 lh 31.0656px |  |  | #ababab |  | #666666 |  | ls -0.38832px |
| header formatting | `.cm-formatting-header` | 21.7x34 @456,346 |  |  | 25.888px w700 lh 31.0656px |  |  | #ababab |  | #666666 |  | ls -0.38832px |
| link bracket formatting | `.cm-formatting-link` | 9.7x21 @467,506 |  |  | 16px lh 24px |  |  | #ababab |  | #666666 |  |  |
| strong | `.cm-strong` | 13.9x21 @604,404 |  |  | 16px w600 lh 24px |  |  | #222222 |  | #dadada |  |  |

### Reading view

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| markdown reading view | `.markdown-reading-view` | 936x722 @344,78 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| preview view | `.markdown-preview-view` | 936x722 @344,78 | 32px |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| preview sizer | `.markdown-preview-sizer` | 700x1654.7 @456,110 | 0px 0px 361px | 0px 80px | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| inline title | `.markdown-preview-view .inline-title` | 700x31.1 @456,110 |  | 0px 0px 12.944px | 25.888px w700 lh 31.0656px |  |  | #222222 |  | #dadada |  | ls -0.38832px |
| h1 | `.markdown-preview-view h1` | 700x31.1 @456,460 |  | 0px 0px 16px | 25.888px w700 lh 31.0656px |  |  | #222222 |  | #dadada |  | ls -0.38832px |
| h2 | `.markdown-preview-view h2` | 700x28.1 @456,595 |  | 40px 0px 16px | 23.392px w680 lh 28.0704px |  |  | #222222 |  | #dadada |  | ls -0.257312px |
| paragraph | `.markdown-preview-view p` | 700x48 @456,507 |  | 16px 0px | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| internal link | `.markdown-preview-view a.internal-link` | 108.9x21 @482,642 |  |  | 16px lh 24px |  |  | #8a5cf5 |  | #a68af9 |  | transition opacity 0.14s ease-in-out; underline; cursor pointer |
| unresolved internal link | `.markdown-preview-view a.is-unresolved` | 109.7x21 @595,774 |  |  | 16px lh 24px |  |  | #8a5cf5 |  | #a68af9 |  | opacity 0.7; transition opacity 0.14s ease-in-out; underline; cursor pointer |
| external link | `.markdown-preview-view a.external-link` | 112.1x21 @549,1276 | 0px 14.4px 0px 0px |  | 16px lh 24px |  |  | #8a5cf5 |  | #a68af9 |  | transition opacity 0.14s ease-in-out; underline; cursor pointer |
| inline code | `.markdown-preview-view code` | 0x0 @0,0 |  |  | 14px lh 21px | 4px |  | #222222 |  | #dadada |  |  |
| mark (highlight) | `.markdown-preview-view mark` | 63.1x21 @1038,508 |  |  | 16px lh 24px |  |  | #222222 | oklch(0.770907 0.157719 86.6498 / 0.3) | #dadada | oklch(0.88004 0.131911 107.863 / 0.3) |  |
| ul | `.markdown-preview-view ul` | 700x158.3 @456,639 |  | 16px 0px | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| li | `.markdown-preview-view li` | 674.1x26.4 @482,639 | 1.2px 0px | 0px 0px 0px 25.875px | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| task checkbox | `.markdown-preview-view .task-list-item-checkbox` | 16x16 @458,888 |  | 0px 8px 0px -24px | 13.3333px | 4px | T:1px solid #ababab R:1px solid #ababab B:1px solid #ababab L:1px solid #ababab | #000000 |  | #ffffff |  | transition box-shadow 0.15s ease-in-out; dark border T:1px solid #666666 R:1px solid #666666 B:1px solid #666666 L:1px solid #666666 |
| tag | `.markdown-preview-view a.tag` | 70.2x26 @626,882 | 3.5px 9.1px |  | 14px lh 14px | 28px |  | #8a5cf5 | oklch(0.653792 0.189218 293.559 / 0.1) | #a68af9 | oklch(0.603458 0.21722 292.49 / 0.1) | transition opacity 0.14s ease-in-out; cursor pointer |
| callout | `.markdown-preview-view .callout` | 700x100.8 @456,977 | 12px 12px 12px 24px | 16px 0px | 16px lh 24px | 4px |  | #222222 | oklch(0.550587 0.189745 256.787 / 0.1) | #dadada | oklch(0.602893 0.217554 257.503 / 0.1) |  |
| callout title | `.markdown-preview-view .callout-title` | 664x20.8 @480,989 |  |  | 16px lh 20.8px |  |  | #086ddd |  | #027aff |  | gap 4px |
| footnotes section | `.markdown-preview-view .footnotes` | 700x57.1 @456,1331 |  |  | 14px lh 21px |  |  | #222222 |  | #dadada |  |  |

### Tables and code

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| table | `.markdown-preview-view table` | 330x120.2 @456,419 |  | 16px 0px | 16px lh 20.8px |  |  | #222222 |  | #dadada |  |  |
| th | `.markdown-preview-view th` | 53.3x29.8 @457,420 | 4px 8px |  | 16px w600 lh 20.8px |  | T:1px solid #e4e4e4 R:1px solid #e4e4e4 B:1px solid #e4e4e4 L:1px solid #e4e4e4 | #222222 |  | #dadada |  | ; dark border T:1px solid #333333 R:1px solid #333333 B:1px solid #333333 L:1px solid #333333 |
| td | `.markdown-preview-view td` | 53.3x29.8 @457,450 | 4px 8px |  | 16px lh 20.8px |  | T:1px solid #e4e4e4 R:1px solid #e4e4e4 B:1px solid #e4e4e4 L:1px solid #e4e4e4 | #222222 |  | #dadada |  | ; dark border T:1px solid #333333 R:1px solid #333333 B:1px solid #333333 L:1px solid #333333 |
| pre (code block) | `.markdown-preview-view pre` | 0x0 @0,0 | 12px 16px | 16px 0px | 16px lh 24px | 4px |  | #222222 | #fafafa | #dadada | #232323 | icon lucide-copy 0px |
| code in pre | `.markdown-preview-view pre code` | 0x0 @0,0 |  |  | 14px lh 21px | 4px |  | #222222 |  | #dadada |  |  |
| copy code button | `.copy-code-button` | 0x0 @0,0 | 6px 8px | 6px | 12px | 5px |  | #5c5c5c |  | #b3b3b3 |  | transition none; icon lucide-copy 0px |
| token keyword | `.token.keyword` | 65.6x16 @472,764 |  |  | 14px lh 21px |  |  | #d53984 |  | #fa99cd |  |  |
| token string | `.token.string` | 0x0 @0,0 |  |  | 14px lh 21px |  |  | #08b94e |  | #44cf6e |  |  |
| token function | `.token.function` | 41x16 @546,764 |  |  | 14px lh 21px |  |  | #e0ac00 |  | #e0de71 |  |  |
| image embed | `.image-embed img, .internal-embed img` | 240x135 @456,972 |  |  | 16px lh 24px | 4px |  | #222222 |  | #dadada |  |  |

### Tables and code in Live Preview

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| table widget | `.cm-table-widget, .table-wrapper` | 732x152.2 @440,415 | 16px | 0px -16px | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| table cell | `.cm-table-widget td, .table-cell-wrapper` | 52.3x28.8 @457,432 | 4px 8px |  | 16px w600 lh 20.8px |  |  | #222222 |  | #dadada |  | cursor text |
| code block line | `.HyperMD-codeblock` | 700x21 @456,732 | 0px 0px 0px 16px |  | 14px lh 21px | 4px 4px 0px 0px |  | #222222 | #fafafa | #dadada | #232323 |  |
| code block begin line | `.HyperMD-codeblock-begin` | 700x21 @456,732 | 0px 0px 0px 16px |  | 14px lh 21px | 4px 4px 0px 0px |  | #222222 | #fafafa | #dadada | #232323 |  |
| code flair (language label) | `.code-block-flair` | 68.4x26 @1082,738 | 4px 8px |  | 12px lh 18px | 4px |  | #5c5c5c |  | #b3b3b3 |  |  |

### Embeds

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| markdown embed | `.markdown-embed` | 0x0 @0,0 |  |  | 16px lh 24px |  | L:2px solid #9873f7 | #222222 |  | #dadada |  | icon right-triangle 0px; dark border L:2px solid #8a5cf5 |
| embed title | `.markdown-embed-title` | 0x0 @0,0 | 0px 0px 0px 24px |  | 16px w600 lh 24px |  |  | #222222 |  | #dadada |  | gap 4px |
| embed content | `.markdown-embed-content` | 0x0 @0,0 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  | icon right-triangle 0px |
| embed link icon | `.markdown-embed-link` | 0x0 @0,0 | 4px |  | 16px lh 24px | 4px |  | #5c5c5c |  | #b3b3b3 |  | opacity 0.85; icon lucide-maximize-2 0px; cursor pointer |
| image embed | `.image-embed` | 0x0 @0,0 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  | icon lucide-zoom-in 0px |
| pdf embed | `.pdf-embed` | 0x0 @0,0 |  |  | 16px lh 24px | 4px | T:1px solid #e4e4e4 R:1px solid #e4e4e4 B:1px solid #e4e4e4 L:1px solid #e4e4e4 | #222222 |  | #dadada |  | icon lucide-code-2 0px; dark border T:1px solid #333333 R:1px solid #333333 B:1px solid #333333 L:1px solid #333333 |
| audio embed | `audio` | 0x0 @0,0 |  |  | 16px lh 24px |  |  | #222222 |  | #dadada |  |  |
| mermaid | `.workspace-leaf.mod-active .mermaid` | not present in this state |||||||||||

### Search pane

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| search input container | `.search-input-container` | 0x0 @0,0 |  | 4px auto | 15px lh 19.5px | 5px |  | #222222 |  | #dadada |  |  |
| search input | `.search-input-container input` | 0x0 @0,0 | 4px 8px 4px 30px |  | 13px | 5px | T:1px solid #e4e4e4 R:1px solid #e4e4e4 B:1px solid #e4e4e4 L:1px solid #e4e4e4 | #222222 | #ffffff | #dadada | #2e2e2e | transition none; cursor text; dark border T:1px solid #333333 R:1px solid #333333 B:1px solid #333333 L:1px solid #333333 |
| search params row | `.search-params` | 0x0 @0,0 |  | 4px 16px | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | gap 8px |
| search result count/info | `.search-results-info` | 300x33 @44,90 | 0px 12px 8px |  | 15px lh 19.5px |  | B:1px solid #e4e4e4 | #5c5c5c |  | #b3b3b3 |  | ; dark border B:1px solid #333333 |
| result file title | `.search-result-file-title` | 264x24.9 @56,135 | 4px 8px 4px 24px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #222222 |  | #dadada |  |  |
| result match | `.search-result-file-match` | 264x48.2 @56,164 | 8px 20px 8px 12px |  | 12px lh 15.6px |  | B:1px solid #e4e4e4 | #5c5c5c |  | #b3b3b3 |  | ; dark border B:1px solid #333333 |
| matched text | `.search-result-file-matched-text` | 38.7x16 @122,187 |  |  | 12px lh 15.6px |  |  | #222222 | oklch(0.770907 0.157719 86.6498 / 0.3) | #dadada | oklch(0.88004 0.131911 107.863 / 0.3) |  |
| tree item flair (count) | `.tree-item-flair` | 6.5x12 @306,141 |  |  | 12px lh 12px | 4px |  | #ababab |  | #666666 |  |  |

### Backlinks pane

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pane header nav | `.workspace-leaf-content[data-type=backlink] .nav-header` | 300x40 @980,40 | 8px |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| section header (Linked mentions) | `.backlink-pane .tree-item-self` | 276x24.9 @992,84 | 4px 8px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #222222 |  | #dadada |  |  |
| result file title | `.backlink-pane .search-result-file-title` | 274x24.9 @993,115 | 4px 8px 4px 24px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #222222 |  | #dadada |  |  |
| result match card | `.backlink-pane .search-result-file-match` | 274x47.2 @993,144 | 8px 20px 8px 12px |  | 12px lh 15.6px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| match highlight | `.backlink-pane .search-result-file-matched-text` | 243.7x31.6 @1005,151 |  |  | 12px lh 15.6px |  |  | #222222 | oklch(0.770907 0.157719 86.6498 / 0.3) | #dadada | oklch(0.88004 0.131911 107.863 / 0.3) |  |

### Tags pane

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tag row | `.tag-container .tree-item-self` | 276x24.9 @992,92 | 4px 8px 4px 24px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #5c5c5c |  | #b3b3b3 |  |  |
| tag count | `.tag-container .tree-item-flair` | 6.5x12 @1254,98 |  |  | 12px lh 12px | 4px |  | #ababab |  | #666666 |  |  |

### Outline pane

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| outline heading row | `.workspace-leaf-content[data-type=outline] .tree-item-self` | 276x24.9 @992,84 | 4px 8px 4px 24px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #222222 | oklch(0 0 none / 0.067) | #dadada | oklch(0.999994 0.0000497986 none / 0.067) |  |

### Command palette

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| modal container | `.modal-container` | 1280x800 @0,0 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| modal backdrop | `.modal-bg` | 1280x800 @0,0 |  |  | 15px lh 19.5px |  |  | #222222 | #dcdcdc/0.40 | #dadada | #0a0a0a/0.40 | opacity 0.85 |
| prompt | `.prompt` | 700x560 @290,120 |  |  | 15px lh 19.5px | 12px | T:1px solid #dadada R:1px solid #dadada B:1px solid #dadada L:1px solid #dadada | #222222 | #ffffff | #dadada | #1c1c1c | shadow #000000/0.07 0px 1.8px 7.3px 0px, #000000/0.11 0px 6.3px 24.7px 0px, #000000/0.10 0px 15px 30px 0px; dark shadow #000000/0.07 0px 1.8px 7.3px 0px, #000000/0.11 0px 6.3px 24.7px 0px, #000000/0.20 0px 30px 90px 0px; dark border T:1px solid #3f3f3f R:1px solid #3f3f3f B:1px solid #3f3f3f L:1px solid #3f3f3f |
| prompt input container | `.prompt-input-container` | 698x49 @291,121 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| prompt input | `.prompt-input` | 698x49 @291,121 | 24px 48px 24px 24px |  | 15px |  | B:1px solid #f6f6f6 | #222222 |  | #dadada |  | transition none; cursor text; dark border B:1px solid #282828 |
| results | `.prompt-results` | 698x477.4 @291,170 | 12px |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| suggestion item | `.suggestion-item` | 662x31.5 @303,182 | 6px 12px | 0px 0px 1px | 15px lh 19.5px | 4px |  | #222222 | oklch(0 0 none / 0.067) | #dadada | oklch(0.999994 0.0000497986 none / 0.067) |  |
| suggestion item selected | `.suggestion-item.is-selected` | 662x31.5 @303,182 | 6px 12px | 0px 0px 1px | 15px lh 19.5px | 4px |  | #222222 | oklch(0 0 none / 0.067) | #dadada | oklch(0.999994 0.0000497986 none / 0.067) |  |
| fuzzy highlight | `.suggestion-highlight` | 47.6x20 @315,187 |  |  | 15px w700 lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| hotkey chip | `.suggestion-hotkey` | 52.3x19.6 @901,221 | 2px 6px |  | 12px lh 15.6px | 24px |  | #222222 | oklch(0 0 none / 0.067) | #dadada | oklch(0.999994 0.0000497986 none / 0.067) |  |
| instructions bar | `.prompt-instructions` | 698x31.6 @291,647 | 8px |  | 12px lh 15.6px |  |  | #5c5c5c |  | #b3b3b3 |  | gap 12px |
| instruction | `.prompt-instruction` | 74.8x15.6 @529,655 |  |  | 12px lh 15.6px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| instruction key | `.prompt-instruction-command` | 11.3x16 @529,654 |  | 0px 4px 0px 0px | 12px w600 lh 15.6px |  |  | #5c5c5c |  | #b3b3b3 |  |  |

### Quick switcher

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| suggestion item | `.suggestion-item` | 674x47.1 @303,182 | 6px 12px | 0px 0px 1px | 15px lh 19.5px | 4px |  | #222222 | oklch(0 0 none / 0.067) | #dadada | oklch(0.999994 0.0000497986 none / 0.067) |  |
| suggestion note path | `.suggestion-note` | 110.2x15.6 @315,208 |  |  | 12px lh 15.6px |  |  | #5c5c5c |  | #b3b3b3 |  |  |
| suggestion path | `.suggestion-path` | not present in this state |||||||||||
| suggestion flair | `.suggestion-flair` | 16x16 @945,198 |  | 0px 4px 0px 12px | 15px lh 19.5px |  |  | #5c5c5c |  | #b3b3b3 |  | opacity 0.85; icon lucide-forward 16px |

### Context menu

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| menu | `.menu` | 193.2x402.6 @190,180 |  |  | 15px lh 19.5px | 8px | T:1px solid #dadada R:1px solid #dadada B:1px solid #dadada L:1px solid #dadada | #222222 | #f6f6f6 | #dadada | #282828 | shadow #000000/0.03 0px 1px 2px 0px, #000000/0.04 0px 3.4px 6.7px 0px, #000000/0.07 0px 15px 30px 0px; dark shadow #000000/0.12 0px 1px 2px 0px, #000000/0.18 0px 3.4px 6.7px 0px, #000000/0.30 0px 15px 30px 0px; dark border T:1px solid #3f3f3f R:1px solid #3f3f3f B:1px solid #3f3f3f L:1px solid #3f3f3f |
| menu item | `.menu-item` | 179.2x24.9 @197,187 | 4px 8px |  | 13px lh 16.9px | 4px |  | #222222 |  | #dadada |  | gap 8px |
| menu item icon | `.menu-item-icon` | 16x16 @205,191 |  |  | 13px lh 16.9px |  |  | #5c5c5c |  | #b3b3b3 |  | icon lucide-file-plus 16px |
| menu item title | `.menu-item-title` | 139.2x16.9 @229,191 |  |  | 13px lh 16.9px |  |  | #222222 |  | #dadada |  |  |
| menu separator | `.menu-separator` | 191.2x1 @191,268 |  | 6px -6px | 15px lh 19.5px |  | B:1px solid #e4e4e4 | #222222 |  | #dadada |  | ; dark border B:1px solid #333333 |
| warning item | `.menu-item.is-warning, .menu-item.mod-warning` | 179.2x24.9 @197,551 | 4px 8px |  | 13px lh 16.9px | 4px |  | #e93147 |  | #fb464c |  | gap 8px |

### Tooltip

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tooltip | `.tooltip` | 122.1x32.9 @44,74 | 8px 12px |  | 13px lh 16.9px | 12px |  | #fafafa | oklch(0 0 none / 0.9) | #fafafa | oklch(0 0 none / 0.9) | shadow #000000/0.03 0px 1px 2px 0px, #000000/0.04 0px 3.4px 6.7px 0px, #000000/0.07 0px 15px 30px 0px; dark shadow #000000/0.12 0px 1px 2px 0px, #000000/0.18 0px 3.4px 6.7px 0px, #000000/0.30 0px 15px 30px 0px |
| tooltip arrow | `.tooltip-arrow` | 10x10 @34,85 |  | 0px 0px 0px -5px | 0px lh 0px |  | T:5px solid #000000/0.00 R:5px solid oklch(0 0 none / 0.9) B:5px solid #000000/0.00 L:5px solid #000000/0.00 | #fafafa |  | #fafafa |  |  |

### Notice

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| notice container | `.notice-container` | 272.8x66.9 @1007,22 | 10px |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| notice | `.notice` | 252.8x32.9 @1017,32 | 8px 12px | 0px 0px 14px | 13px lh 16.9px | 8px |  | #fafafa | oklch(0 0 none / 0.9) | #fafafa | oklch(0 0 none / 0.9) | gap 8px |

### Page preview popover

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| popover | `.popover.hover-popover` | 452x402 @482,230 |  |  | 15px lh 19.5px | 8px | T:1px solid #e4e4e4 R:1px solid #e4e4e4 B:1px solid #e4e4e4 L:1px solid #e4e4e4 | #222222 | #ffffff | #dadada | #1c1c1c | shadow #000000/0.03 0px 1px 2px 0px, #000000/0.04 0px 3.4px 6.7px 0px, #000000/0.07 0px 15px 30px 0px; dark shadow #000000/0.12 0px 1px 2px 0px, #000000/0.18 0px 3.4px 6.7px 0px, #000000/0.30 0px 15px 30px 0px; dark border T:1px solid #333333 R:1px solid #333333 B:1px solid #333333 L:1px solid #333333 |
| popover embed | `.popover .markdown-embed` | 450x400 @483,231 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |

### Graph view

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| graph controls panel | `.graph-controls` | 240x706 @1028,90 |  |  | 15px lh 19.5px | 8px | T:1px solid #dadada R:1px solid #dadada B:1px solid #dadada L:1px solid #dadada | #222222 | #f6f6f6 | #dadada | #282828 | shadow #000000/0.03 0px 1px 2px 0px, #000000/0.04 0px 3.4px 6.7px 0px, #000000/0.07 0px 15px 30px 0px; dark shadow #000000/0.12 0px 1px 2px 0px, #000000/0.18 0px 3.4px 6.7px 0px, #000000/0.30 0px 15px 30px 0px; dark border T:1px solid #3f3f3f R:1px solid #3f3f3f B:1px solid #3f3f3f L:1px solid #3f3f3f |
| graph control section header | `.graph-controls .tree-item-self` | 214x24.9 @1041,97 | 4px 8px 4px 16px | 0px 0px 2px | 13px lh 16.9px | 8px |  | #5c5c5c |  | #b3b3b3 |  |  |
| graph slider | `.graph-controls input[type=range]` | 178.2x4 @1075,538 |  | 2px | 13px | 4px |  | #101010 | #dadada | #ffffff | #3f3f3f |  |
| graph toggle | `.graph-controls .checkbox-container` | 34x19 @1221,180 |  |  | 15px lh 19.5px | 18px |  | #222222 | #dadada | #dadada | #3f3f3f | shadow #000000/0.07 0px 4px 10px 0px inset; transition box-shadow 0.15s ease-in-out, outline 0.15s ease-in-out, border 0.15s ease-in-out, opacity 0.15s ease-in-out |
| graph canvas | `canvas` | 936x722 @344,78 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |

### Canvas

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| canvas wrapper | `.canvas-wrapper` | 936x722 @344,78 |  |  | 15px lh 19.5px |  |  | #222222 | #ffffff | #dadada | #1c1c1c |  |
| canvas node | `.canvas-node` | 209.2x97.6 @387,279 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| canvas node container | `.canvas-node-container` | 209.2x97.6 @387,279 |  |  | 15px lh 19.5px | 8px | T:1px solid oklch(0.686205 0.194562 148.477 / 0.7) R:1px solid oklch(0.686205 0.194562 148.477 / 0.7) B:1px solid oklch(0.686205 0.194562 148.477 / 0.7) L:1px solid oklch(0.686205 0.194562 148.477 / 0.7) | #222222 | #ffffff | #dadada | #1c1c1c | shadow oklch(0.686205 0.194562 148.477 / 0.7) 0px 0px 0px 1px inset, #000000/0.10 0px 0.5px 1px 0.5px; cursor grab; dark shadow oklch(0.757772 0.180999 149.614 / 0.7) 0px 0px 0px 1px inset, #000000/0.10 0px 0.5px 1px 0.5px; dark border T:1px solid oklch(0.757772 0.180999 149.614 / 0.7) R:1px solid oklch(0.757772 0.180999 149.614 / 0.7) B:1px solid oklch(0.757772 0.180999 149.614 / 0.7) L:1px solid oklch(0.757772 0.180999 149.614 / 0.7) |
| canvas node label | `.canvas-node-label` | 85.3x16.3 @666,259 |  |  | 15px lh 19.5px |  |  | #ababab |  | #666666 |  |  |
| canvas group label | `.canvas-group-label` | 56.8x25.5 @986,236 | 4px 8px |  | 22.5px lh 22.5px | 4px |  | #5c5c5c | oklch(0.807791 0.0000401911 none / 0.1) | #b3b3b3 | oklch(0.5931 0.0000295426 none / 0.1) | cursor grab |
| canvas controls | `.canvas-controls` | 34x292 @1238,86 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | gap 8px; icon lucide-settings 16px |
| canvas control button | `.canvas-control-item` | 32x32 @1239,87 | 8px |  | 15px lh 15px |  |  | #5c5c5c | #ffffff | #b3b3b3 | #1c1c1c | icon lucide-settings 16px |
| canvas card menu (bottom) | `.canvas-card-menu` | 144x48 @740,736 |  |  | 15px lh 19.5px | 4px |  | #222222 | #ffffff | #dadada | #282828 | shadow #000000/0.12 0px 0px 0px 1px inset, #000000/0.07 0px 1px 2px 0px, #000000/0.00 0px 0px 0px 0px; dark shadow #ffffff/0.09 0px 0.5px 0.5px 0.5px inset, #000000/0.15 0px 2px 4px 0px, #000000/0.10 0px 1px 1.5px 0px, #000000/0.20 0px 1px 2px 0px, #000000/0.00 0px 0px 0px 0px |
| canvas card menu button | `.canvas-card-menu-button` | 48x48 @740,736 | 8px |  | 15px lh 15px |  |  | #5c5c5c |  | #b3b3b3 |  | icon lucide-sticky-note 32px; cursor grab |
| canvas edge path | `.canvas-edges path.canvas-display-path` | 64.9x55.8 @596,327 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  | transition stroke-width 0.1s ease-out |
| canvas background dots | `.canvas-background` | 936x722 @344,78 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |

### Stacked tabs

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stacked tab container | `.mod-root .workspace-tabs.mod-stacked` | 936x800 @344,0 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| stacked tab header | `.mod-root .mod-stacked .workspace-tab-header` | 40x748 @344,40 |  |  | 15px lh 19.5px |  |  | #222222 | #ffffff | #dadada | #1c1c1c | shadow #e4e4e4 -1px 0px 0px 0px, #000000/0.05 -8px 0px 8px 0px; icon lucide-file 14px; dark shadow #333333 -1px 0px 0px 0px, #000000/0.05 -8px 0px 8px 0px |
| stacked leaf | `.mod-root .mod-stacked .workspace-leaf` | 700x748 @384,40 |  |  | 15px lh 19.5px |  |  | #222222 | #ffffff | #dadada | #1c1c1c |  |

### Empty tab

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| empty state | `.empty-state` | 936x760 @344,40 |  |  | 15px lh 19.5px |  |  | #222222 |  | #dadada |  |  |
| empty state action | `.empty-state-action` | 165.5x38.9 @729,354 | 8px 12px |  | 13px lh 16.9px | 26px | T:1px solid #e4e4e4 R:1px solid #e4e4e4 B:1px solid #e4e4e4 L:1px solid #e4e4e4 | #222222 |  | #dadada |  | gap 8px; dark border T:1px solid #333333 R:1px solid #333333 B:1px solid #333333 L:1px solid #333333 |
| empty state hotkey | `.workspace-leaf.mod-active .empty-state-action .empty-state-action-hotkey, .empty-state-action kbd` | not present in this state |||||||||||

### Editor search bar

| Element | Selector | box | padding | margin | font | radius | border (light) | color L | bg L | color D | bg D | shadow / other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| document search container | `.document-search-container` | 904x84 @360,78 | 8px 0px | 0px 16px | 16px lh 24px |  |  | #222222 | #ffffff | #dadada | #1c1c1c | gap 8px |
| document search input | `.document-search-input` | 548x30 @470,86 |  |  | 16px lh 24px | 5px |  | #222222 |  | #dadada |  |  |
| document search button | `.document-search-button` | 28x24 @1026,89 | 4px 6px |  | 13px | 4px |  | #5c5c5c |  | #b3b3b3 |  | transition none; icon lucide-arrow-up 16px |

## 3. Icons (Lucide names) per button

Every clickable icon with an `aria-label`, as seen in each screen. "size" is the rendered SVG width in px.

### Window shell, ribbon, sidebars, tabs, status bar

| aria-label | element class | icon | size |
|---|---|---|---|
|  | `sidebar-toggle-button.mod-primary.mod-left` | `sidebar-toggle-button-icon` | 16 |
| Open quick switcher | `clickable-icon.side-dock-ribbon-action` | `lucide-file-search` | 16 |
| Open graph view | `clickable-icon.side-dock-ribbon-action` | `lucide-git-fork` | 16 |
| Create new canvas | `clickable-icon.side-dock-ribbon-action` | `lucide-layout-dashboard` | 16 |
| Open today's daily note | `clickable-icon.side-dock-ribbon-action` | `lucide-calendar` | 16 |
| Insert template | `clickable-icon.side-dock-ribbon-action` | `lucide-files` | 16 |
| Open command palette | `clickable-icon.side-dock-ribbon-action` | `lucide-terminal` | 16 |
| Create new base | `clickable-icon.side-dock-ribbon-action` | `lucide-layout-list` | 16 |
|  | `workspace-drawer-vault-switcher` | `lucide-chevrons-up-down` | 16 |
| Files | `workspace-tab-header.tappable.is-active` | `lucide-folder-closed` | 16 |
| Search | `workspace-tab-header.tappable` | `lucide-search` | 16 |
| Bookmarks | `workspace-tab-header.tappable` | `lucide-bookmark` | 16 |
| New note | `clickable-icon.nav-action-button` | `lucide-edit` | 16 |
| New folder | `clickable-icon.nav-action-button` | `lucide-folder-plus` | 16 |
| Change sort order | `clickable-icon.nav-action-button` | `lucide-sort-asc` | 16 |
| Auto-reveal current file | `clickable-icon.nav-action-button` | `lucide-gallery-vertical` | 16 |
| Collapse all | `clickable-icon.nav-action-button` | `lucide-chevrons-down-up` | 16 |
| Close | `workspace-tab-header-inner-close-button` | `lucide-x` | 16 |
| New tab | `clickable-icon` | `lucide-plus` | 16 |
| Navigate back | `clickable-icon` | `lucide-arrow-left` | 16 |
| Navigate forward | `clickable-icon` | `lucide-arrow-right` | 16 |
| Bookmarked | `clickable-icon.view-action.mod-bookmark` | `lucide-bookmark` | 16 |
| Current view: editing Click to read Ctrl+Click to open to the right | `clickable-icon.view-action` | `lucide-book-open` | 16 |
| More options | `clickable-icon.view-action` | `lucide-more-vertical` | 16 |
| Open daily note | `clickable-icon` | `lucide-link` | 14 |
| Live Preview | `status-bar-item.plugin-editor-status.mod-clickable` | `lucide-edit-3` | 16 |
| Uninitialized | `status-bar-item.plugin-sync` | `refresh-cw-off` | 16 |

### Callouts in Live Preview

| aria-label | element class | icon | size |
|---|---|---|---|
| Edit this block | `embed-action.edit-block-button` | `lucide-code-2` | 16 |

### Source mode

| aria-label | element class | icon | size |
|---|---|---|---|
| Source mode | `status-bar-item.plugin-editor-status.mod-clickable` | `lucide-code-2` | 16 |

### Reading view

| aria-label | element class | icon | size |
|---|---|---|---|
| Current view: reading Click to edit Ctrl+Click to open to the right | `clickable-icon.view-action` | `lucide-edit-3` | 16 |
| Reading | `status-bar-item.plugin-editor-status.mod-clickable` | `lucide-book-open` | 16 |

### Tables and code in Live Preview

| aria-label | element class | icon | size |
|---|---|---|---|
| Add row below | `table-row-btn` | `lucide-plus` | 16 |
| Add column to the right | `table-col-btn` | `lucide-plus` | 15 |

### Embeds

| aria-label | element class | icon | size |
|---|---|---|---|
| Open link | `markdown-embed-link` | `lucide-maximize-2` | 16 |
| Toggle sidebar | `clickable-icon` | `lucide-layout-list` | 16 |
| Sidebar options | `clickable-icon` | `lucide-chevron-down` | 16 |
| Zoom out | `clickable-icon` | `lucide-zoom-out` | 16 |
| Zoom in | `clickable-icon` | `lucide-zoom-in` | 16 |
| Display options | `clickable-icon` | `lucide-chevron-down` | 16 |
| Open | `clickable-icon` | `lucide-more-vertical` | 16 |

### Search pane

| aria-label | element class | icon | size |
|---|---|---|---|
| Match case | `input-right-decorator.clickable-icon` | `uppercase-lowercase-a` | 16 |
| Search settings | `clickable-icon` | `lucide-sliders-horizontal` | 16 |

### Backlinks pane

| aria-label | element class | icon | size |
|---|---|---|---|
| Backlinks | `workspace-tab-header.tappable.is-active` | `links-coming-in` | 16 |
| Outgoing links | `workspace-tab-header.tappable` | `links-going-out` | 16 |
| Tags | `workspace-tab-header.tappable` | `lucide-tags` | 16 |
| All properties | `workspace-tab-header.tappable` | `lucide-archive` | 16 |
| Outline | `workspace-tab-header.tappable` | `lucide-list` | 16 |
| Collapse results | `clickable-icon.nav-action-button` | `lucide-list` | 16 |
| Show more context | `clickable-icon.nav-action-button` | `lucide-move-vertical` | 16 |
| Show search filter | `clickable-icon.nav-action-button` | `lucide-search` | 16 |

### Tags pane

| aria-label | element class | icon | size |
|---|---|---|---|
| Show nested tags | `clickable-icon.nav-action-button.is-active` | `lucide-folder-tree` | 16 |
| Expand all | `clickable-icon.nav-action-button` | `lucide-chevrons-up-down` | 16 |

### Outline pane

| aria-label | element class | icon | size |
|---|---|---|---|
| Auto-scroll to current section | `clickable-icon.nav-action-button` | `lucide-gallery-vertical` | 16 |

### Quick switcher

| aria-label | element class | icon | size |
|---|---|---|---|
| Alias | `suggestion-flair` | `lucide-forward` | 16 |

### Graph view

| aria-label | element class | icon | size |
|---|---|---|---|
| Graph view | `workspace-tab-header.tappable.mod-active` | `lucide-git-fork` | 14 |
| Restore default settings | `clickable-icon.graph-controls-button.mod-reset` | `lucide-rotate-ccw` | 16 |

### Canvas

| aria-label | element class | icon | size |
|---|---|---|---|
| Garden board | `workspace-tab-header.tappable.mod-active` | `lucide-layout-dashboard` | 14 |
| Drag to add card | `canvas-card-menu-button.mod-draggable` | `lucide-sticky-note` | 32 |
| Drag to add note from vault | `canvas-card-menu-button.mod-draggable` | `lucide-file-text` | 32 |
| Drag to add media from vault | `canvas-card-menu-button.mod-draggable` | `lucide-file-image` | 32 |
| Canvas settings | `canvas-control-item` | `lucide-settings` | 16 |
| Zoom in | `canvas-control-item` | `lucide-plus` | 16 |
| Reset zoom | `canvas-control-item` | `lucide-rotate-cw` | 16 |
| Zoom to fit (Shift + 1) | `canvas-control-item` | `lucide-maximize` | 16 |
| Zoom out | `canvas-control-item` | `lucide-minus` | 16 |
| Undo | `canvas-control-item.is-disabled` | `lucide-undo-2` | 16 |
| Redo | `canvas-control-item.is-disabled` | `lucide-redo-2` | 16 |
| Canvas help | `canvas-control-item` | `lucide-help-circle` | 16 |

### Stacked tabs

| aria-label | element class | icon | size |
|---|---|---|---|
| Welcome | `workspace-tab-header.tappable` | `lucide-file` | 14 |
| Garden Planner | `workspace-tab-header.tappable` | `lucide-file` | 14 |
| Ada Lovelace | `workspace-tab-header.tappable` | `lucide-file` | 14 |
| Alan Turing | `workspace-tab-header.tappable.mod-active` | `lucide-file` | 14 |

### Empty tab

| aria-label | element class | icon | size |
|---|---|---|---|
| New note | `text-icon-button.tappable.mod-pill` | `lucide-square-pen` | 16 |
| New base | `text-icon-button.tappable.mod-pill` | `lucide-layout-list` | 16 |
| New canvas | `text-icon-button.tappable.mod-pill` | `lucide-layout-dashboard` | 16 |
| Go to file | `text-icon-button.tappable.mod-pill` | `lucide-search` | 16 |

### Editor search bar

| aria-label | element class | icon | size |
|---|---|---|---|
| Previous Shift + F3 | `clickable-icon.document-search-button` | `lucide-arrow-up` | 16 |
| Next F3 | `clickable-icon.document-search-button` | `lucide-arrow-down` | 16 |
| Find all Alt + Enter | `clickable-icon.document-search-button` | `lucide-text-select` | 16 |
| Exit search | `clickable-icon.document-search-close-button` | `lucide-x` | 16 |
| Replace Enter | `clickable-icon.document-search-button` | `lucide-replace` | 16 |
| Replace all Ctrl + Alt + Enter | `clickable-icon.document-search-button` | `lucide-replace-all` | 16 |

Property type icons (measured on the Welcome note): aliases `lucide-forward`, tags `lucide-tags`, date `lucide-calendar`, text `lucide-text`, number `lucide-binary`, checkbox `lucide-check-square`. Folder and fold chevrons use the custom icon `right-triangle`. Status bar: the editing-mode item shows `lucide-book-open` in reading view (a pencil in editing view); the Sync item shows `refresh-cw-off` while Sync is not set up.

Callouts. Icons were measured in reading view for the types marked (measured); the rest come from public docs. Colors are CSS variables (light theme values here; dark values are in section 6).

| Type (aliases) | Icon | Color variable (light) |
|---|---|---|
| note | `lucide-pencil` (measured) | `--callout-default` #086ddd |
| abstract (summary, tldr) | `lucide-clipboard-list` (measured) | `--callout-summary` #00bfbc |
| info | `lucide-info` (measured) | `--callout-info` #086ddd |
| todo | `lucide-check-circle-2` (measured) | `--callout-todo` #086ddd |
| tip (hint, important) | `lucide-flame` (measured) | `--callout-tip` / `--callout-important` #00bfbc |
| success (check, done) | `lucide-check` (measured) | `--callout-success` #08b94e |
| question (help, faq) | `lucide-help-circle` (measured) | `--callout-question` #ec7500 |
| warning (caution, attention) | `lucide-alert-triangle` (measured) | `--callout-warning` #ec7500 |
| failure (fail, missing) | an "x" icon (docs) | `--callout-fail` #e93147 |
| danger (error) | a "zap" icon (docs) | `--callout-error` #e93147 |
| bug | a "bug" icon (docs) | `--callout-bug` #e93147 |
| example | a "list" icon (docs) | `--callout-example` #7852ee |
| quote (cite) | a "quote" icon (docs) | `--callout-quote` #9e9e9e |

Callout box tokens: padding 12px 12px 12px 24px, radius 4px, border width 0, title weight 600 (400 + 200), blend mode `darken` in light theme. Unknown types fall back to the note style.



## 4. DOM structure (class names themes and plugins rely on)

Indented trees, captured from the live DOM. `(x N)` = N siblings of the same shape. Bedrock must produce these class names and nesting so community themes, CSS snippets and plugins keep working.

### Whole window (depth 4)

Root: `body > .app-container`

```
div.app-container
  div.horizontal-main-container
    div.workspace.is-primary-sidedock-open.is-left-sidedock-open
      div.workspace-ribbon.side-dock-ribbon.mod-primary
        div.sidebar-toggle-button.mod-primary.mod-left[aria-label=""]
          div.clickable-icon
            ...
        div.side-dock-actions
          div.clickable-icon.side-dock-ribbon-action[aria-label="Open quick switcher"]
            ...
          (div.clickable-icon.side-dock-ribbon-action x7)
        div.side-dock-settings
      div.workspace-split.mod-horizontal.mod-sidedock.mod-primary-split.mod-left-split
        hr.workspace-leaf-resize-handle.tappable
        div.workspace-sidedock-vault-profile
          div.workspace-drawer-vault-switcher[aria-label=""]
            ...
          div.workspace-drawer-vault-actions
            ...
        div.workspace-sidedock-empty-state
          p.u-muted
        div.workspace-tabs.mod-top.mod-top-left-space
          hr.workspace-leaf-resize-handle.tappable
          div.workspace-tab-header-container
            ...
          div.workspace-tab-container
            ...
      div.workspace-split.mod-vertical.mod-root
        hr.workspace-leaf-resize-handle.tappable
        div.workspace-tabs.mod-active.mod-top.mod-top-right-space
          hr.workspace-leaf-resize-handle.tappable
          div.workspace-tab-header-container
            ...
          div.workspace-tab-container
            ...
      div.workspace-split.mod-horizontal.mod-sidedock.mod-secondary-split.mod-right-split.is-sidedock-collapsed
        hr.workspace-leaf-resize-handle.tappable
        div.workspace-sidedock-empty-state
          p.u-muted
        div.workspace-tabs.mod-top.mod-top-right-space
          hr.workspace-leaf-resize-handle.tappable
          div.workspace-tab-header-container
            ...
          div.workspace-tab-container
            ...
      div.workspace-ribbon.side-dock-ribbon.mod-secondary.is-collapsed
  div.status-bar
    div.status-bar-item.plugin-backlink.mod-clickable
    div.status-bar-item.plugin-properties.mod-clickable
    div.status-bar-item.plugin-editor-status.mod-clickable[aria-label="Live Preview"]
      span.status-bar-item-icon
        svg.svg-icon.lucide-edit-3
    div.status-bar-item.plugin-word-count
      span.status-bar-item-segment
      (span.status-bar-item-segment x2)
    div.status-bar-item.plugin-sync[aria-label="Uninitialized"]
      div.status-bar-item-segment
        span.status-bar-item-icon.sync-status-icon.mod-error
          svg.svg-icon.refresh-cw-off
            ...
```

### Left sidebar with file explorer

Root: `.workspace-split.mod-left-split`

```
div.workspace-split.mod-horizontal.mod-sidedock.mod-primary-split.mod-left-split
  hr.workspace-leaf-resize-handle.tappable
  div.workspace-sidedock-vault-profile
    div.workspace-drawer-vault-switcher[aria-label=""]
      div.workspace-drawer-vault-switcher-icon
        svg.svg-icon.lucide-chevrons-up-down
      div.workspace-drawer-vault-name
    div.workspace-drawer-vault-actions
      span.clickable-icon
        svg.svg-icon.help
      (span.clickable-icon x2)
  div.workspace-sidedock-empty-state
    p.u-muted
  div.workspace-tabs.mod-top.mod-top-left-space
    hr.workspace-leaf-resize-handle.tappable
    div.workspace-tab-header-container
      div.workspace-tab-header-container-inner
        div.workspace-tab-header.tappable.is-active[data-type="file-explorer"][aria-label="Files"]
          div.workspace-tab-header-inner
            div.workspace-tab-header-inner-icon
              svg.svg-icon.lucide-folder-closed
            div.workspace-tab-header-inner-title
            div.workspace-tab-header-status-container
            div.workspace-tab-header-inner-close-button[aria-label="Close"]
              svg.svg-icon.lucide-x
        div.workspace-tab-header.tappable[data-type="search"][aria-label="Search"]
          div.workspace-tab-header-inner
            div.workspace-tab-header-inner-icon
              svg.svg-icon.lucide-search
            div.workspace-tab-header-inner-title
            div.workspace-tab-header-status-container
            div.workspace-tab-header-inner-close-button[aria-label="Close"]
              svg.svg-icon.lucide-x
        (div.workspace-tab-header.tappable x2)
      div.workspace-tab-header-new-tab
        span.clickable-icon[aria-label="New tab"]
          svg.svg-icon.lucide-plus
      div.workspace-tab-header-spacer
      div.workspace-tab-header-tab-list
        span.clickable-icon
          svg.svg-icon.lucide-chevron-down
    div.workspace-tab-container
      div.workspace-leaf
        hr.workspace-leaf-resize-handle.tappable
        div.workspace-leaf-content[data-type="file-explorer"]
          div.nav-header
            div.nav-buttons-container
              div.clickable-icon.nav-action-button[aria-label="New note"]
                svg.svg-icon.lucide-edit
              (div.clickable-icon.nav-action-button x6)
            div.search-input-container
              input
              div.search-input-clear-button[aria-label="Clear search"]
          div.nav-files-container.node-insert-event
            div
              div
              div.tree-item.nav-folder
                div.tree-item-self.nav-folder-title.is-clickable.mod-collapsible[data-path="Attachments"]
                  div.tree-item-icon.collapse-icon
                    ...
                  div.tree-item-inner.nav-folder-title-content
                div.tree-item-children.nav-folder-children
                  div
                  div.tree-item.nav-file
                    ...
                  (div.tree-item.nav-file x3)
              div.tree-item.nav-file
                div.tree-item-self.nav-file-title.tappable.is-clickable[data-path="Garden board.canvas"]
                  div.tree-item-inner.nav-file-title-content
                  div.nav-file-tag
              (div.tree-item.nav-folder x7)
              (div.tree-item.nav-file x2)
      (div.workspace-leaf x3)
```

### Main tab group + leaf

Root: `.workspace-split.mod-root`

```
div.workspace-split.mod-vertical.mod-root
  hr.workspace-leaf-resize-handle.tappable
  div.workspace-tabs.mod-active.mod-top.mod-top-right-space
    hr.workspace-leaf-resize-handle.tappable
    div.workspace-tab-header-container
      div.workspace-tab-header-container-inner
        div.workspace-tab-header.tappable.mod-active.is-active[data-type="markdown"][aria-label="Welcome"]
          div.workspace-tab-header-inner
            div.workspace-tab-header-inner-icon
              ...
            div.workspace-tab-header-inner-title
            div.workspace-tab-header-status-container
            div.workspace-tab-header-inner-close-button[aria-label="Close"]
              ...
      div.workspace-tab-header-new-tab
        span.clickable-icon[aria-label="New tab"]
          svg.svg-icon.lucide-plus
      div.workspace-tab-header-spacer
      div.workspace-tab-header-tab-list
        span.clickable-icon
          svg.svg-icon.lucide-chevron-down
      div.sidebar-toggle-button.mod-secondary.mod-right[aria-label=""]
        div.clickable-icon
          svg.svg-icon.sidebar-toggle-button-icon
    div.workspace-tab-container
      div.workspace-leaf.mod-active
        hr.workspace-leaf-resize-handle.tappable
        div.workspace-leaf-content[data-type="markdown"]
          div.view-header
            div.view-header-left
              ...
            div.view-header-title-container.mod-at-start.mod-fade.mod-at-end
              ...
            div.view-actions.mod-raised
              ...
          div.view-content
            div.markdown-source-view.cm-s-obsidian.mod-cm6.node-insert-event.is-readable-line-width.is-live-preview.is-folding.show-properties
              ...
            div.markdown-reading-view
              ...
```

### Live Preview editor

Root: `.workspace-leaf.mod-active .markdown-source-view`

```
div.markdown-source-view.cm-s-obsidian.mod-cm6.node-insert-event.is-readable-line-width.is-live-preview.is-folding.show-properties
  div.cm-editor.cm-focused.ͼ1.ͼ2
    div.cm-announced
    div.cm-scroller
      div.cm-sizer
        div.inline-title
        div.metadata-container
          div.metadata-error-container
          div.metadata-properties-heading
            div.collapse-indicator.collapse-icon
              ...
            div.metadata-properties-title
          div.metadata-content
            div.metadata-properties
              ...
            div.metadata-add-button.text-icon-button
              ...
        div.cm-contentContainer
          div.cm-content.cm-lineWrapping
            div
            div.cm-line.cm-active.HyperMD-header.HyperMD-header-1
              ...
            div.cm-line
              ...
            div.cm-line.HyperMD-header.HyperMD-header-2
              ...
            div.cm-line.HyperMD-list-line.HyperMD-list-line-1
              ...
            div.cm-line.HyperMD-list-line.HyperMD-list-line-1.HyperMD-task-line
              ...
            ...
            (div.cm-line x4)
            (div.cm-line.HyperMD-header.HyperMD-header-2 x2)
            (div.cm-line.HyperMD-list-line.HyperMD-list-line-1 x6)
            (div.cm-line.HyperMD-list-line.HyperMD-list-line-1.HyperMD-task-line x3)
        div.embedded-backlinks
      div.cm-layer.cm-layer-above.cm-cursorLayer
      div.cm-layer.cm-selectionLayer
```

### Properties block

Root: `.workspace-leaf.mod-active .metadata-container`

```
div.metadata-container
  div.metadata-error-container
  div.metadata-properties-heading
    div.collapse-indicator.collapse-icon
      svg.svg-icon.right-triangle
    div.metadata-properties-title
  div.metadata-content
    div.metadata-properties
      div.metadata-property[data-property-key="aliases"]
        div.metadata-property-key
          span.metadata-property-icon
            svg.svg-icon.lucide-forward
          input.metadata-property-key-input[aria-label="aliases"]
        div.metadata-property-value
          div.multi-select-container
            div.multi-select-pill
              div.multi-select-pill-content
              div.multi-select-pill-remove-button
                ...
            div.multi-select-input
            (div.multi-select-pill x2)
        div.clickable-icon.metadata-property-warning-icon[aria-label="Type mismatch, expected Aliase"]
          svg.svg-icon.lucide-alert-triangle
      (div.metadata-property x6)
    div.metadata-add-button.text-icon-button
      span.text-button-icon
        svg.svg-icon.lucide-plus
      span.text-button-label
```

### Reading view

Root: `.workspace-leaf.mod-active .markdown-reading-view`

```
div.markdown-reading-view
  div.markdown-preview-view.markdown-rendered.node-insert-event.is-readable-line-width.allow-fold-headings.allow-fold-lists.show-indentation-guide.show-properties
    div.markdown-preview-sizer.markdown-preview-section
      div.markdown-preview-pusher
      div.mod-header.mod-ui
        div.inline-title
        div.metadata-container
          div.metadata-error-container
          div.metadata-properties-heading
            div.collapse-indicator.collapse-icon
              ...
            div.metadata-properties-title
          div.metadata-content
            div.metadata-properties
              ...
            div.metadata-add-button.text-icon-button
              ...
      div.el-pre.mod-frontmatter.mod-ui
        pre.frontmatter.language-yaml
          code.language-yaml.is-loaded
            span.token.key.atrule
            span.token.punctuation
            span.token.datetime.number
            span.token.number
            span.token.boolean.important
            (span.token.key.atrule x6)
            (span.token.punctuation x12)
          button.copy-code-button
            svg.svg-icon.lucide-copy
              ...
      div.el-h1
        h1
          span.heading-collapse-indicator.collapse-indicator.collapse-icon
            svg.svg-icon.right-triangle
              ...
      div.el-p
        p
          strong
          em
          del
          mark
          code
          (strong x2)
      div.el-h2
        h2
          span.heading-collapse-indicator.collapse-indicator.collapse-icon
            svg.svg-icon.right-triangle
              ...
      div.el-ul
        ul.has-list-bullet
          li
            span.list-bullet
            a.internal-link[aria-label="Projects/Garden Planner"]
          (li x6)
      div.el-div
        div.callout[data-callout="note"]
          div.callout-title
            div.callout-icon
              ...
            div.callout-title-inner
          div.callout-content
            p
              ...
      div
      div.el-section
        section.footnotes
          hr
          ol
            li
              ...
      div.mod-footer.mod-ui
        div.embedded-backlinks
      (div.el-p x2)
      (div.el-h2 x2)
      (div.el-ul x2)
      (div.el-div x3)
      (div x2)
```

### Callout (reading)

Root: `.workspace-leaf.mod-active .markdown-preview-view .callout`

```
div.callout[data-callout="note"]
  div.callout-title
    div.callout-icon
      svg.svg-icon.lucide-pencil
    div.callout-title-inner
  div.callout-content
    p
      code
```

### Embeds (reading)

Root: `.workspace-leaf.mod-active .markdown-preview-sizer`

```
div.markdown-preview-sizer.markdown-preview-section
  div.markdown-preview-pusher
  div.mod-header.mod-ui
    div.inline-title
    div.metadata-container.is-collapsed
      div.metadata-error-container
      div.metadata-properties-heading.is-collapsed
        div.collapse-indicator.collapse-icon.is-collapsed
          svg.svg-icon.right-triangle
        div.metadata-properties-title
      div.metadata-content
        div.metadata-properties
          div.metadata-property[data-property-key="tags"]
            div.metadata-property-key
              ...
            div.metadata-property-value
              ...
            div.clickable-icon.metadata-property-warning-icon[aria-label="Type mismatch, expected Tags"]
              ...
        div.metadata-add-button.text-icon-button
          span.text-button-icon
            svg.svg-icon.lucide-plus
              ...
          span.text-button-label
```

### Search pane

Root: `.workspace-leaf-content[data-type=search]`

```
div.workspace-leaf-content[data-type="search"]
  div.search-row
    div.search-input-container.global-search-input-container
      input
      div.search-input-clear-button[aria-label="Clear search"]
      div.input-right-decorator.clickable-icon[aria-label="Match case"]
        svg.svg-icon.uppercase-lowercase-a
    div.clickable-icon[aria-label="Search settings"]
      svg.svg-icon.lucide-sliders-horizontal
  div.search-info-container
    div
  div.search-params
    div.setting-item.mod-toggle
      div.setting-item-info
        div.setting-item-name
        div.setting-item-description
      div.setting-item-control
        label.checkbox-container
          input
    (div.setting-item.mod-toggle x3)
  ...
```

### Backlinks pane

Root: `.workspace-leaf-content[data-type=backlink]`

```
div.workspace-leaf-content[data-type="backlink"]
  div.view-header
    div.view-header-left
      div.view-header-nav-buttons
        button.clickable-icon[aria-label="Navigate back"]
          svg.svg-icon.lucide-arrow-left
        (button.clickable-icon x2)
    div.view-header-title-container.mod-at-start.mod-fade.mod-at-end
      div.view-header-title-parent
        span.view-header-breadcrumb[aria-label="Projects"]
        span.view-header-breadcrumb-separator
      div.view-header-title
    div.view-actions.mod-raised
      button.clickable-icon.view-action.mod-bookmark[aria-label="Bookmark"]
        svg.svg-icon.lucide-bookmark
      button.clickable-icon.view-action[aria-label="More options"]
        svg.svg-icon.lucide-more-vertical
  div.view-content
    div.nav-header
      div.nav-buttons-container
        div.clickable-icon.nav-action-button[aria-label="Collapse results"]
          svg.svg-icon.lucide-list
        (div.clickable-icon.nav-action-button x4)
      div.search-input-container
        input
        div.search-input-clear-button[aria-label="Clear search"]
    div.backlink-pane.node-insert-event
      div.tree-item-self.is-clickable[aria-label="Click to collapse"]
        span.tree-item-icon.collapse-icon
          svg.svg-icon.right-triangle
        div.tree-item-inner
        div.tree-item-flair-outer
          span.tree-item-flair
      div.search-result-container
        div.search-results-children
          div
          div.tree-item.search-result
            div.tree-item-self.search-result-file-title.is-clickable
              div.tree-item-icon.collapse-icon
                svg.svg-icon.right-triangle
              div.tree-item-inner
              div.tree-item-flair-outer
                span.tree-item-flair
            div.search-result-file-matches
              div
              div.search-result-file-match.tappable
                span
                span.search-result-file-matched-text
                div.search-result-hover-button.mod-top[aria-label="Show more context"]
                  svg.svg-icon.lucide-chevron-up
                    ...
                ...
                (span x2)
          (div.tree-item.search-result x6)
      (div.tree-item-self.is-clickable x2)
      (div.search-result-container x2)
```

### Command palette

Root: `.modal-container`

```
div.modal-container.mod-dim
  div.modal-bg
  div.prompt
    div.prompt-input-container.mod-raised
      input.prompt-input
      div.prompt-input-cta
      div.search-input-clear-button
    div.prompt-results
      div.suggestion-item.mod-complex.is-selected
        div.suggestion-content
          div.suggestion-title
            span
              ...
        div.suggestion-aux
      div.suggestion-item.mod-complex
        div.suggestion-content
          div.suggestion-title
            span
              ...
        div.suggestion-aux
          kbd.suggestion-hotkey
      (div.suggestion-item.mod-complex x33)
    div.prompt-instructions
      div.prompt-instruction
        span.prompt-instruction-command
        span
      (div.prompt-instruction x3)
```

### Context menu

Root: `.menu`

```
div.menu
  div.menu-grabber
  div.menu-scroll
    div.menu-group
      div.menu-item.tappable
        div.menu-item-icon
          ...
        div.menu-item-title
      (div.menu-item.tappable x3)
    div.menu-separator
    (div.menu-group x6)
    (div.menu-separator x6)
```

### Graph view

Root: `.workspace-leaf.mod-active .view-content`

```
div.view-content
  canvas
  iframe
  div.graph-controls
    div.clickable-icon.graph-controls-button.mod-close[aria-label="Close"]
      svg.svg-icon.lucide-x
    div.clickable-icon.graph-controls-button.mod-open[aria-label="Open graph settings"]
      svg.svg-icon.lucide-settings
    div.clickable-icon.graph-controls-button.mod-animate[aria-label="Start timelapse animation"]
      svg.svg-icon.lucide-wand-2
    div.clickable-icon.graph-controls-button.mod-reset[aria-label="Restore default settings"]
      svg.svg-icon.lucide-rotate-ccw
    div.tree-item.graph-control-section.mod-filter
      div.tree-item-self.mod-collapsible
        div.tree-item-icon.collapse-icon
          svg.svg-icon.right-triangle
        div.tree-item-inner
          header.graph-control-section-header
      div.tree-item-children
        div.setting-item.mod-search-setting
          div.setting-item-info
            div.setting-item-name
            div.setting-item-description
          div.setting-item-control
            div.search-input-container
              ...
        div.setting-item.mod-toggle
          div.setting-item-info
            div.setting-item-name[aria-label="Tags are linked to the files t"]
            div.setting-item-description
          div.setting-item-control
            label.checkbox-container
              ...
        (div.setting-item.mod-toggle x4)
    div.tree-item.graph-control-section.mod-color-groups
      div.tree-item-self.mod-collapsible
        div.tree-item-icon.collapse-icon
          svg.svg-icon.right-triangle
        div.tree-item-inner
          header.graph-control-section-header
      div.tree-item-children
        div.graph-color-groups-container
        div.graph-color-button-container
          button
    ...
```

### Canvas

Root: `.workspace-leaf.mod-active .view-content`

```
div.view-content
  div.canvas-wrapper.node-insert-event
    svg.canvas-background
      pattern
    div.canvas-card-menu
      div.canvas-card-menu-button.mod-draggable[aria-label="Drag to add card"]
        svg.svg-icon.lucide-sticky-note
      (div.canvas-card-menu-button.mod-draggable x3)
    div.canvas-controls
      div.canvas-control-group.mod-raised
        div.canvas-control-item[aria-label="Canvas settings"]
          svg.svg-icon.lucide-settings
      (div.canvas-control-group.mod-raised x4)
    div.canvas
      svg.canvas-edges
        g
        g.is-themed.mod-canvas-color-1
      div.canvas-node.is-themed.mod-canvas-color-4
        div.canvas-node-container
          div.canvas-node-content.markdown-embed
            div.markdown-embed-content.node-insert-event
              div.markdown-preview-view.markdown-rendered.node-insert-event.show-indentation-guide.allow-fold-headings.allow-fold-lists
                ...
            (div.markdown-embed-content.node-insert-event x2)
          div.canvas-node-content-blocker
      div.canvas-node
        div.canvas-node-container
          div.canvas-node-content.markdown-embed.is-loaded
            div.markdown-embed-content.node-insert-event
              div.markdown-preview-view.markdown-rendered.node-insert-event.show-indentation-guide.allow-fold-headings.allow-fold-lists.show-properties
                ...
            div.markdown-embed-link[aria-label="Open link"]
              svg.svg-icon.lucide-maximize-2
                ...
            (div.markdown-embed-content.node-insert-event x2)
          div.canvas-node-content-blocker
        div.canvas-node-label
      div.canvas-node.canvas-node-group
        div.canvas-node-container
          div.canvas-node-content
        div.canvas-group-label
      div.canvas-node.is-themed.mod-canvas-color-2
        div.canvas-node-container
          div.canvas-node-content.markdown-embed
            div.markdown-embed-content.node-insert-event
              div.markdown-preview-view.markdown-rendered.node-insert-event.show-indentation-guide.allow-fold-headings.allow-fold-lists
                ...
            (div.markdown-embed-content.node-insert-event x2)
          div.canvas-node-content-blocker
      ...
      (svg.canvas-edges x2)
      (div.canvas-node x4)
```

### Stacked tabs

Root: `.mod-root .workspace-tabs`

```
div.workspace-tabs.mod-active.mod-stacked.mod-top.mod-top-right-space
  hr.workspace-leaf-resize-handle.tappable
  div.workspace-tab-header-container
    div.workspace-tab-header-container-inner
    div.workspace-tab-header-new-tab
      span.clickable-icon[aria-label="New tab"]
        svg.svg-icon.lucide-plus
          ...
    div.workspace-tab-header-spacer
    div.workspace-tab-header-tab-list
      span.clickable-icon
        svg.svg-icon.lucide-chevron-down
          ...
    div.sidebar-toggle-button.mod-secondary.mod-right[aria-label=""]
      div.clickable-icon
        svg.svg-icon.sidebar-toggle-button-icon
          ...
  div.workspace-tab-container
    div.workspace-tab-header.tappable[data-type="markdown"][aria-label="Welcome"]
      div.workspace-tab-header-inner
        div.workspace-tab-header-inner-icon
          ...
        div.workspace-tab-header-inner-title
        div.workspace-tab-header-status-container
        div.workspace-tab-header-inner-close-button[aria-label="Close"]
          ...
    div.workspace-leaf.is-hidden
      hr.workspace-leaf-resize-handle.tappable
      div.workspace-leaf-content[data-type="markdown"]
        div.view-header
          ...
        div.view-content
          ...
    div.workspace-leaf
      hr.workspace-leaf-resize-handle.tappable
      div.workspace-leaf-content[data-type="markdown"]
        div.view-header
          ...
        div.view-content
          ...
    div.workspace-tab-header.tappable.mod-active.is-active[data-type="markdown"][aria-label="Alan Turing"]
      div.workspace-tab-header-inner
        div.workspace-tab-header-inner-icon
          ...
        div.workspace-tab-header-inner-title
        div.workspace-tab-header-status-container
        div.workspace-tab-header-inner-close-button[aria-label="Close"]
          ...
    div.workspace-leaf.mod-active
      hr.workspace-leaf-resize-handle.tappable
      div.workspace-leaf-content[data-type="markdown"]
        div.view-header
          ...
        div.view-content
          ...
    (div.workspace-tab-header.tappable x3)
    (div.workspace-leaf.is-hidden x2)
```

### Status bar

Root: `.status-bar`

```
div.status-bar
  div.status-bar-item.plugin-backlink.mod-clickable
  div.status-bar-item.plugin-properties.mod-clickable
  div.status-bar-item.plugin-editor-status.mod-clickable[aria-label="Live Preview"]
    span.status-bar-item-icon
      svg.svg-icon.lucide-edit-3
        ...
  div.status-bar-item.plugin-word-count
    span.status-bar-item-segment
    (span.status-bar-item-segment x2)
  div.status-bar-item.plugin-sync[aria-label="Uninitialized"]
    div.status-bar-item-segment
      span.status-bar-item-icon.sync-status-icon.mod-error
        ...
```

### Notice

Root: `.notice-container`

```
div.notice-container
  div.notice
    div.notice-message
```

## 5. Motion

Timing tokens (CSS variables): superfast 70ms, fast 140ms, moderate 300ms, slow 560ms. Easing tokens: smooth `cubic-bezier(0.45, 0.05, 0.55, 0.95)`, delay `cubic-bezier(0.65, 0.05, 0.36, 1)`, jumpy `cubic-bezier(0.68, -0.55, 0.27, 1.55)`, swing `cubic-bezier(0, 0.55, 0.45, 1)`.

Measured transitions (component: what animates, duration, easing):

| Component | Animates | Duration / easing |
|---|---|---|
| Buttons, dropdowns, text inputs | nothing (`--button-transition`, `--dropdown-transition`, `--input-transition` are `none`) | instant |
| Clickable icon SVG | opacity | fast (140ms) ease-in-out |
| Links (internal, external) | opacity | fast (140ms) ease-in-out |
| Toggle switch (`.checkbox-container`) | track: shadow, outline, border, opacity 150ms ease-in-out; knob: transform 150ms, size/position 100ms with 50ms delay | |
| Collapse chevrons (tree, callout fold) | rotate | 100ms ease-in-out |
| Settings nav rows | background, color | 150ms ease-in-out |
| Resize handle (split edges) | background, border, opacity | 200ms ease-in-out |
| Drop overlay while dragging tabs | all | 100ms ease-in-out |
| Tab header container | padding | 75ms ease-in-out |
| Workspace left padding (ribbon collapse) | padding-left | 100ms ease-in |
| Collapsed ribbon background | background-color | 250ms ease-in-out, 95ms delay |
| List bullet (fold state) | transform, shadow | 150ms |
| Range slider thumb | all | 100ms linear |
| Table widget row/col buttons (live preview) | opacity | 100ms |
| Embed hover actions (live preview) | opacity | 70ms ease-out |
| Canvas edge path | stroke width | 100ms ease-out |
| Canvas labels while animating zoom | transform | 500ms `cubic-bezier(0.16,1,0.3,1)` |
| Canvas card menu drag icon | transform | 90ms ease-out |
| Graph color group reorder | top | 200ms ease-in-out |
| Progress bar | transform 150ms; indeterminate bars loop 2s | |
| Text cursor blink | steps | 1.2s period |
| Spinner | rotate | 1s loop |
| Element "flash" (search jump highlight, `.is-flashing`) | color, background | 250ms |
| Sidebar open/close | width, animated by script (not CSS) | about 200ms (observed) |
| Modals, menus, tooltips, notices | appear instantly (no CSS transition measured) | |

Keyframe animations present: cursor blink, node-inserted (used to detect DOM insertion), spinners, progress bar, multi-select duplicate highlight (2s), pop-down / pop-right, slideIn (mobile drawer).

## 6. CSS variables (default theme, every one, both themes)

Read from `getComputedStyle(document.body)` for every custom property declared anywhere in the app's stylesheets. Values are as the browser reports them (some are unresolved `calc()` / `color-mix()` expressions; those are the variable's definition in terms of other variables, which Bedrock should reproduce the same way so themes that override the base variables cascade correctly). `'??'` in font variables is a placeholder that means "no user font set". Empty = not defined in that theme.

| Variable | Light | Dark |
|---|---|---|
| `--accent-h` | 258 | (same) |
| `--accent-l` | 66% | (same) |
| `--accent-s` | 88% | (same) |
| `--anim-duration-fast` | 140ms | (same) |
| `--anim-duration-moderate` | 300ms | (same) |
| `--anim-duration-none` | 0 | (same) |
| `--anim-duration-slow` | 560ms | (same) |
| `--anim-duration-superfast` | 70ms | (same) |
| `--anim-motion-delay` | cubic-bezier(0.65, 0.05, 0.36, 1) | (same) |
| `--anim-motion-jumpy` | cubic-bezier(0.68, -0.55, 0.27, 1.55) | (same) |
| `--anim-motion-smooth` | cubic-bezier(0.45, 0.05, 0.55, 0.95) | (same) |
| `--anim-motion-swing` | cubic-bezier(0, 0.55, 0.45, 1) | (same) |
| `--annotation-unfocused-field-background` |  | (same) |
| `--autoscroll-padding` |  | (same) |
| `--background-modifier-active-hover` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 10%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 10%, transparent) |
| `--background-modifier-border` | #e4e4e4 | #333333 |
| `--background-modifier-border-focus` | #bdbdbd | #555555 |
| `--background-modifier-border-hover` | #dadada | #3f3f3f |
| `--background-modifier-box-shadow` | rgba(0, 0, 0, 0.1) | rgba(0, 0, 0, 0.3) |
| `--background-modifier-cover` | rgba(220, 220, 220, 0.4) | rgba(10, 10, 10, 0.4) |
| `--background-modifier-error` | #e93147 | #fb464c |
| `--background-modifier-error-hover` | #e93147 | #fb464c |
| `--background-modifier-error-rgb` | 233, 49, 71 | 251, 70, 76 |
| `--background-modifier-form-field` | #ffffff | #2e2e2e |
| `--background-modifier-form-field-hover` | #ffffff | #2e2e2e |
| `--background-modifier-hover` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--background-modifier-message` | color-mix(in oklch, black 90%, transparent) | (same) |
| `--background-modifier-success` | #08b94e | #44cf6e |
| `--background-modifier-success-rgb` | 8, 185, 78 | 68, 207, 110 |
| `--background-modifier-warning` | #ec7500 | #e9973f |
| `--background-modifier-warning-hover` | #ec7500 | #e9973f |
| `--background-primary` | #ffffff | #1C1C1C |
| `--background-primary-alt` | #fafafa | #232323 |
| `--background-secondary` | #f6f6f6 | #282828 |
| `--background-secondary-alt` | #fcfcfc | #333333 |
| `--bases-cards-background` | #ffffff | #1C1C1C |
| `--bases-cards-border-width` | 1px | (same) |
| `--bases-cards-container-background` | transparent | (same) |
| `--bases-cards-corner-shape` | round | (same) |
| `--bases-cards-cover-background` | #fafafa | #232323 |
| `--bases-cards-font-size` | 0.875em | (same) |
| `--bases-cards-line-height` | 24px | (same) |
| `--bases-cards-radius` | 8px | (same) |
| `--bases-cards-scale` | 1 | (same) |
| `--bases-cards-shadow` | 0 0 0 1px #e4e4e4 | 0 0 0 1px #333333 |
| `--bases-cards-shadow-hover` | 0 0 0 1px #dadada | 0 0 0 1px #3f3f3f |
| `--bases-embed-border-color` | #e4e4e4 | #333333 |
| `--bases-embed-border-radius` | 4px | (same) |
| `--bases-embed-border-width` | 0px | (same) |
| `--bases-embed-height` |  | (same) |
| `--bases-embed-padding` |  | (same) |
| `--bases-embed-transform` |  | (same) |
| `--bases-embed-width` |  | (same) |
| `--bases-filter-input-background` | #ffffff | #2e2e2e |
| `--bases-filter-menu-width` | 520px | (same) |
| `--bases-group-heading-property-color` | #5c5c5c | #b3b3b3 |
| `--bases-group-heading-property-display` | block | (same) |
| `--bases-group-heading-property-size` | 12px | (same) |
| `--bases-group-heading-property-weight` | 400 | (same) |
| `--bases-group-heading-value-size` | 0.875em | (same) |
| `--bases-group-heading-value-weight` | 600 | (same) |
| `--bases-header-border-width` | 0 0 1px 0 | (same) |
| `--bases-header-height` | 40px | (same) |
| `--bases-header-padding-end` | 2px | (same) |
| `--bases-header-padding-start` | 2px | (same) |
| `--bases-kanban-card-background` | #ffffff | #1C1C1C |
| `--bases-kanban-card-corner-shape` | round | (same) |
| `--bases-kanban-card-radius` | 8px | (same) |
| `--bases-kanban-card-shadow` | 0 0 0 1px #e4e4e4, 0 1px 2px 0 rgba(0, 0, 0, 0.2) | 0 0 0 1px #333333, 0 1px 2px 0 rgba(0, 0, 0, 0.2) |
| `--bases-kanban-card-shadow-focus` | 0 0 0 2px #bdbdbd | 0 0 0 2px #555555 |
| `--bases-kanban-card-shadow-hover` | 0 0 0 1px #dadada, 0 1.5px 3px 0 rgba(0, 0, 0, 0.2) | 0 0 0 1px #3f3f3f, 0 1.5px 3px 0 rgba(0, 0, 0, 0.2) |
| `--bases-kanban-column-background` | #fafafa | #232323 |
| `--bases-kanban-column-box-shadow` | none | (same) |
| `--bases-kanban-column-header-background` | transparent | (same) |
| `--bases-kanban-column-radius` | 8px | (same) |
| `--bases-kanban-container-background` | transparent | (same) |
| `--bases-kanban-container-gap` | 8px | (same) |
| `--bases-kanban-container-padding` | 12px | (same) |
| `--bases-kanban-cover-background` | #f6f6f6 | #282828 |
| `--bases-kanban-line-height` | 24px | (same) |
| `--bases-property-menu-item-radius` |  | (same) |
| `--bases-table-border-color` | #e4e4e4 | #333333 |
| `--bases-table-cell-background-active` | #ffffff | #1C1C1C |
| `--bases-table-cell-background-disabled` | #fafafa | #232323 |
| `--bases-table-cell-background-selected` | color-mix(in oklch, hsl(258, 88%, 66%) 10%, transparent) | (same) |
| `--bases-table-cell-edge-padding` |  | (same) |
| `--bases-table-cell-radius-active` | 2px | (same) |
| `--bases-table-cell-radius-focus` | 2px | (same) |
| `--bases-table-cell-shadow-active` | 0 0 0 2px #bdbdbd | 0 0 0 2px #555555 |
| `--bases-table-cell-shadow-focus` | 0 0 0 2px hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | 0 0 0 2px hsl(258, 88%, 66%) |
| `--bases-table-column-border-width` | 1px | (same) |
| `--bases-table-column-max-width` | 300 | (same) |
| `--bases-table-column-min-width` | 40 | (same) |
| `--bases-table-container-border-radius` | 4px | (same) |
| `--bases-table-container-border-width` | 1px | (same) |
| `--bases-table-font-size` | 0.875em | (same) |
| `--bases-table-group-background` | #fafafa | #232323 |
| `--bases-table-group-gap` | 10px | (same) |
| `--bases-table-header-background` | #ffffff | #1C1C1C |
| `--bases-table-header-background-hover` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--bases-table-header-color` | #5c5c5c | #b3b3b3 |
| `--bases-table-header-icon-display` | flex | (same) |
| `--bases-table-header-sort-mask` | linear-gradient(to left, transparent 24px, black 24px) | (same) |
| `--bases-table-header-weight` | 400 | (same) |
| `--bases-table-row-background-hover` | transparent | (same) |
| `--bases-table-row-border-width` | 1px | (same) |
| `--bases-table-row-height` | 30px | (same) |
| `--bases-table-summary-background` | #ffffff | #1C1C1C |
| `--bases-table-summary-background-hover` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--bases-toolbar-badge-display` | none | (same) |
| `--bases-toolbar-label-display` | block | (same) |
| `--bases-view-padding` |  | (same) |
| `--blockquote-background-color` | transparent | (same) |
| `--blockquote-border-color` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--blockquote-border-thickness` | 2px | (same) |
| `--blockquote-color` |  | (same) |
| `--blockquote-font-style` | normal | (same) |
| `--blur-background` | color-mix(in srgb, #ffffff 65%, transparent) linear-gradient(#ffffff, color-mix(in srgb, #ffffff 65%, transparent)) | color-mix(in srgb, #333333 65%, transparent) linear-gradient(#333333, color-mix(in srgb, #333333 65%, transparent)) |
| `--blur-brightness` | 1.15 | (same) |
| `--blur-l` | blur(16px) saturate(1.5) brightness(1.15) | (same) |
| `--blur-m` | blur(10px) saturate(1.5) brightness(1.15) | (same) |
| `--blur-opacity-m` | 90% | (same) |
| `--blur-opacity-s` | 65% | (same) |
| `--blur-radius-l` | 16px | (same) |
| `--blur-radius-m` | 10px | (same) |
| `--blur-radius-s` | 6px | (same) |
| `--blur-s` | blur(6px) saturate(1.5) brightness(1.15) | (same) |
| `--blur-saturation` | 1.5 | (same) |
| `--bold-color` |  | (same) |
| `--bold-modifier` | 200 | (same) |
| `--bold-weight` | calc(400 + 200) | (same) |
| `--border-width` | 1px | (same) |
| `--button-corner-shape` | round | (same) |
| `--button-disabled-opacity` |  | (same) |
| `--button-primary-active-bg-color` |  | (same) |
| `--button-primary-active-border-color` |  | (same) |
| `--button-primary-active-fg-color` |  | (same) |
| `--button-primary-bg-color` |  | (same) |
| `--button-primary-border-color` |  | (same) |
| `--button-primary-disabled-bg-color` |  | (same) |
| `--button-primary-disabled-border-color` |  | (same) |
| `--button-primary-disabled-fg-color` |  | (same) |
| `--button-primary-fg-color` |  | (same) |
| `--button-primary-hover-bg-color` |  | (same) |
| `--button-primary-hover-border-color` |  | (same) |
| `--button-primary-hover-fg-color` |  | (same) |
| `--button-radius` | 5px | (same) |
| `--button-secondary-active-bg-color` |  | (same) |
| `--button-secondary-active-border-color` |  | (same) |
| `--button-secondary-active-fg-color` |  | (same) |
| `--button-secondary-bg-color` |  | (same) |
| `--button-secondary-border-color` |  | (same) |
| `--button-secondary-disabled-bg-color` |  | (same) |
| `--button-secondary-disabled-border-color` |  | (same) |
| `--button-secondary-disabled-fg-color` |  | (same) |
| `--button-secondary-fg-color` |  | (same) |
| `--button-secondary-hover-bg-color` |  | (same) |
| `--button-secondary-hover-border-color` |  | (same) |
| `--button-secondary-hover-fg-color` |  | (same) |
| `--button-transition` | none | (same) |
| `--callout-blend-mode` | darken | lighten |
| `--callout-border-opacity` | 0.25 | (same) |
| `--callout-border-width` | 0px | (same) |
| `--callout-bug` | #e93147 | #fb464c |
| `--callout-color` |  | (same) |
| `--callout-content-background` | transparent | (same) |
| `--callout-content-padding` | 0 | (same) |
| `--callout-default` | #086ddd | #027aff |
| `--callout-error` | #e93147 | #fb464c |
| `--callout-example` | #7852ee | #a882ff |
| `--callout-fail` | #e93147 | #fb464c |
| `--callout-icon` |  | (same) |
| `--callout-important` | #00bfbc | #53dfdd |
| `--callout-info` | #086ddd | #027aff |
| `--callout-padding` | 12px 12px 12px 24px | (same) |
| `--callout-question` | #ec7500 | #e9973f |
| `--callout-quote` | #9e9e9e | (same) |
| `--callout-radius` | 4px | (same) |
| `--callout-success` | #08b94e | #44cf6e |
| `--callout-summary` | #00bfbc | #53dfdd |
| `--callout-tip` | #00bfbc | #53dfdd |
| `--callout-title-color` |  | (same) |
| `--callout-title-padding` | 0 | (same) |
| `--callout-title-size` |  | (same) |
| `--callout-title-weight` | calc(400 + 200) | (same) |
| `--callout-todo` | #086ddd | #027aff |
| `--callout-warning` | #ec7500 | #e9973f |
| `--canvas-background` | #ffffff | #1C1C1C |
| `--canvas-card-label-color` | #ababab | #666666 |
| `--canvas-color` | #c0c0c0 | #7e7e7e |
| `--canvas-color-1` | #e93147 | #fb464c |
| `--canvas-color-2` | #ec7500 | #e9973f |
| `--canvas-color-3` | #e0ac00 | #e0de71 |
| `--canvas-color-4` | #08b94e | #44cf6e |
| `--canvas-color-5` | #00bfbc | #53dfdd |
| `--canvas-color-6` | #7852ee | #a882ff |
| `--canvas-controls-icon-size` | 16px | (same) |
| `--canvas-controls-icon-stroke` | 2px | (same) |
| `--canvas-controls-radius` | 4px | (same) |
| `--canvas-dot-pattern` | #e4e4e4 | #333333 |
| `--caret-color` | #222222 | #dadada |
| `--checkbox-border-color` | #ababab | #666666 |
| `--checkbox-border-color-hover` | #5c5c5c | #b3b3b3 |
| `--checkbox-color` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--checkbox-color-hover` | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) | (same) |
| `--checkbox-margin-inline-start` | 0.85em | (same) |
| `--checkbox-marker-color` | #ffffff | #1C1C1C |
| `--checkbox-radius` | 4px | (same) |
| `--checkbox-size` | 16px | (same) |
| `--checklist-done-color` | #5c5c5c | #b3b3b3 |
| `--checklist-done-decoration` | line-through | (same) |
| `--clickable-icon-radius` | 4px | (same) |
| `--code-background` | #fafafa | #232323 |
| `--code-border-color` | #e4e4e4 | #333333 |
| `--code-border-width` | 0px | (same) |
| `--code-bracket-background` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--code-comment` | #ababab | #666666 |
| `--code-function` | #e0ac00 | #e0de71 |
| `--code-important` | #ec7500 | #e9973f |
| `--code-keyword` | #d53984 | #fa99cd |
| `--code-normal` | #222222 | #dadada |
| `--code-operator` | #e93147 | #fb464c |
| `--code-property` | #00bfbc | #53dfdd |
| `--code-punctuation` | #5c5c5c | #b3b3b3 |
| `--code-radius` | 4px | (same) |
| `--code-size` | 0.875em | (same) |
| `--code-string` | #08b94e | #44cf6e |
| `--code-tag` | #e93147 | #fb464c |
| `--code-value` | #7852ee | #a882ff |
| `--code-white-space` | pre-wrap | (same) |
| `--collapse-icon-color` | #ababab | #666666 |
| `--collapse-icon-color-collapsed` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--color-accent` | hsl(258, 88%, 66%) | (same) |
| `--color-accent-1` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--color-accent-2` | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) | hsl(calc(258 - 5), calc(88% * 1.05), calc(66% * 1.29)) |
| `--color-accent-hsl` | 258, 88%, 66% | (same) |
| `--color-base-00` | #ffffff | #1C1C1C |
| `--color-base-05` | #fcfcfc | #212121 |
| `--color-base-10` | #fafafa | #232323 |
| `--color-base-100` | #222222 | #dadada |
| `--color-base-20` | #f6f6f6 | #282828 |
| `--color-base-25` | #efefef | #2e2e2e |
| `--color-base-30` | #e4e4e4 | #333333 |
| `--color-base-35` | #dadada | #3f3f3f |
| `--color-base-40` | #bdbdbd | #555555 |
| `--color-base-50` | #ababab | #666666 |
| `--color-base-60` | #707070 | #999999 |
| `--color-base-70` | #5c5c5c | #b3b3b3 |
| `--color-blue` | #086ddd | #027aff |
| `--color-blue-rgb` | 8, 109, 221 | 2, 122, 255 |
| `--color-cyan` | #00bfbc | #53dfdd |
| `--color-cyan-rgb` | 0, 191, 188 | 83, 223, 221 |
| `--color-green` | #08b94e | #44cf6e |
| `--color-green-rgb` | 8, 185, 78 | 68, 207, 110 |
| `--color-orange` | #ec7500 | #e9973f |
| `--color-orange-rgb` | 236, 117, 0 | 233, 151, 63 |
| `--color-pink` | #d53984 | #fa99cd |
| `--color-pink-rgb` | 213, 57, 132 | 250, 153, 205 |
| `--color-purple` | #7852ee | #a882ff |
| `--color-purple-rgb` | 120, 82, 238 | 168, 130, 255 |
| `--color-red` | #e93147 | #fb464c |
| `--color-red-rgb` | 233, 49, 71 | 251, 70, 76 |
| `--color-secondary-2` |  | color-mix(in srgb, #282828 96%, white 4%) |
| `--color-secondary-3` |  | color-mix(in srgb, #282828 92%, white 8%) |
| `--color-secondary-4` |  | color-mix(in srgb, #282828 90%, white 10%) |
| `--color-secondary-5` |  | color-mix(in srgb, #282828 84%, white 16%) |
| `--color-secondary-6` |  | color-mix(in srgb, #282828 76%, white 24%) |
| `--color-yellow` | #e0ac00 | #e0de71 |
| `--color-yellow-rgb` | 224, 172, 0 | 224, 222, 113 |
| `--content-height` |  | (same) |
| `--corner-shape` | round | (same) |
| `--csstools-color-scheme--dark` |  | (same) |
| `--csstools-light-dark-toggle--0` |  | (same) |
| `--csstools-light-dark-toggle--1` |  | (same) |
| `--csstools-light-dark-toggle--10` |  | (same) |
| `--csstools-light-dark-toggle--11` |  | (same) |
| `--csstools-light-dark-toggle--12` |  | (same) |
| `--csstools-light-dark-toggle--13` |  | (same) |
| `--csstools-light-dark-toggle--14` |  | (same) |
| `--csstools-light-dark-toggle--15` |  | (same) |
| `--csstools-light-dark-toggle--16` |  | (same) |
| `--csstools-light-dark-toggle--17` |  | (same) |
| `--csstools-light-dark-toggle--18` |  | (same) |
| `--csstools-light-dark-toggle--19` |  | (same) |
| `--csstools-light-dark-toggle--2` |  | (same) |
| `--csstools-light-dark-toggle--20` |  | (same) |
| `--csstools-light-dark-toggle--21` |  | (same) |
| `--csstools-light-dark-toggle--22` |  | (same) |
| `--csstools-light-dark-toggle--23` |  | (same) |
| `--csstools-light-dark-toggle--24` |  | (same) |
| `--csstools-light-dark-toggle--25` |  | (same) |
| `--csstools-light-dark-toggle--26` |  | (same) |
| `--csstools-light-dark-toggle--27` |  | (same) |
| `--csstools-light-dark-toggle--28` |  | (same) |
| `--csstools-light-dark-toggle--29` |  | (same) |
| `--csstools-light-dark-toggle--3` |  | (same) |
| `--csstools-light-dark-toggle--30` |  | (same) |
| `--csstools-light-dark-toggle--31` |  | (same) |
| `--csstools-light-dark-toggle--32` |  | (same) |
| `--csstools-light-dark-toggle--33` |  | (same) |
| `--csstools-light-dark-toggle--34` |  | (same) |
| `--csstools-light-dark-toggle--35` |  | (same) |
| `--csstools-light-dark-toggle--36` |  | (same) |
| `--csstools-light-dark-toggle--37` |  | (same) |
| `--csstools-light-dark-toggle--38` |  | (same) |
| `--csstools-light-dark-toggle--39` |  | (same) |
| `--csstools-light-dark-toggle--4` |  | (same) |
| `--csstools-light-dark-toggle--40` |  | (same) |
| `--csstools-light-dark-toggle--41` |  | (same) |
| `--csstools-light-dark-toggle--5` |  | (same) |
| `--csstools-light-dark-toggle--6` |  | (same) |
| `--csstools-light-dark-toggle--7` |  | (same) |
| `--csstools-light-dark-toggle--8` |  | (same) |
| `--csstools-light-dark-toggle--9` |  | (same) |
| `--cursor` | default | (same) |
| `--cursor-link` | pointer | (same) |
| `--dialog-bg-color` |  | (same) |
| `--dialog-border-color` |  | (same) |
| `--dialog-max-height` | 85vh | (same) |
| `--dialog-max-width` | 80vw | (same) |
| `--dialog-shadow` |  | (same) |
| `--dialog-width` | 560px | (same) |
| `--direction` | 1 | (same) |
| `--divider-color` | #e4e4e4 | #333333 |
| `--divider-color-hover` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--divider-vertical-height` | 100% | (same) |
| `--divider-width` | 1px | (same) |
| `--divider-width-hover` | 3px | (same) |
| `--drag-ghost-background` | rgba(0, 0, 0, 0.85) | (same) |
| `--drag-ghost-text-color` | #fff | (same) |
| `--drag-item-background` | #ffffff | #1C1C1C |
| `--drag-item-shadow` | 0 2px 8px rgba(0, 0, 0, 0.1) | 0 2px 8px rgba(0, 0, 0, 0.3) |
| `--dropdown-background` | #ffffff | #333333 |
| `--dropdown-background-blend-mode` | hard-light, normal | (same) |
| `--dropdown-background-hover` | #fafafa | #3f3f3f |
| `--dropdown-background-position` | right 0.65em top 50%, right 0.15em top 50%, 0 0 | (same) |
| `--dropdown-background-size` | 1em auto, 2em 2em, 100% | (same) |
| `--dropdown-icon-background` | transparent | (same) |
| `--dropdown-icon-inset` | 0.65em | (same) |
| `--dropdown-icon-width` | 1em | (same) |
| `--dropdown-padding` | 0 2.4em 0 0.8em | (same) |
| `--dropdown-padding-end` | 2.4em | (same) |
| `--dropdown-padding-start` | 0.8em | (same) |
| `--dropdown-text-align` | start | (same) |
| `--dropdown-transition` | none | (same) |
| `--embed-action-color` | #222222 | #dadada |
| `--embed-action-radius` | 4px | (same) |
| `--embed-actions-background` | color-mix(in srgb, #ffffff 80%, transparent) | color-mix(in srgb, #1C1C1C 80%, transparent) |
| `--embed-actions-blur` | blur(6px) saturate(1.5) brightness(1.15) | (same) |
| `--embed-actions-corner-shape` | round | (same) |
| `--embed-actions-padding` | 2px | (same) |
| `--embed-actions-radius` | calc(4px + 2px) | (same) |
| `--embed-actions-shadow` | 0 1px 2px 0 rgba(0, 0, 0, 0.05), 0 0 6px 0 rgba(0, 0, 0, 0.05) | (same) |
| `--embed-background` |  | (same) |
| `--embed-block-shadow-hover` | 0 0 0 1px #e4e4e4, inset 0 0 0 1px #e4e4e4 | 0 0 0 1px #333333, inset 0 0 0 1px #333333 |
| `--embed-border-bottom` | none | (same) |
| `--embed-border-end` | none | (same) |
| `--embed-border-start` | 2px solid hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | 2px solid hsl(258, 88%, 66%) |
| `--embed-border-top` | none | (same) |
| `--embed-canvas-max-height` | 400px | (same) |
| `--embed-font-style` |  | (same) |
| `--embed-max-height` | 4000px | (same) |
| `--embed-padding` | 0 0 0 24px | (same) |
| `--file-folding-offset` | 24px | (same) |
| `--file-header-background` | #ffffff | #1C1C1C |
| `--file-header-background-focused` | #ffffff | #1C1C1C |
| `--file-header-border` | 1px solid transparent | (same) |
| `--file-header-font` | '??', '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--file-header-font-size` | 13px | (same) |
| `--file-header-font-weight` | 400 | (same) |
| `--file-header-justify` | start | (same) |
| `--file-line-width` | 700px | (same) |
| `--file-margins` | 32px 32px | (same) |
| `--file-margins-x` | 32px | (same) |
| `--file-margins-y` | 32px | (same) |
| `--flair-background` | #ffffff | #333333 |
| `--flair-color` | #222222 | #dadada |
| `--focus-ring-color` | #0df | (same) |
| `--focus-ring-outline` | 2px solid light-dark(#0060df, #0df) | (same) |
| `--font-black` | 900 | (same) |
| `--font-bold` | 700 | (same) |
| `--font-default` | ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--font-extrabold` | 800 | (same) |
| `--font-extralight` | 200 | (same) |
| `--font-interface` | '??', '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--font-interface-override` | '??' | (same) |
| `--font-interface-theme` | '??' | (same) |
| `--font-light` | 300 | (same) |
| `--font-medium` | 500 | (same) |
| `--font-mermaid` | '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--font-monospace` | '??', '??', ui-monospace, SFMono-Regular, "Cascadia Mono", "Roboto Mono", "DejaVu Sans Mono", "Liberation Mono", Menlo, Monaco, "Consolas", "Source Code Pro", monospace | (same) |
| `--font-monospace-default` | ui-monospace, SFMono-Regular, "Cascadia Mono", "Roboto Mono", "DejaVu Sans Mono", "Liberation Mono", Menlo, Monaco, "Consolas", "Source Code Pro", monospace | (same) |
| `--font-monospace-override` | '??' | (same) |
| `--font-monospace-theme` | '??' | (same) |
| `--font-normal` | 400 | (same) |
| `--font-preferred-size` | 16px | (same) |
| `--font-print` | '??', '??', '??', 'Arial' | (same) |
| `--font-print-override` | '??' | (same) |
| `--font-semibold` | 600 | (same) |
| `--font-small` | 0.933em | (same) |
| `--font-smaller` | 0.875em | (same) |
| `--font-smallest` | 0.8em | (same) |
| `--font-text` | '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--font-text-override` | '??' | (same) |
| `--font-text-size` | 16px | (same) |
| `--font-text-theme` | '??' | (same) |
| `--font-thin` | 100 | (same) |
| `--font-ui-large` | 20px | (same) |
| `--font-ui-medium` | 15px | (same) |
| `--font-ui-small` | 13px | (same) |
| `--font-ui-smaller` | 12px | (same) |
| `--font-weight` | 400 | (same) |
| `--footnote-divider-color` | #e4e4e4 | #333333 |
| `--footnote-divider-color-active` | transparent | (same) |
| `--footnote-divider-width` | 1px | (same) |
| `--footnote-gap` | 4px | (same) |
| `--footnote-id-color` | #5c5c5c | #b3b3b3 |
| `--footnote-id-color-no-occurrences` | #ababab | #666666 |
| `--footnote-id-delimiter` | "." | (same) |
| `--footnote-input-background` | transparent | (same) |
| `--footnote-input-background-active` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--footnote-line-height` | 1.5 | (same) |
| `--footnote-padding-block` | 6px | (same) |
| `--footnote-padding-inline` | 6px | (same) |
| `--footnote-radius` | 4px | (same) |
| `--footnote-size` | 0.875em | (same) |
| `--frame-left-space` | 0px | (same) |
| `--frame-ribbon-left` | 44px | (same) |
| `--frame-ribbon-right` | 0px | (same) |
| `--frame-right-space` | calc(126px - 0px) | (same) |
| `--graph-controls-width` | 240px | (same) |
| `--graph-line` | #dadada | #3f3f3f |
| `--graph-node` | #5c5c5c | #b3b3b3 |
| `--graph-node-attachment` | #e0ac00 | #e0de71 |
| `--graph-node-focused` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--graph-node-tag` | #08b94e | #44cf6e |
| `--graph-node-unresolved` | #ababab | #666666 |
| `--graph-text` | #222222 | #dadada |
| `--h1-color` |  | (same) |
| `--h1-font` |  | (same) |
| `--h1-letter-spacing` | -0.015em | (same) |
| `--h1-line-height` | 1.2 | (same) |
| `--h1-size` | 1.618em | (same) |
| `--h1-style` | normal | (same) |
| `--h1-variant` | normal | (same) |
| `--h1-weight` | 700 | (same) |
| `--h2-color` |  | (same) |
| `--h2-font` |  | (same) |
| `--h2-letter-spacing` | -0.011em | (same) |
| `--h2-line-height` | 1.2 | (same) |
| `--h2-size` | 1.462em | (same) |
| `--h2-style` | normal | (same) |
| `--h2-variant` | normal | (same) |
| `--h2-weight` | 680 | (same) |
| `--h3-color` |  | (same) |
| `--h3-font` |  | (same) |
| `--h3-letter-spacing` | -0.008em | (same) |
| `--h3-line-height` | 1.3 | (same) |
| `--h3-size` | 1.318em | (same) |
| `--h3-style` | normal | (same) |
| `--h3-variant` | normal | (same) |
| `--h3-weight` | 660 | (same) |
| `--h4-color` |  | (same) |
| `--h4-font` |  | (same) |
| `--h4-letter-spacing` | -0.005em | (same) |
| `--h4-line-height` | 1.4 | (same) |
| `--h4-size` | 1.188em | (same) |
| `--h4-style` | normal | (same) |
| `--h4-variant` | normal | (same) |
| `--h4-weight` | 640 | (same) |
| `--h5-color` |  | (same) |
| `--h5-font` |  | (same) |
| `--h5-letter-spacing` | -0.002em | (same) |
| `--h5-line-height` | 1.5 | (same) |
| `--h5-size` | 1.076em | (same) |
| `--h5-style` | normal | (same) |
| `--h5-variant` | normal | (same) |
| `--h5-weight` | 620 | (same) |
| `--h6-color` |  | (same) |
| `--h6-font` |  | (same) |
| `--h6-letter-spacing` | 0em | (same) |
| `--h6-line-height` | 1.5 | (same) |
| `--h6-size` | 1em | (same) |
| `--h6-style` | normal | (same) |
| `--h6-variant` | normal | (same) |
| `--h6-weight` | 600 | (same) |
| `--hcm-highlight-filter` |  | (same) |
| `--hcm-highlight-selected-filter` |  | (same) |
| `--header-height` | 40px | (same) |
| `--heading-formatting` | #ababab | #666666 |
| `--heading-spacing` | calc(1rem * 2.5) | (same) |
| `--hidden-nav-navbar-transform` |  | (same) |
| `--hidden-nav-offset` |  | (same) |
| `--highlight-backdrop-filter` |  | (same) |
| `--highlight-background` | color-mix(in oklch, #e0ac00 30%, transparent) | color-mix(in oklch, #e0de71 30%, transparent) |
| `--highlight-background-blue` | color-mix(in oklch, #086ddd 30%, transparent) | color-mix(in oklch, #027aff 30%, transparent) |
| `--highlight-background-green` | color-mix(in oklch, #08b94e 30%, transparent) | color-mix(in oklch, #44cf6e 30%, transparent) |
| `--highlight-background-orange` | color-mix(in oklch, #ec7500 30%, transparent) | color-mix(in oklch, #e9973f 30%, transparent) |
| `--highlight-background-purple` | color-mix(in oklch, #7852ee 30%, transparent) | color-mix(in oklch, #a882ff 30%, transparent) |
| `--highlight-background-red` | color-mix(in oklch, #e93147 30%, transparent) | color-mix(in oklch, #fb464c 30%, transparent) |
| `--highlight-background-yellow` | color-mix(in oklch, #e0ac00 30%, transparent) | color-mix(in oklch, #e0de71 30%, transparent) |
| `--highlight-bg-color` |  | (same) |
| `--highlight-mix-blend-mode` | darken | lighten |
| `--highlight-opacity` | 30% | (same) |
| `--highlight-selected-backdrop-filter` |  | (same) |
| `--highlight-selected-bg-color` |  | (same) |
| `--hotkey-background` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--hotkey-corner-shape` | round | (same) |
| `--hotkey-font` | '??', '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--hotkey-font-size` | 12px | (same) |
| `--hotkey-radius` | 2em | (same) |
| `--hover-filter` |  | (same) |
| `--hr-color` | #e4e4e4 | #333333 |
| `--hr-thickness` | 2px | (same) |
| `--icon-color` | #5c5c5c | #b3b3b3 |
| `--icon-color-active` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--icon-color-focus` |  | (same) |
| `--icon-color-focused` | #222222 | #dadada |
| `--icon-color-hover` | #5c5c5c | #b3b3b3 |
| `--icon-l` | 18px | (same) |
| `--icon-l-stroke-width` | 1.75px | (same) |
| `--icon-m` | 16px | (same) |
| `--icon-m-stroke-width` | 2px | (same) |
| `--icon-opacity` | 0.85 | (same) |
| `--icon-opacity-active` | 1 | (same) |
| `--icon-opacity-hover` | 1 | (same) |
| `--icon-s` | 16px | (same) |
| `--icon-s-stroke-width` | 2px | (same) |
| `--icon-size` | 16px | (same) |
| `--icon-stroke` | 2px | (same) |
| `--icon-xl` | 32px | (same) |
| `--icon-xl-stroke-width` | 1.25px | (same) |
| `--icon-xs` | 14px | (same) |
| `--icon-xs-stroke-width` | 2px | (same) |
| `--image-radius` | 4px | (same) |
| `--indent-size` | 4 | (same) |
| `--indent-unit` | 0.5625em | (same) |
| `--indentation-guide-color` | color-mix(in oklch, black 12%, transparent) | color-mix(in oklch, white 12%, transparent) |
| `--indentation-guide-color-active` | color-mix(in oklch, black 30%, transparent) | color-mix(in oklch, white 30%, transparent) |
| `--indentation-guide-editing-indent` | 0.85em | (same) |
| `--indentation-guide-reading-indent` | -0.85em | (same) |
| `--indentation-guide-source-indent` | 0.25em | (same) |
| `--indentation-guide-width` | 1px | (same) |
| `--indentation-guide-width-active` | 1px | (same) |
| `--inline-title-color` |  | (same) |
| `--inline-title-font` |  | (same) |
| `--inline-title-line-height` | 1.2 | (same) |
| `--inline-title-margin-bottom` | 0.5em | (same) |
| `--inline-title-size` | 1.618em | (same) |
| `--inline-title-style` | normal | (same) |
| `--inline-title-variant` | normal | (same) |
| `--inline-title-weight` | 700 | (same) |
| `--input-border-width` | 1px | (same) |
| `--input-border-width-focus` | 2px | (same) |
| `--input-corner-shape` | round | (same) |
| `--input-date-separator` | #ababab | #666666 |
| `--input-disabled-border-color` |  | (same) |
| `--input-focus-border-color` |  | (same) |
| `--input-focus-outline` |  | (same) |
| `--input-font-weight` | 400 | (same) |
| `--input-height` | 30px | (same) |
| `--input-hover-border-color` |  | (same) |
| `--input-icon-inset` | 4px | (same) |
| `--input-padding` | 4px 8px | (same) |
| `--input-placeholder-color` | #ababab | #666666 |
| `--input-radius` | 5px | (same) |
| `--input-shadow` | inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.065), 0 0 0 0 transparent | inset 0 0.5px 0.5px 0.5px rgba(255, 255, 255, 0.09), 0 2px 4px 0 rgba(0, 0, 0, 0.15), 0 1px 1.5px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.2), 0 0 0 0 transparent |
| `--input-shadow-hover` | inset 0 0 0 1px rgba(0, 0, 0, 0.17), 0 1px 2px 0 rgba(0, 0, 0, 0.1), 0 0 0 0 transparent | inset 0 0.5px 1px 0.5px rgba(255, 255, 255, 0.16), 0 2px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 1.5px 0 rgba(0, 0, 0, 0.2), 0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 0 0 0 transparent |
| `--input-text-bg-color` |  | (same) |
| `--input-text-fg-color` |  | (same) |
| `--input-transition` | none | (same) |
| `--input-unfocused-border-color` |  | (same) |
| `--inset-end` | right | (same) |
| `--inset-start` | left | (same) |
| `--interactive-accent` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--interactive-accent-hover` | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) | (same) |
| `--interactive-accent-hsl` | 258, 88%, 66% | (same) |
| `--interactive-hover` | #fafafa | #3f3f3f |
| `--interactive-normal` | #ffffff | #333333 |
| `--italic-color` |  | (same) |
| `--italic-weight` |  | (same) |
| `--keyboard-background` |  | (same) |
| `--keyboard-height` | 0px | (same) |
| `--layer-cover` | 5 | (same) |
| `--layer-dragged-item` | 80 | (same) |
| `--layer-menu` | 65 | (same) |
| `--layer-modal` | 50 | (same) |
| `--layer-notice` | 60 | (same) |
| `--layer-popover` | 30 | (same) |
| `--layer-sidedock` | 10 | (same) |
| `--layer-slides` | 45 | (same) |
| `--layer-status-bar` | 15 | (same) |
| `--layer-tooltip` | 70 | (same) |
| `--lightbox-background` | black | (same) |
| `--lightbox-close-size` |  | (same) |
| `--lightbox-close-top` |  | (same) |
| `--lightbox-titlebar-color` | white | (same) |
| `--lightbox-titlebar-display` | flex | (same) |
| `--line-height-normal` | 1.5 | (same) |
| `--line-height-tight` | 1.3 | (same) |
| `--link-color` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--link-color-hover` | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) | hsl(calc(258 - 5), calc(88% * 1.05), calc(66% * 1.29)) |
| `--link-decoration` | underline | (same) |
| `--link-decoration-hover` | underline | (same) |
| `--link-decoration-thickness` | auto | (same) |
| `--link-external-color` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--link-external-color-hover` | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) | hsl(calc(258 - 5), calc(88% * 1.05), calc(66% * 1.29)) |
| `--link-external-decoration` | underline | (same) |
| `--link-external-decoration-hover` | underline | (same) |
| `--link-external-filter` | none | (same) |
| `--link-fg-color` |  | (same) |
| `--link-hover-fg-color` |  | (same) |
| `--link-outline` |  | (same) |
| `--link-unresolved-color` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--link-unresolved-decoration-color` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 30%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 30%, transparent) |
| `--link-unresolved-decoration-style` | solid | (same) |
| `--link-unresolved-filter` | none | (same) |
| `--link-unresolved-opacity` | 0.7 | (same) |
| `--link-weight` | 400 | (same) |
| `--list-bullet-border` | none | (same) |
| `--list-bullet-end-padding` | 1.3rem | (same) |
| `--list-bullet-radius` | 50% | (same) |
| `--list-bullet-size` | 0.3em | (same) |
| `--list-bullet-transform` | none | (same) |
| `--list-indent` | calc(0.5625em * 4) | (same) |
| `--list-indent-editing` | 0.75em | (same) |
| `--list-indent-source` | 0 | (same) |
| `--list-marker-color` | #ababab | #666666 |
| `--list-marker-color-collapsed` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--list-marker-color-hover` | #5c5c5c | #b3b3b3 |
| `--list-marker-space` |  | (same) |
| `--list-numbered-style` | decimal | (same) |
| `--list-padding-inline-start` |  | (same) |
| `--list-spacing` | 0.075em | (same) |
| `--loading-icon-delay` | 400ms | (same) |
| `--menu-backdrop-filter` | none | (same) |
| `--menu-background` | #f6f6f6 | #282828 |
| `--menu-border-color` | #dadada | #3f3f3f |
| `--menu-border-width` | 1px | (same) |
| `--menu-corner-shape` | round | (same) |
| `--menu-divider-color` |  | (same) |
| `--menu-divider-width` |  | (same) |
| `--menu-padding` | 6px | (same) |
| `--menu-radius` | 8px | (same) |
| `--menu-scroll-mask` | linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 24px) | (same) |
| `--menu-shadow` | 0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07) | 0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3) |
| `--message-bar-bg-color` |  | (same) |
| `--message-bar-border-color` |  | (same) |
| `--message-bar-close-button-active-bg-color` |  | (same) |
| `--message-bar-close-button-border` |  | (same) |
| `--message-bar-close-button-border-radius` |  | (same) |
| `--message-bar-close-button-color` |  | (same) |
| `--message-bar-close-button-color-hover` |  | (same) |
| `--message-bar-close-button-focus-bg-color` |  | (same) |
| `--message-bar-close-button-hover-bg-color` |  | (same) |
| `--message-bar-fg-color` |  | (same) |
| `--message-bar-icon-color` |  | (same) |
| `--metadata-background` | transparent | (same) |
| `--metadata-border-color` | #e4e4e4 | #333333 |
| `--metadata-border-radius` | 0 | (same) |
| `--metadata-border-width` | 0 | (same) |
| `--metadata-display-editing` | block | (same) |
| `--metadata-display-reading` | block | (same) |
| `--metadata-divider-color` | #e4e4e4 | #333333 |
| `--metadata-divider-color-focus` | transparent | (same) |
| `--metadata-divider-color-hover` | transparent | (same) |
| `--metadata-divider-width` | 0 | (same) |
| `--metadata-gap` | 3px | (same) |
| `--metadata-input-background` | transparent | (same) |
| `--metadata-input-background-active` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--metadata-input-background-hover` | transparent | (same) |
| `--metadata-input-font` | '??', '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--metadata-input-font-size` | 0.875em | (same) |
| `--metadata-input-height` | calc(16px * 1.75) | (same) |
| `--metadata-input-longtext-lines` | 3 | (same) |
| `--metadata-input-padding` | 4px 8px | (same) |
| `--metadata-input-text-color` | #222222 | #dadada |
| `--metadata-label-background` | transparent | (same) |
| `--metadata-label-background-active` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--metadata-label-background-hover` | transparent | (same) |
| `--metadata-label-font` | '??', '??', '??', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif | (same) |
| `--metadata-label-font-size` | 0.875em | (same) |
| `--metadata-label-font-weight` |  | (same) |
| `--metadata-label-text-color` | #5c5c5c | #b3b3b3 |
| `--metadata-label-text-color-hover` | #5c5c5c | #b3b3b3 |
| `--metadata-label-width` | 9em | (same) |
| `--metadata-max-width` | none | (same) |
| `--metadata-padding` | 8px 0 | (same) |
| `--metadata-property-background` | transparent | (same) |
| `--metadata-property-background-active` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--metadata-property-background-hover` | transparent | (same) |
| `--metadata-property-box-shadow` |  | (same) |
| `--metadata-property-box-shadow-focus` | 0 0 0 2px #bdbdbd | 0 0 0 2px #555555 |
| `--metadata-property-box-shadow-hover` | 0 0 0 1px #dadada | 0 0 0 1px #3f3f3f |
| `--metadata-property-corner-shape` | round | (same) |
| `--metadata-property-corner-shape-focus` | round | (same) |
| `--metadata-property-corner-shape-hover` | round | (same) |
| `--metadata-property-padding` | 0 | (same) |
| `--metadata-property-radius` | 6px | (same) |
| `--metadata-property-radius-focus` | 6px | (same) |
| `--metadata-property-radius-hover` | 6px | (same) |
| `--metadata-sidebar-input-font-size` | 13px | (same) |
| `--metadata-sidebar-label-font-size` | 13px | (same) |
| `--mobile-sidebar-background` |  | (same) |
| `--mobile-sidebar-max-width` |  | (same) |
| `--mobile-sidebar-min-width` |  | (same) |
| `--mobile-sidebar-radius` |  | (same) |
| `--mobile-sidebar-width` |  | (same) |
| `--mobile-sidebar-width-pinned` |  | (same) |
| `--mobile-toolbar-height` |  | (same) |
| `--modal-background` | #ffffff | #1C1C1C |
| `--modal-border-color` | #dadada | #3f3f3f |
| `--modal-border-width` | 1px | (same) |
| `--modal-community-sidebar-width` | 280px | (same) |
| `--modal-header-height` | auto | (same) |
| `--modal-header-inset-top` |  | (same) |
| `--modal-height` | 85vh | (same) |
| `--modal-max-height` | 1000px | (same) |
| `--modal-max-width` | 1100px | (same) |
| `--modal-max-width-narrow` | 800px | (same) |
| `--modal-radius` | 12px | (same) |
| `--modal-shadow` | none | (same) |
| `--modal-sidebar-background` | #ffffff | #1C1C1C |
| `--modal-sidebar-inset` |  | (same) |
| `--modal-width` | 90vw | (same) |
| `--mono-0` | white | black |
| `--mono-100` | black | white |
| `--mono-rgb-0` | 255, 255, 255 | 0, 0, 0 |
| `--mono-rgb-100` | 0, 0, 0 | 255, 255, 255 |
| `--nav-collapse-icon-color` | #ababab | #666666 |
| `--nav-collapse-icon-color-collapsed` | #ababab | #666666 |
| `--nav-heading-color` | #222222 | #dadada |
| `--nav-heading-color-collapsed` | #ababab | #666666 |
| `--nav-heading-color-collapsed-hover` | #5c5c5c | #b3b3b3 |
| `--nav-heading-color-hover` | #222222 | #dadada |
| `--nav-heading-weight` | 500 | (same) |
| `--nav-heading-weight-hover` | 500 | (same) |
| `--nav-height` |  | (same) |
| `--nav-indentation-guide-color` | color-mix(in oklch, black 12%, transparent) | color-mix(in oklch, white 12%, transparent) |
| `--nav-indentation-guide-width` | 1px | (same) |
| `--nav-item-background-active` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--nav-item-background-hover` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--nav-item-background-selected` | color-mix(in oklch, hsl(258, 88%, 66%) 15%, transparent) | (same) |
| `--nav-item-children-margin-start` | 12px | (same) |
| `--nav-item-children-padding-start` | 4px | (same) |
| `--nav-item-color` | #5c5c5c | #b3b3b3 |
| `--nav-item-color-active` | #222222 | #dadada |
| `--nav-item-color-highlighted` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--nav-item-color-hover` | #222222 | #dadada |
| `--nav-item-color-selected` | #222222 | #dadada |
| `--nav-item-margin-bottom` | 2px | (same) |
| `--nav-item-padding` | 4px 8px 4px 24px | (same) |
| `--nav-item-parent-padding` | 4px 8px 4px 24px | (same) |
| `--nav-item-radius` | 8px | (same) |
| `--nav-item-size` | 13px | (same) |
| `--nav-item-weight` |  | (same) |
| `--nav-item-weight-active` |  | (same) |
| `--nav-item-weight-hover` |  | (same) |
| `--nav-item-white-space` | pre | (same) |
| `--nav-tag-background` | transparent | (same) |
| `--nav-tag-color` | #ababab | #666666 |
| `--nav-tag-color-active` | #5c5c5c | #b3b3b3 |
| `--nav-tag-color-hover` | #5c5c5c | #b3b3b3 |
| `--nav-tag-radius` | 4px | (same) |
| `--nav-tag-weight` | 600 | (same) |
| `--navbar-bottom-offset` |  | (same) |
| `--navbar-height` |  | (same) |
| `--navbar-max-width` |  | (same) |
| `--navbar-position` |  | (same) |
| `--navbar-radius` |  | (same) |
| `--navbar-width` |  | (same) |
| `--no-tooltip` |  | (same) |
| `--notice-background` | color-mix(in oklch, black 90%, transparent) | (same) |
| `--notice-border` | none | (same) |
| `--notice-color` | #FAFAFA | (same) |
| `--notice-corner-shape` | round | (same) |
| `--notice-font-size` | 13px | (same) |
| `--notice-font-weight` | 400 | (same) |
| `--notice-line-height` | 1.3 | (same) |
| `--notice-max-width` | 300px | (same) |
| `--notice-padding` | 8px 12px | (same) |
| `--notice-radius` | 8px | (same) |
| `--notice-shadow` | 0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07) | 0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3) |
| `--p-spacing` | 1rem | (same) |
| `--p-spacing-empty` | 0rem | (same) |
| `--page-bg-color` |  | (same) |
| `--page-border` | 9px solid transparent | (same) |
| `--page-margin` | 1px auto -8px | (same) |
| `--pdf-background` | #ffffff | #1C1C1C |
| `--pdf-page-background` | #ffffff | #1C1C1C |
| `--pdf-popup-width` |  | (same) |
| `--pdf-shadow` | 0 0 0 1px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.1) | 0 0 0 1px #333333 |
| `--pdf-sidebar-background` | #ffffff | #1C1C1C |
| `--pdf-spread-shadow` | 0 0 0 1px rgba(0, 0, 0, 0.05) | (same) |
| `--pdf-thumbnail-shadow` | 0 0 0 1px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.2) | 0 0 0 1px #333333 |
| `--pdfViewer-padding-bottom` | 0 | (same) |
| `--pill-background` | transparent | (same) |
| `--pill-background-hover` | transparent | (same) |
| `--pill-border-color` | #e4e4e4 | #333333 |
| `--pill-border-color-hover` | #dadada | #3f3f3f |
| `--pill-border-width` | 1px | (same) |
| `--pill-color` | #5c5c5c | #b3b3b3 |
| `--pill-color-hover` | #222222 | #dadada |
| `--pill-color-remove` | #ababab | #666666 |
| `--pill-color-remove-hover` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--pill-corner-shape` |  | (same) |
| `--pill-decoration` | none | (same) |
| `--pill-decoration-hover` | none | (same) |
| `--pill-focus-left-adjust` | -4px | (same) |
| `--pill-focus-width` | calc(100% + 6px) | (same) |
| `--pill-padding-x` | 0.65em | (same) |
| `--pill-padding-y` | 0.25em | (same) |
| `--pill-radius` | 2em | (same) |
| `--pill-weight` |  | (same) |
| `--popover-font-size` | 16px | (same) |
| `--popover-height` | 400px | (same) |
| `--popover-max-height` | 95vh | (same) |
| `--popover-pdf-height` | 400px | (same) |
| `--popover-pdf-width` | 450px | (same) |
| `--popover-width` | 450px | (same) |
| `--preferred-text-scale` | 1 | (same) |
| `--prompt-backdrop-filter` | none | (same) |
| `--prompt-background` | #ffffff | #1C1C1C |
| `--prompt-border-color` | #dadada | #3f3f3f |
| `--prompt-border-width` | 1px | (same) |
| `--prompt-input-height` | 40px | (same) |
| `--prompt-max-height` | 70vh | (same) |
| `--prompt-max-width` | 80vw | (same) |
| `--prompt-top` |  | (same) |
| `--prompt-width` | 700px | (same) |
| `--radio-bg-color` |  | (same) |
| `--radio-border-color` |  | (same) |
| `--radio-checked-bg-color` |  | (same) |
| `--radio-checked-border-color` |  | (same) |
| `--radius-l` | 12px | (same) |
| `--radius-m` | 8px | (same) |
| `--radius-s` | 4px | (same) |
| `--radius-xl` | 24px | (same) |
| `--raised` |  | (same) |
| `--raised-background` | color-mix(in srgb, #ffffff 65%, transparent) linear-gradient(#ffffff, color-mix(in srgb, #ffffff 65%, transparent)) | color-mix(in srgb, #333333 65%, transparent) linear-gradient(#333333, color-mix(in srgb, #333333 65%, transparent)) |
| `--raised-blur` | blur(6px) saturate(1.5) brightness(1.15) | (same) |
| `--raised-mask` | linear-gradient(white, white) padding-box, linear-gradient(white, white) border-box | (same) |
| `--raised-mask-background` | linear-gradient(to bottom left, white, transparent, white) border-box no-repeat | transparent |
| `--raised-mask-border-width` | 0 | (same) |
| `--raised-mask-composite` | exclude, add | (same) |
| `--raised-mask-display` | block | (same) |
| `--raised-shadow` | 0 1px 6px rgba(0, 0, 0, 0.015), 0 4px 24px rgba(0, 0, 0, 0.065), 0 0 transparent |  |
| `--resizer-size` |  | (same) |
| `--ribbon-background` | #f6f6f6 | #282828 |
| `--ribbon-background-collapsed` | #ffffff | #1C1C1C |
| `--ribbon-padding` | 8px 4px 12px | (same) |
| `--ribbon-width` | 44px | (same) |
| `--safe-area-inline-end` | 0px | (same) |
| `--safe-area-inline-start` | 0px | (same) |
| `--safe-area-inset-bottom` | 0px | (same) |
| `--safe-area-inset-left` | 0px | (same) |
| `--safe-area-inset-right` | 0px | (same) |
| `--safe-area-inset-top` | 0px | (same) |
| `--scale-factor` |  | (same) |
| `--scale-round-x` |  | (same) |
| `--scale-round-y` |  | (same) |
| `--scroll-fade-offset-left` |  | (same) |
| `--scroll-fade-offset-right` |  | (same) |
| `--scroll-mask-small` | linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 24px) | (same) |
| `--scrollbar-active-thumb-bg` | color-mix(in oklch, black 20%, transparent) | color-mix(in oklch, white 20%, transparent) |
| `--scrollbar-bg` | transparent | (same) |
| `--scrollbar-border-width` | 3px 3px 3px 2px | (same) |
| `--scrollbar-height` | 12px | (same) |
| `--scrollbar-native-width` | auto | (same) |
| `--scrollbar-radius` | 12px | (same) |
| `--scrollbar-thumb-bg` | color-mix(in oklch, black 10%, transparent) | color-mix(in oklch, white 10%, transparent) |
| `--scrollbar-width` | 12px | (same) |
| `--search-clear-button-color` | #5c5c5c | #b3b3b3 |
| `--search-clear-button-size` | 13px | (same) |
| `--search-icon-color` | #5c5c5c | #b3b3b3 |
| `--search-icon-size` | 16px | (same) |
| `--search-input-corner-shape` | round | (same) |
| `--search-input-radius` | 5px | (same) |
| `--search-result-background` | #ffffff | #1C1C1C |
| `--separator-color` |  | (same) |
| `--setting-group-center-offset` |  | (same) |
| `--setting-group-heading-color` | #222222 | #dadada |
| `--setting-group-heading-size` | 15px | (same) |
| `--setting-group-heading-weight` | 600 | (same) |
| `--setting-group-max-width` | 700px | (same) |
| `--setting-item-name-color` | #222222 | #dadada |
| `--setting-item-name-size` | 13px | (same) |
| `--setting-item-name-weight` | 400 | (same) |
| `--setting-items-background` | #fafafa | #232323 |
| `--setting-items-border-color` | #e4e4e4 | #333333 |
| `--setting-items-border-width` | 0 | (same) |
| `--setting-items-divider-color` | #e4e4e4 | #333333 |
| `--setting-items-divider-width` | 1px | (same) |
| `--setting-items-padding-x` | 20px | (same) |
| `--setting-items-padding-y` | 20px | (same) |
| `--setting-items-radius` | 12px | (same) |
| `--settings-background` | #ffffff | #1C1C1C |
| `--shadow-border-accent` |  | (same) |
| `--shadow-border-themed` |  | (same) |
| `--shadow-border-themed-inset` |  | (same) |
| `--shadow-drag` |  | (same) |
| `--shadow-edges` | 0 0 transparent |  |
| `--shadow-l` | 0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 15px 30px rgba(0, 0, 0, 0.1) | 0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 30px 90px rgba(0, 0, 0, 0.2) |
| `--shadow-s` | 0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07) | 0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3) |
| `--shadow-stationary` |  | (same) |
| `--shadow-xs` | 0 1px 6px rgba(0, 0, 0, 0.015), 0 4px 24px rgba(0, 0, 0, 0.065), 0 0 transparent |  |
| `--sidebar-left-toggle-inner-width` | 8.33% | (same) |
| `--sidebar-left-toggle-inner-width-open` | 24% | (same) |
| `--sidebar-markdown-font-size` | calc(16px * 0.9) | (same) |
| `--sidebar-right-toggle-inner-width` | 8.33% | (same) |
| `--sidebar-right-toggle-inner-width-open` | 24% | (same) |
| `--sidebar-tab-container-background` | #f6f6f6 | #282828 |
| `--sidebar-tab-text-display` | none | (same) |
| `--sidebar-width` |  | (same) |
| `--size-2-1` | 2px | (same) |
| `--size-2-2` | 4px | (same) |
| `--size-2-3` | 6px | (same) |
| `--size-4-1` | 4px | (same) |
| `--size-4-10` | 40px | (same) |
| `--size-4-12` | 48px | (same) |
| `--size-4-16` | 64px | (same) |
| `--size-4-18` | 72px | (same) |
| `--size-4-2` | 8px | (same) |
| `--size-4-3` | 12px | (same) |
| `--size-4-4` | 16px | (same) |
| `--size-4-5` | 20px | (same) |
| `--size-4-6` | 24px | (same) |
| `--size-4-8` | 32px | (same) |
| `--size-4-9` | 36px | (same) |
| `--slider-fill-background` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--slider-fill-position` |  | (same) |
| `--slider-s-thumb-position` | -5px | (same) |
| `--slider-s-thumb-size` | 15px | (same) |
| `--slider-thumb-background` | white | (same) |
| `--slider-thumb-background-hover` | white | (same) |
| `--slider-thumb-border-color` | #dadada | #3f3f3f |
| `--slider-thumb-border-width` | 0.5px | (same) |
| `--slider-thumb-height` | 18px | (same) |
| `--slider-thumb-height-active` | 18px | (same) |
| `--slider-thumb-opacity-active` |  | (same) |
| `--slider-thumb-radius` | 18px | (same) |
| `--slider-thumb-shadow` | 0 0px 2px 0px rgba(0, 0, 0, 0.1), 0 2px 6px 0px rgba(0, 0, 0, 0.1) | (same) |
| `--slider-thumb-shadow-active` | 0 0px 2px 0px rgba(0, 0, 0, 0.1), 0 2px 6px 0px rgba(0, 0, 0, 0.1) | (same) |
| `--slider-thumb-shadow-focus` | 0 0px 2px 0px rgba(0, 0, 0, 0.1), 0 2px 6px 0px rgba(0, 0, 0, 0.1), 0 0px 0px 2px #bdbdbd | 0 0px 2px 0px rgba(0, 0, 0, 0.1), 0 2px 6px 0px rgba(0, 0, 0, 0.1), 0 0px 0px 2px #555555 |
| `--slider-thumb-shadow-hover` | 0 0px 2px 0px rgba(0, 0, 0, 0.1), 0 2px 6px 0px rgba(0, 0, 0, 0.1) | (same) |
| `--slider-thumb-width` | 18px | (same) |
| `--slider-thumb-width-active` | 18px | (same) |
| `--slider-thumb-y` | -6px | (same) |
| `--slider-thumb-y-active` | -6px | (same) |
| `--slider-track-background` | #dadada | #3f3f3f |
| `--slider-track-height` | 4px | (same) |
| `--slider-value-font-size` | 13px | (same) |
| `--slider-value-font-weight` | 400 | (same) |
| `--spreadHorizontalWrapped-margin-LR` | -3.5px | (same) |
| `--status-bar-background` | #f6f6f6 | #282828 |
| `--status-bar-border-color` | #e4e4e4 | #333333 |
| `--status-bar-border-width` | 1px 0 0 1px | (same) |
| `--status-bar-font-size` | 12px | (same) |
| `--status-bar-position` | fixed | (same) |
| `--status-bar-radius` | 8px 0 0 0 | (same) |
| `--status-bar-text-color` | #5c5c5c | #b3b3b3 |
| `--suggestion-backdrop-filter` | none | (same) |
| `--suggestion-background` | #ffffff | #1C1C1C |
| `--swatch-height` | 22px | (same) |
| `--swatch-radius` | 14px | (same) |
| `--swatch-shadow` | inset 0 0 0 1px color-mix(in oklch, black 15%, transparent) | inset 0 0 0 1px color-mix(in oklch, white 15%, transparent) |
| `--swatch-width` | 22px | (same) |
| `--sync-avatar-color-1` | #e93147 | #fb464c |
| `--sync-avatar-color-2` | #ec7500 | #e9973f |
| `--sync-avatar-color-3` | #e0ac00 | #e0de71 |
| `--sync-avatar-color-4` | #08b94e | #44cf6e |
| `--sync-avatar-color-5` | #00bfbc | #53dfdd |
| `--sync-avatar-color-6` | #086ddd | #027aff |
| `--sync-avatar-color-7` | #7852ee | #a882ff |
| `--sync-avatar-color-8` | #d53984 | #fa99cd |
| `--sync-avatar-color-current-user` | transparent | (same) |
| `--system-status-background` |  | (same) |
| `--tab-background` | transparent | (same) |
| `--tab-background-active` | #ffffff | #1C1C1C |
| `--tab-background-hover` | transparent | (same) |
| `--tab-container-background` | #f6f6f6 | #282828 |
| `--tab-container-padding-end` | 8px | (same) |
| `--tab-container-padding-start` | 8px | (same) |
| `--tab-corner-shape` | round | (same) |
| `--tab-curve` | 10px | (same) |
| `--tab-divider-color` | #dadada | #3f3f3f |
| `--tab-font-size` | 13px | (same) |
| `--tab-font-weight` |  | (same) |
| `--tab-inner-background` | transparent | (same) |
| `--tab-inner-background-active` | transparent | (same) |
| `--tab-inner-background-hover` | color-mix(in oklch, black 6.7%, transparent) | color-mix(in oklch, white 6.7%, transparent) |
| `--tab-inner-border-color` | transparent | (same) |
| `--tab-inner-border-color-active` | transparent | (same) |
| `--tab-inner-border-color-hover` | transparent | (same) |
| `--tab-inner-border-width` | 0px | (same) |
| `--tab-max-width` | 320px | (same) |
| `--tab-outline-color` | #e4e4e4 | #333333 |
| `--tab-outline-color-hover` | transparent | (same) |
| `--tab-outline-width` | 1px | (same) |
| `--tab-radius` | 4px | (same) |
| `--tab-radius-active` | 10px 10px 0 0 | (same) |
| `--tab-stacked-font-size` | 13px | (same) |
| `--tab-stacked-font-weight` | 400 | (same) |
| `--tab-stacked-header-width` | 40px | (same) |
| `--tab-stacked-pane-width` | 700px | (same) |
| `--tab-stacked-shadow` | -8px 0 8px 0 rgba(0, 0, 0, 0.05) | (same) |
| `--tab-stacked-text-align` | start | (same) |
| `--tab-stacked-text-transform` | rotate(0deg) | (same) |
| `--tab-stacked-text-writing-mode` | vertical-lr | (same) |
| `--tab-switcher-background` | #f6f6f6 | #282828 |
| `--tab-switcher-menubar-background` | linear-gradient(to top, #f6f6f6, transparent) | linear-gradient(to top, #282828, transparent) |
| `--tab-switcher-preview-background-shadow` | 0 4px 30px 2px rgba(0, 0, 0, 0.2) | (same) |
| `--tab-switcher-preview-corner-shape` | round | (same) |
| `--tab-switcher-preview-radius` | 24px | (same) |
| `--tab-switcher-preview-shadow` | 0 0 0 1px color-mix(in oklch, black 5%, transparent) | 0 0 0 1px color-mix(in oklch, white 5%, transparent) |
| `--tab-switcher-preview-shadow-active` | 0 0 0 2px hsl(258, 88%, 66%) | (same) |
| `--tab-text-color` | #ababab | #666666 |
| `--tab-text-color-active` | #5c5c5c | #b3b3b3 |
| `--tab-text-color-focused` | #5c5c5c | #b3b3b3 |
| `--tab-text-color-focused-active` | #5c5c5c | #b3b3b3 |
| `--tab-text-color-focused-active-current` | #222222 | #dadada |
| `--tab-text-color-focused-highlighted` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--tab-width` | 200px | (same) |
| `--table-add-button-background` | transparent | (same) |
| `--table-add-button-border-color` | #e4e4e4 | #333333 |
| `--table-add-button-border-width` | 1px | (same) |
| `--table-background` | transparent | (same) |
| `--table-border-color` | #e4e4e4 | #333333 |
| `--table-border-width` | 1px | (same) |
| `--table-cell-vertical-alignment` | top | (same) |
| `--table-column-alt-background` | transparent | (same) |
| `--table-column-first-border-width` | 1px | (same) |
| `--table-column-last-border-width` | 1px | (same) |
| `--table-column-max-width` | none | (same) |
| `--table-column-min-width` | 6ch | (same) |
| `--table-drag-handle-background` | transparent | (same) |
| `--table-drag-handle-background-active` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--table-drag-handle-color` | #ababab | #666666 |
| `--table-drag-handle-color-active` | white | (same) |
| `--table-drag-handle-size` |  | (same) |
| `--table-drop-indicator-half-width` | 2px | (same) |
| `--table-header-background` | transparent | (same) |
| `--table-header-background-hover` |  | (same) |
| `--table-header-border-color` | #e4e4e4 | #333333 |
| `--table-header-border-width` | 1px | (same) |
| `--table-header-color` | #222222 | #dadada |
| `--table-header-font` |  | (same) |
| `--table-header-size` | 16px | (same) |
| `--table-header-weight` | calc(400 + 200) | (same) |
| `--table-line-height` | 1.3 | (same) |
| `--table-row-alt-background` | transparent | (same) |
| `--table-row-alt-background-hover` | transparent | (same) |
| `--table-row-background-hover` | transparent | (same) |
| `--table-row-last-border-width` | 1px | (same) |
| `--table-selection` | color-mix(in oklch, hsl(258, 88%, 66%) 10%, transparent) | (same) |
| `--table-selection-blend-mode` | darken | lighten |
| `--table-selection-border-color` | hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) | hsl(258, 88%, 66%) |
| `--table-selection-border-radius` | 4px | (same) |
| `--table-selection-border-width` | 2px | (same) |
| `--table-text-color` |  | (same) |
| `--table-text-size` | 16px | (same) |
| `--table-white-space` | break-spaces | (same) |
| `--tag-background` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 10%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 10%, transparent) |
| `--tag-background-hover` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 20%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 20%, transparent) |
| `--tag-border-color` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 15%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 15%, transparent) |
| `--tag-border-color-hover` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 15%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 15%, transparent) |
| `--tag-border-width` | 0px | (same) |
| `--tag-color` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--tag-color-hover` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--tag-corner-shape` | round | (same) |
| `--tag-decoration` | none | (same) |
| `--tag-decoration-hover` | none | (same) |
| `--tag-padding-x` | 0.65em | (same) |
| `--tag-padding-y` | 0.25em | (same) |
| `--tag-radius` | 2em | (same) |
| `--tag-size` | 0.875em | (same) |
| `--tag-weight` |  | (same) |
| `--text-accent` | hsl(258, 88%, 66%) | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) |
| `--text-accent-hover` | hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15)) | hsl(calc(258 - 5), calc(88% * 1.05), calc(66% * 1.29)) |
| `--text-color` |  | (same) |
| `--text-error` | #e93147 | #fb464c |
| `--text-faint` | #ababab | #666666 |
| `--text-muted` | #5c5c5c | #b3b3b3 |
| `--text-normal` | #222222 | #dadada |
| `--text-on-accent` | white | (same) |
| `--text-on-accent-inverted` | black | (same) |
| `--text-primary-color` |  | (same) |
| `--text-secondary-color` |  | (same) |
| `--text-selection` | color-mix(in oklch, hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075)) 20%, transparent) | color-mix(in oklch, hsl(258, 88%, 66%) 33%, transparent) |
| `--text-success` | #08b94e | #44cf6e |
| `--text-warning` | #ec7500 | #e9973f |
| `--textarea-bg-color` |  | (same) |
| `--textarea-border-color` |  | (same) |
| `--textarea-fg-color` |  | (same) |
| `--textarea-padding` |  | (same) |
| `--textarea-radius` |  | (same) |
| `--thumbnail-height` |  | (same) |
| `--thumbnail-width` |  | (same) |
| `--titlebar-background` | #f6f6f6 | #282828 |
| `--titlebar-background-focused` | #f6f6f6 | #282828 |
| `--titlebar-border-color` | #e4e4e4 | #333333 |
| `--titlebar-border-width` | 0px | (same) |
| `--titlebar-height` | 30px | (same) |
| `--titlebar-text-color` | #5c5c5c | #b3b3b3 |
| `--titlebar-text-color-focused` | #222222 | #dadada |
| `--titlebar-text-weight` | 700 | (same) |
| `--toggle-border-width` | 2px | (same) |
| `--toggle-radius` | 18px | (same) |
| `--toggle-s-border-width` | 2px | (same) |
| `--toggle-s-thumb-height` | 15px | (same) |
| `--toggle-s-thumb-width` | 15px | (same) |
| `--toggle-s-width` | 34px | (same) |
| `--toggle-thumb-color` | white | (same) |
| `--toggle-thumb-height` | 18px | (same) |
| `--toggle-thumb-opacity-active` | 1 | (same) |
| `--toggle-thumb-radius` | 18px | (same) |
| `--toggle-thumb-width` | 18px | (same) |
| `--toggle-width` | 40px | (same) |
| `--toolbar-option-width` |  | (same) |
| `--tooltip-background` | color-mix(in oklch, black 90%, transparent) | (same) |
| `--tooltip-color` | #FAFAFA | (same) |
| `--tooltip-corner-shape` | round | (same) |
| `--tooltip-font-size` | 13px | (same) |
| `--tooltip-font-weight` | 400 | (same) |
| `--tooltip-line-height` | 1.3 | (same) |
| `--tooltip-max-width` | 300px | (same) |
| `--tooltip-padding` | 8px 12px | (same) |
| `--tooltip-radius` | 12px | (same) |
| `--tooltip-shadow` | 0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07) | 0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3) |
| `--total-scale-factor` |  | (same) |
| `--touch-radius-l` | 52px | (same) |
| `--touch-radius-m` | 44px | (same) |
| `--touch-radius-s` | 40px | (same) |
| `--touch-radius-xl` | 60px | (same) |
| `--touch-radius-xs` | 30px | (same) |
| `--touch-radius-xxs` | 24px | (same) |
| `--touch-size-l` | 52px | (same) |
| `--touch-size-m` | 44px | (same) |
| `--touch-size-s` | 40px | (same) |
| `--touch-size-xl` | 60px | (same) |
| `--touch-size-xs` | 30px | (same) |
| `--touch-size-xxs` | 24px | (same) |
| `--traffic-lights-offset-x` | 40px | (same) |
| `--traffic-lights-offset-y` | 40px | (same) |
| `--undo-button-bg-color` |  | (same) |
| `--undo-button-bg-color-active` |  | (same) |
| `--undo-button-bg-color-hover` |  | (same) |
| `--undo-button-border` |  | (same) |
| `--undo-button-fg-color` |  | (same) |
| `--undo-button-fg-color-active` |  | (same) |
| `--undo-button-fg-color-hover` |  | (same) |
| `--user-unit` |  | (same) |
| `--vault-profile-actions-display` | flex | (same) |
| `--vault-profile-color` | #222222 | #dadada |
| `--vault-profile-color-hover` | #222222 | #dadada |
| `--vault-profile-display` | flex | (same) |
| `--vault-profile-font-size` | 13px | (same) |
| `--vault-profile-font-weight` | 500 | (same) |
| `--vault-profile-order` | 2 | (same) |
| `--vault-profile-radius` | 4px | (same) |
| `--view-bottom-fade-mask` |  | (same) |
| `--view-bottom-fade-opacity` |  | (same) |
| `--view-bottom-spacing` |  | (same) |
| `--view-header-action-radius` |  | (same) |
| `--view-header-height` |  | (same) |
| `--view-header-position` |  | (same) |
| `--view-header-top-offset` |  | (same) |
| `--view-top-fade-mask` |  | (same) |
| `--view-top-fade-opacity` |  | (same) |
| `--view-top-spacing` |  | (same) |
| `--view-top-spacing-markdown` |  | (same) |
| `--viewer-container-height` | 0 | (same) |
| `--workspace-background-translucent` | color-mix(in oklch, white 60%, transparent) | color-mix(in oklch, black 60%, transparent) |
| `--xfa-focus-outline` | auto | (same) |
| `--xfa-unfocused-field-background` | url("data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>") | (same) |
| `--zoom-factor` | 1 | (same) |
| `--zoom-multiplier` |  | (same) |
