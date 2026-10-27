// Book themes from the setup guide, written as a CSS snippet (.obsidian/snippets/bedrock-book-theme.css)
// so they apply on top of any theme, sync like other snippets and can be turned off in
// Settings › Appearance › CSS snippets. Light touches only: text stays readable in light and dark.
import type { BookThemeId } from "../../core/onboarding";

export const BOOK_SNIPPET = "bedrock-book-theme";
export const CLAUDE_SNIPPET = "claude-theme";

const svg = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

const PAWS = (fill: string) =>
  svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><g fill='${fill}'>` +
      `<ellipse cx='34' cy='44' rx='10' ry='8'/><circle cx='21' cy='31' r='4.5'/><circle cx='30' cy='24' r='4.5'/><circle cx='40' cy='24' r='4.5'/><circle cx='48' cy='32' r='4.5'/>` +
      `<g transform='rotate(25 112 118)'><ellipse cx='112' cy='122' rx='10' ry='8'/><circle cx='99' cy='109' r='4.5'/><circle cx='108' cy='102' r='4.5'/><circle cx='118' cy='102' r='4.5'/><circle cx='126' cy='110' r='4.5'/></g>` +
      `</g></svg>`,
  );

const BATS = (bat: string, pumpkin: string) =>
  svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'>` +
      `<path fill='${bat}' d='M20 40 q8 -10 16 -2 q4 -8 8 0 q8 -8 16 2 q-8 0 -10 8 q-5 -4 -10 3 q-5 -7 -10 -3 q-2 -8 -10 -8z'/>` +
      `<path fill='${bat}' transform='translate(120 150) scale(0.7)' d='M20 40 q8 -10 16 -2 q4 -8 8 0 q8 -8 16 2 q-8 0 -10 8 q-5 -4 -10 3 q-5 -7 -10 -3 q-2 -8 -10 -8z'/>` +
      `<g transform='translate(150 40)'><ellipse cx='12' cy='14' rx='13' ry='10' fill='${pumpkin}'/><rect x='10.5' y='1' width='3' height='6' fill='${bat}'/></g>` +
      `</svg>`,
  );

const HEADER =
  "/* Bedrock book theme, written by the setup guide. Change it here, turn it off in Settings › Appearance › CSS snippets,\n   or pick another one with the command “Open onboarding”. */\n";

const HEADINGS = ".markdown-rendered h1, .markdown-rendered h2, .markdown-rendered h3, .HyperMD-header-1, .HyperMD-header-2, .HyperMD-header-3, .inline-title";

export function bookThemeCss(id: BookThemeId): string {
  switch (id) {
    case "pixelated":
      return (
        HEADER +
        `body {
  --font-pixel: "Press Start 2P", "Pixelify Sans", "Silkscreen", "VT323", "Cascadia Mono", Consolas, "Courier New", ui-monospace, monospace;
  --radius-s: 0; --radius-m: 0; --radius-l: 0; --radius-xl: 0;
  --button-radius: 0; --checkbox-radius: 0; --input-radius: 0; --modal-radius: 0; --tab-radius: 0; --tab-radius-active: 0;
}
${HEADINGS} {
  font-family: var(--font-pixel);
  letter-spacing: 0.02em;
  -webkit-font-smoothing: none;
  text-shadow: 2px 2px 0 var(--background-modifier-border);
}
button, .clickable-icon, input, select, .modal, .menu, .prompt, .suggestion-container, .workspace-tab-header, .nav-file-title, .nav-folder-title, .tree-item-self, .callout, .markdown-rendered code, .cm-inline-code {
  border-radius: 0 !important;
}
button:not(.clickable-icon), .modal, .menu, .prompt, .suggestion-container {
  box-shadow: 3px 3px 0 var(--background-modifier-border-focus) !important;
}
button:not(.clickable-icon):active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--background-modifier-border-focus) !important; }
.markdown-rendered img, .graph-view canvas { image-rendering: pixelated; }
.workspace-tab-header.is-active { box-shadow: inset 0 -3px 0 var(--interactive-accent); }
`
      );
    case "minimal":
      return (
        HEADER +
        `body {
  --file-line-width: 680px;
  --line-height-normal: 1.65;
  --divider-color: transparent;
  --tab-outline-color: transparent;
  --background-modifier-border: color-mix(in srgb, var(--text-faint) 18%, transparent);
}
.workspace-ribbon.mod-left, .workspace-tab-header-container, .view-header, .status-bar { border-color: transparent !important; }
.status-bar { opacity: 0.55; transition: opacity 0.2s; }
.status-bar:hover { opacity: 1; }
${HEADINGS} { font-weight: 600; letter-spacing: -0.01em; }
.markdown-rendered h1, .HyperMD-header-1, .inline-title { color: var(--text-normal); }
.markdown-rendered h2, .markdown-rendered h3, .HyperMD-header-2, .HyperMD-header-3 { color: var(--text-muted); }
.markdown-rendered hr { border-color: var(--background-modifier-border); }
.view-header-title-container, .view-actions { opacity: 0.6; }
.view-header:hover .view-header-title-container, .view-header:hover .view-actions { opacity: 1; }
`
      );
    case "animals":
      return (
        HEADER +
        `body.theme-light { --bedrock-pattern: ${PAWS("rgba(150,100,50,0.07)")}; --bedrock-head: #8a5a2b; }
body.theme-dark { --bedrock-pattern: ${PAWS("rgba(230,190,140,0.06)")}; --bedrock-head: #e3b17a; }
.workspace-leaf-content[data-type="markdown"] .view-content, .workspace-leaf-content[data-type="empty"] .view-content {
  background-image: var(--bedrock-pattern);
  background-size: 160px 160px;
}
.markdown-rendered h1, .HyperMD-header-1, .inline-title { color: var(--bedrock-head); }
.markdown-rendered h1::before { content: "🐾 "; font-size: 0.8em; }
.markdown-rendered blockquote { border-left-color: var(--bedrock-head); }
.nav-folder-title-content::before { content: "🐾 "; font-size: 0.75em; opacity: 0.7; }
`
      );
    case "halloween":
      return (
        HEADER +
        `body.theme-light { --bedrock-pattern: ${BATS("rgba(60,30,80,0.07)", "rgba(240,120,20,0.10)")}; --bedrock-head: #c4560c; --bedrock-head2: #6b3fa0; }
body.theme-dark { --bedrock-pattern: ${BATS("rgba(200,170,255,0.06)", "rgba(255,140,40,0.09)")}; --bedrock-head: #ff9a3c; --bedrock-head2: #b48cf2; }
.workspace-leaf-content[data-type="markdown"] .view-content, .workspace-leaf-content[data-type="empty"] .view-content {
  background-image: var(--bedrock-pattern);
  background-size: 220px 220px;
}
.markdown-rendered h1, .HyperMD-header-1, .inline-title { color: var(--bedrock-head); }
.markdown-rendered h2, .markdown-rendered h3, .HyperMD-header-2, .HyperMD-header-3 { color: var(--bedrock-head2); }
.markdown-rendered h1::before { content: "🎃 "; font-size: 0.8em; }
.markdown-rendered blockquote { border-left-color: var(--bedrock-head); }
`
      );
    default:
      return "";
  }
}
