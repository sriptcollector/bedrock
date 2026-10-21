// Canvas stylesheet: our own CSS on the public canvas class names and --canvas-* variables.
import { injectStyle } from "../graph/inject-style";

const CSS = `
body {
  --canvas-controls-icon-size: 16px;
  --canvas-controls-icon-stroke: 2px;
  --canvas-controls-radius: 4px;
  --zoom-multiplier: 1;
}
body.theme-light {
  --canvas-background: var(--background-primary, #ffffff);
  --canvas-card-label-color: #ababab;
  --canvas-color: #c0c0c0;
  --canvas-color-1: #e93147;
  --canvas-color-2: #ec7500;
  --canvas-color-3: #e0ac00;
  --canvas-color-4: #08b94e;
  --canvas-color-5: #00bfbc;
  --canvas-color-6: #7852ee;
  --canvas-dot-pattern: #e4e4e4;
  --input-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.065), 0 0 0 0 transparent;
}
body.theme-dark {
  --canvas-background: var(--background-primary, #1c1c1c);
  --canvas-card-label-color: #666666;
  --canvas-color: #7e7e7e;
  --canvas-color-1: #fb464c;
  --canvas-color-2: #e9973f;
  --canvas-color-3: #e0de71;
  --canvas-color-4: #44cf6e;
  --canvas-color-5: #53dfdd;
  --canvas-color-6: #a882ff;
  --canvas-dot-pattern: #333333;
  --input-shadow: inset 0 0.5px 0.5px 0.5px rgba(255, 255, 255, 0.09), 0 2px 4px 0 rgba(0, 0, 0, 0.15), 0 1px 1.5px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.2), 0 0 0 0 transparent;
}
.mod-canvas-color-1 { --canvas-color: var(--canvas-color-1); }
.mod-canvas-color-2 { --canvas-color: var(--canvas-color-2); }
.mod-canvas-color-3 { --canvas-color: var(--canvas-color-3); }
.mod-canvas-color-4 { --canvas-color: var(--canvas-color-4); }
.mod-canvas-color-5 { --canvas-color: var(--canvas-color-5); }
.mod-canvas-color-6 { --canvas-color: var(--canvas-color-6); }

.workspace-leaf-content[data-type="canvas"] > .view-content {
  position: relative;
  padding: 0;
  overflow: hidden;
  background-color: var(--canvas-background);
}
.canvas-wrapper {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background-color: var(--canvas-background);
  outline: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.canvas-wrapper.is-dragging, .canvas-wrapper.is-dragging * { cursor: grabbing !important; }
.canvas-wrapper.is-panning, .canvas-wrapper.is-panning * { cursor: grabbing !important; }
.canvas-wrapper.is-holding-space { cursor: grab; }
.canvas-background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.canvas-background circle { fill: var(--canvas-dot-pattern); }
.canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  transform-origin: 0 0;
}
.canvas-edges {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}
.canvas-edges path { fill: none; }
.canvas-edges .canvas-display-path {
  stroke: var(--canvas-color);
  stroke-width: calc(var(--zoom-multiplier) * 2px);
  stroke-linecap: round;
  transition: stroke-width 0.1s ease-out;
}
.canvas-edges .canvas-interaction-path {
  stroke: transparent;
  stroke-width: calc(var(--zoom-multiplier) * 24px);
  pointer-events: stroke;
  cursor: pointer;
}
.canvas-wrapper.is-readonly .canvas-edges .canvas-interaction-path { cursor: default; }
.canvas-edges g:hover .canvas-display-path,
.canvas-edges g.is-focused .canvas-display-path { stroke-width: calc(var(--zoom-multiplier) * 3px); }
.canvas-edges g.is-focused .canvas-display-path { stroke: var(--canvas-color); }
.canvas-edges g:not(.is-themed).is-focused .canvas-display-path { stroke: var(--interactive-accent); }
.canvas-path-end {
  fill: var(--canvas-color);
  stroke: var(--canvas-color);
  stroke-width: 1px;
  transform: scale(var(--zoom-multiplier));
  transform-origin: 0 0;
}
.canvas-edges g.is-focused:not(.is-themed) .canvas-path-end { fill: var(--interactive-accent); stroke: var(--interactive-accent); }
.canvas-path-label-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 1;
}
.canvas-path-label {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: calc(6px * var(--zoom-multiplier));
  max-width: calc(576px * var(--zoom-multiplier));
  font-size: calc(20px * var(--zoom-multiplier));
  line-height: 1.3;
  color: var(--text-normal);
  background-color: var(--canvas-background);
  border-radius: 4px;
  white-space: pre-wrap;
  text-align: center;
  width: max-content;
  outline: none;
  cursor: pointer;
  user-select: none;
}
.canvas-path-label.is-editing { cursor: text; user-select: text; -webkit-user-select: text; }
.canvas-path-label:empty::before { content: attr(data-placeholder); color: var(--text-faint); }

.canvas-node {
  position: absolute;
  top: 0;
  left: 0;
}
.canvas-node-container {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--canvas-background);
  border: 1px solid var(--canvas-color);
  border-radius: var(--radius-m, 8px);
  box-shadow: 0 0.5px 1px 0.5px rgba(0, 0, 0, 0.1);
  cursor: grab;
}
.canvas-node.is-themed > .canvas-node-container {
  border-color: color-mix(in oklch, var(--canvas-color) 70.0%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--canvas-color) 70.0%, transparent), 0 0.5px 1px 0.5px rgba(0, 0, 0, 0.1);
}
.canvas-node.is-focused > .canvas-node-container,
.canvas-node.is-selected > .canvas-node-container {
  border-color: var(--interactive-accent);
  box-shadow: inset 0 0 0 1px var(--interactive-accent), 0 0 0 2px var(--interactive-accent);
}
.canvas-node.is-themed.is-focused > .canvas-node-container,
.canvas-node.is-themed.is-selected > .canvas-node-container {
  border-color: var(--canvas-color);
  box-shadow: inset 0 0 0 1px var(--canvas-color), 0 0 0 2px var(--canvas-color);
}
.canvas-node.is-editing > .canvas-node-container { cursor: auto; }
.canvas-node-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}
.canvas-node.is-themed .canvas-node-content.markdown-embed:not(.is-loaded) { background-color: color-mix(in oklch, var(--canvas-color) 7.0%, transparent); }
.canvas-node-content.markdown-embed { border: 0; padding: 0; margin: 0; }
.canvas-node-content.markdown-embed > .markdown-embed-content { height: 100%; max-height: none; overflow: hidden; }
.canvas-node-content .markdown-preview-view {
  height: 100%;
  padding: 0 16px;
  font-size: var(--font-text-size, 16px);
  line-height: var(--line-height-normal, 1.5);
  overflow-y: hidden;
  overflow-x: hidden;
  user-select: text;
  -webkit-user-select: text;
}
.canvas-node.is-focused .canvas-node-content .markdown-preview-view,
.canvas-node.is-editing .canvas-node-content .markdown-preview-view { overflow-y: auto; }
.canvas-node-content .markdown-preview-sizer { padding: 16px 0; min-height: 100%; }
.canvas-node-content .markdown-preview-sizer > div:first-child > :first-child,
.canvas-node-content .markdown-preview-sizer > .inline-title { margin-top: 0; }
.canvas-node-content .markdown-preview-sizer > div:last-child > :last-child { margin-bottom: 0; }
.canvas-node-content .inline-title {
  font-size: var(--inline-title-size, 1.618em);
  font-weight: var(--inline-title-weight, 700);
  line-height: 1.2;
  margin: 0 0 0.5em;
  white-space: pre-wrap;
  color: var(--inline-title-color, var(--text-normal));
}
.canvas-node-content .markdown-embed-link {
  position: absolute;
  top: 4px;
  right: 8px;
  display: none;
  padding: 4px;
  border-radius: 4px;
  color: var(--icon-color, var(--text-muted));
  opacity: 0.85;
  z-index: 6;
  cursor: var(--cursor, default);
}
.canvas-node.is-focused .canvas-node-content .markdown-embed-link,
.canvas-node:hover .canvas-node-content .markdown-embed-link { display: flex; }
.canvas-node-content .markdown-embed-link .svg-icon { width: 16px; height: 16px; }
.canvas-node-content .markdown-source-view { height: 100%; }
.canvas-node-content .markdown-source-view .cm-editor { height: 100%; }
.canvas-node-content .markdown-source-view .cm-scroller { padding: 16px; overflow: auto; font-size: var(--font-text-size, 16px); }
.canvas-node-content .markdown-source-view .cm-sizer { max-width: none; margin: 0; }
.canvas-node-content.media-embed { display: flex; align-items: center; justify-content: center; }
.canvas-node-content.image-embed img { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; }
.canvas-node-content.media-embed video, .canvas-node-content.media-embed audio { max-width: 100%; max-height: 100%; }
.canvas-node-content.pdf-embed iframe, .canvas-node-content.pdf-embed embed { width: 100%; height: 100%; border: 0; }
.canvas-node-content.file-embed { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); font-size: var(--font-ui-medium, 15px); padding: 16px; }
.canvas-node-content .canvas-link { display: flex; width: 100%; height: 100%; border: 0; background-color: var(--background-primary); }
.canvas-node-content-blocker { position: absolute; inset: 0; z-index: 5; }
.canvas-node.is-focused .canvas-node-content-blocker,
.canvas-node.is-editing .canvas-node-content-blocker { display: none; }
.canvas-node-placeholder {
  display: none;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  overflow: hidden;
  background-color: color-mix(in oklch, var(--canvas-color) 10.0%, transparent);
  color: var(--text-normal);
}
.canvas-icon-placeholder { display: flex; width: 100px; height: 36px; max-height: 100%; }
.canvas-icon-placeholder .svg-icon { width: 100%; height: 100%; color: var(--canvas-color); opacity: 0.3; }
.canvas-wrapper.mod-zoomed-out .canvas-node:not(.is-editing):not(.canvas-node-group) .canvas-node-content { display: none; }
.canvas-wrapper.mod-zoomed-out .canvas-node:not(.is-editing):not(.canvas-node-group) .canvas-node-placeholder { display: flex; }
.canvas-node-label, .canvas-group-label {
  position: absolute;
  top: calc(-4px * var(--zoom-multiplier));
  left: 0;
  max-width: calc(100% / var(--zoom-multiplier));
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transform: translate(0, -100%) scale(var(--zoom-multiplier));
  transform-origin: bottom left;
  pointer-events: none;
}
.canvas-node-label {
  font-size: var(--font-ui-medium, 15px);
  line-height: 1.3;
  color: var(--canvas-card-label-color);
}
.canvas-wrapper.mod-card-labels-hover .canvas-node:not(:hover):not(.is-focused) .canvas-node-label,
.canvas-wrapper.mod-card-labels-never .canvas-node-label { display: none; }
.canvas-node-group > .canvas-node-container { background-color: transparent; }
.canvas-node-group > .canvas-node-container > .canvas-node-content { background-color: color-mix(in oklch, var(--canvas-color) 7.0%, transparent); background-position: center; background-repeat: no-repeat; background-size: cover; }
.canvas-node-group > .canvas-node-container > .canvas-node-content.mod-background-ratio { background-size: contain; }
.canvas-node-group > .canvas-node-container > .canvas-node-content.mod-background-repeat { background-size: auto; background-repeat: repeat; background-position: 0 0; }
.canvas-group-label {
  padding: 4px 8px;
  font-size: calc(var(--font-ui-medium, 15px) * 1.5);
  line-height: 1;
  color: var(--text-muted);
  background-color: color-mix(in oklch, var(--canvas-color) 10.0%, transparent);
  border-radius: 4px;
  pointer-events: auto;
  cursor: grab;
  outline: none;
}
.canvas-group-label.is-editing { cursor: text; user-select: text; -webkit-user-select: text; text-overflow: clip; }
.canvas-group-label:empty::before { content: attr(data-placeholder); color: var(--text-faint); }

.canvas-node-interaction-layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.canvas-node-interaction-layer.is-hidden { display: none; }
.canvas-node-resizer { position: absolute; pointer-events: auto; }
.canvas-node-resizer[data-resize="top"] { top: -10px; left: 0; right: 0; height: 20px; cursor: ns-resize; }
.canvas-node-resizer[data-resize="bottom"] { bottom: -10px; left: 0; right: 0; height: 20px; cursor: ns-resize; }
.canvas-node-resizer[data-resize="left"] { left: -10px; top: 0; bottom: 0; width: 20px; cursor: ew-resize; }
.canvas-node-resizer[data-resize="right"] { right: -10px; top: 0; bottom: 0; width: 20px; cursor: ew-resize; }
.canvas-node-resizer[data-resize="topleft"] { top: -10px; left: -10px; width: 20px; height: 20px; cursor: nwse-resize; }
.canvas-node-resizer[data-resize="topright"] { top: -10px; right: -10px; width: 20px; height: 20px; cursor: nesw-resize; }
.canvas-node-resizer[data-resize="bottomleft"] { bottom: -10px; left: -10px; width: 20px; height: 20px; cursor: nesw-resize; }
.canvas-node-resizer[data-resize="bottomright"] { bottom: -10px; right: -10px; width: 20px; height: 20px; cursor: nwse-resize; }
.canvas-node-connection-point {
  position: absolute;
  width: calc(20px * var(--zoom-multiplier));
  height: calc(20px * var(--zoom-multiplier));
  pointer-events: auto;
  cursor: pointer;
  transform: translate(-50%, -50%);
}
.canvas-node-connection-point[data-side="top"] { top: 1px; left: 50%; }
.canvas-node-connection-point[data-side="bottom"] { top: calc(100% - 1px); left: 50%; }
.canvas-node-connection-point[data-side="left"] { top: 50%; left: 1px; }
.canvas-node-connection-point[data-side="right"] { top: 50%; left: calc(100% - 1px); }
.canvas-node-connection-point::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(8px * var(--zoom-multiplier));
  height: calc(8px * var(--zoom-multiplier));
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background-color: var(--canvas-background);
  border: calc(2px * var(--zoom-multiplier)) solid var(--interactive-accent);
  opacity: 0;
  transition: opacity 0.1s ease-out;
}
.canvas-node-interaction-layer.is-hovered .canvas-node-connection-point::after,
.canvas-node-connection-point:hover::after { opacity: 1; }
.canvas-wrapper.is-readonly .canvas-node-interaction-layer { display: none; }

.canvas-selection {
  position: absolute;
  top: 0;
  left: 0;
  border: calc(1px * var(--zoom-multiplier)) solid var(--interactive-accent);
  background-color: hsla(var(--accent-h, 258), var(--accent-s, 88%), var(--accent-l, 66%), 0.1);
  pointer-events: none;
}
.canvas-snaps { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.canvas-snaps line { stroke: var(--interactive-accent); stroke-width: calc(1px * var(--zoom-multiplier)); stroke-dasharray: calc(4px * var(--zoom-multiplier)); }

.canvas-card-menu {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: stretch;
  background-color: var(--background-primary);
  border-radius: var(--canvas-controls-radius, 4px);
  box-shadow: var(--input-shadow, inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.065));
  z-index: 3;
}
.theme-dark .canvas-card-menu { background-color: var(--background-secondary); }
.canvas-wrapper.is-readonly .canvas-card-menu { display: none; }
.canvas-card-menu-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  width: 48px;
  height: 48px;
  line-height: 1;
  color: var(--icon-color, var(--text-muted));
  cursor: grab;
}
.canvas-card-menu-button .svg-icon { width: 32px; height: 32px; stroke-width: 1.5px; transition: transform 90ms ease-out; }
.canvas-card-menu-button:hover { color: var(--icon-color-hover, var(--text-normal)); }
.canvas-card-menu-button:hover .svg-icon { transform: translateY(-2px); }

.canvas-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 3;
}
.canvas-control-group {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--canvas-controls-radius, 4px);
  box-shadow: var(--input-shadow, inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.065));
}
.canvas-control-item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  width: 32px;
  height: 32px;
  line-height: 1;
  color: var(--icon-color, var(--text-muted));
  background-color: var(--background-primary);
  cursor: var(--cursor, default);
}
.canvas-control-item:not(:last-child) { border-bottom: 1px solid var(--background-modifier-border); height: 33px; }
.canvas-control-item .svg-icon { width: var(--canvas-controls-icon-size); height: var(--canvas-controls-icon-size); stroke-width: var(--canvas-controls-icon-stroke); }
.canvas-control-item:hover { background-color: var(--background-modifier-hover); color: var(--icon-color-hover, var(--text-normal)); }
.canvas-control-item.is-disabled { color: var(--text-faint); pointer-events: none; }
.canvas-control-item.is-active { color: var(--icon-color-active, var(--interactive-accent)); }

.canvas-menu-container { position: absolute; z-index: 10; width: 0; height: 0; }
.canvas-menu-container.is-hidden { display: none; }
.canvas-menu {
  position: relative;
  display: flex;
  gap: 1px;
  padding: 2px;
  width: max-content;
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s, 4px);
  box-shadow: 0 2px 10px 0 rgba(0, 0, 0, 0.07);
}
.canvas-menu button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  width: 32px;
  height: 28px;
  border: 0;
  box-shadow: none;
  background: transparent;
  border-radius: var(--radius-s, 4px);
  color: var(--icon-color, var(--text-muted));
}
.canvas-menu button .svg-icon { width: 16px; height: 16px; }
.canvas-menu button:hover, .canvas-menu button.is-active { background-color: var(--background-modifier-hover); color: var(--icon-color-hover, var(--text-normal)); }
.canvas-submenu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  display: flex;
  gap: 4px;
  padding: 6px;
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s, 4px);
  box-shadow: 0 2px 10px 0 rgba(0, 0, 0, 0.07);
}
.canvas-color-picker-item {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: var(--canvas-color);
  border: 1px solid var(--background-modifier-border);
  cursor: var(--cursor, default);
}
.canvas-color-picker-item:not([class*="mod-canvas-color"]):not(.canvas-color-picker-custom) {
  background: linear-gradient(135deg, transparent 45%, var(--color-red, #e93147) 45%, var(--color-red, #e93147) 55%, transparent 55%), var(--canvas-background);
}
.canvas-color-picker-item.is-active { box-shadow: 0 0 0 2px var(--background-primary), 0 0 0 4px var(--interactive-accent); }
.canvas-color-picker-custom { background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); }
.canvas-color-picker-custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: var(--cursor, default); }
.canvas-help .canvas-help-row { display: flex; justify-content: space-between; gap: 24px; padding: 6px 0; border-bottom: 1px solid var(--background-modifier-border); font-size: var(--font-ui-small, 13px); }
.canvas-help .canvas-help-row kbd { font-family: var(--font-interface); font-size: var(--font-ui-smaller, 12px); padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-hover); }
body { --embed-canvas-max-height: 400px; }
.canvas-embed { position: relative; display: block; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px); overflow: hidden; }
.canvas-embed-content { position: relative; height: var(--embed-canvas-max-height); }
.canvas-embed .canvas-controls, .canvas-embed .canvas-card-menu, .canvas-embed .canvas-menu-container { display: none; }
.canvas-embed .markdown-embed-link { position: absolute; top: 6px; right: 6px; z-index: 5; padding: 4px; color: var(--icon-color, var(--text-muted)); opacity: 0; cursor: var(--cursor, default); }
.canvas-embed:hover .markdown-embed-link { opacity: 1; }
`;

export function installCanvasStyles(): void {
  injectStyle("bedrock-canvas-css", CSS);
}
