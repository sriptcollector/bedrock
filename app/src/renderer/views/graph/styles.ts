// Graph view stylesheet (our own, written on the public class and variable names themes use).
import { injectStyle } from "./inject-style";

const CSS = `
body {
  --graph-controls-width: 240px;
}
body.theme-light {
  --graph-line: #dadada;
  --graph-node: #5c5c5c;
  --graph-node-attachment: #e0ac00;
  --graph-node-focused: var(--text-accent, hsl(var(--accent-h), var(--accent-s), var(--accent-l)));
  --graph-node-tag: #08b94e;
  --graph-node-unresolved: #ababab;
  --graph-text: #222222;
  --slider-track-background: #dadada;
  --slider-thumb-border-color: #dadada;
}
body.theme-dark {
  --graph-line: #3f3f3f;
  --graph-node: #b3b3b3;
  --graph-node-attachment: #e0de71;
  --graph-node-focused: var(--text-accent, hsl(calc(var(--accent-h) - 3), calc(var(--accent-s) * 1.02), calc(var(--accent-l) * 1.15)));
  --graph-node-tag: #44cf6e;
  --graph-node-unresolved: #666666;
  --graph-text: #dadada;
  --slider-track-background: #3f3f3f;
  --slider-thumb-border-color: #3f3f3f;
}
.graph-view.color-fill { color: var(--graph-node); }
.graph-view.color-fill-focused { color: var(--graph-node-focused); }
.graph-view.color-fill-tag { color: var(--graph-node-tag); }
.graph-view.color-fill-attachment { color: var(--graph-node-attachment); }
.graph-view.color-fill-unresolved { color: var(--graph-node-unresolved); opacity: 0.5; }
.graph-view.color-fill-1, .graph-view.color-fill-2, .graph-view.color-fill-3,
.graph-view.color-fill-4, .graph-view.color-fill-5, .graph-view.color-fill-6 { color: var(--text-muted); }
.graph-view.color-arrow { color: var(--text-normal); opacity: 0.5; }
.graph-view.color-circle { color: var(--graph-node-focused); }
.graph-view.color-line { color: var(--graph-line); }
.graph-view.color-text { color: var(--graph-text); }
.graph-view.color-fill-highlight { color: var(--interactive-accent); }
.graph-view.color-line-highlight { color: var(--interactive-accent); }
.graph-view { position: absolute; width: 0; height: 0; pointer-events: none; }

.workspace-leaf-content[data-type="graph"] .view-content,
.workspace-leaf-content[data-type="localgraph"] .view-content {
  position: relative;
  overflow: hidden;
  padding: 0;
  background-color: var(--background-primary);
}
.workspace-leaf-content[data-type="graph"] .view-content > canvas,
.workspace-leaf-content[data-type="localgraph"] .view-content > canvas {
  position: absolute;
  inset: 0;
  display: block;
  touch-action: none;
}
.workspace-leaf-content[data-type="graph"] .view-content > canvas.graph-labels,
.workspace-leaf-content[data-type="localgraph"] .view-content > canvas.graph-labels {
  pointer-events: none;
}
.workspace-leaf-content[data-type="graph"] .view-content.is-hovering-node,
.workspace-leaf-content[data-type="localgraph"] .view-content.is-hovering-node { cursor: pointer; }

.graph-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  width: var(--graph-controls-width);
  max-height: calc(100% - 16px);
  overflow: auto;
  padding: 0;
  font-size: var(--font-ui-medium, 15px);
  color: var(--text-normal);
  background-color: var(--background-secondary);
  border: 1px solid var(--background-modifier-border-hover, #dadada);
  border-radius: var(--radius-m, 8px);
  box-shadow: var(--shadow-s);
  z-index: 2;
}
.graph-controls.is-close {
  width: auto;
  min-width: 0;
  padding: 6px;
  overflow: visible;
  background-color: var(--background-primary);
  border-color: transparent;
  box-shadow: none;
}
.graph-controls-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-s, 4px);
  color: var(--icon-color, var(--text-muted));
}
.graph-controls-button .svg-icon { width: 16px; height: 16px; opacity: 0.85; }
.graph-controls-button:hover { background-color: var(--background-modifier-hover); color: var(--icon-color-hover, var(--text-muted)); }
.graph-controls-button.mod-close { position: absolute; top: 6px; right: 8px; z-index: 1; }
.graph-controls-button.mod-reset { position: absolute; top: 6px; right: 36px; z-index: 1; }
.graph-controls-button.mod-open,
.graph-controls-button.mod-animate { display: none; }
.graph-controls.is-close > * { display: none; }
.graph-controls.is-close > .graph-controls-button.mod-open,
.graph-controls.is-close > .graph-controls-button.mod-animate {
  display: flex;
  position: static;
  width: auto;
  height: auto;
  padding: 4px 6px;
}
.graph-controls.is-close > .graph-controls-button.mod-open .svg-icon,
.graph-controls.is-close > .graph-controls-button.mod-animate .svg-icon { width: 16px; height: 16px; }
.graph-controls.is-close > .graph-controls-button.mod-animate { margin-top: 8px; }

.graph-control-section {
  padding: 6px 12px;
}
.graph-control-section:not(:last-child) {
  border-bottom: 1px solid var(--background-modifier-border-hover, #dadada);
}
.graph-controls .graph-control-section > .tree-item-self {
  position: relative;
  display: flex;
  align-items: baseline;
  padding: 4px 8px 4px 16px;
  margin: 0 0 2px;
  font-size: var(--font-ui-small, 13px);
  line-height: var(--line-height-tight, 1.3);
  color: var(--text-muted);
  border-radius: var(--radius-m, 8px);
  cursor: var(--cursor, default);
}
.graph-controls .graph-control-section > .tree-item-self:hover { background-color: var(--background-modifier-hover); }
.graph-controls .graph-control-section > .tree-item-self .tree-item-icon.collapse-icon {
  position: absolute;
  top: 4px;
  left: 16px;
  margin-left: -20px;
  width: 16px;
  height: calc(1.3em);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  opacity: 0.85;
  padding: 0;
  transform: none;
}
.graph-controls .graph-control-section > .tree-item-self .tree-item-icon .svg-icon {
  width: 10px;
  height: 10px;
  stroke-width: 4px;
  color: var(--text-faint);
  transition: transform 100ms ease-in-out;
  transform: rotate(90deg);
}
.graph-controls .graph-control-section.is-collapsed > .tree-item-self .tree-item-icon .svg-icon { transform: rotate(0deg); }
.graph-control-section-header {
  font-size: var(--font-ui-small, 13px);
  font-weight: var(--font-medium, 500);
  color: var(--text-normal);
}
.graph-controls .graph-control-section > .tree-item-children { padding: 4px 0; margin: 0; border: 0; }
.graph-controls .graph-control-section.mod-forces > .tree-item-children { padding-bottom: 16px; }
.graph-control-section.is-collapsed > .tree-item-children { display: none; }

.graph-controls .setting-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 6px 0;
  margin: 0 0 4px;
  border: 0;
  border-radius: 12px;
}
.graph-controls .setting-item-info { flex: 1 1 auto; display: flex; align-items: center; margin-right: 16px; min-width: 0; }
.graph-controls .setting-item-name { font-size: var(--font-ui-small, 13px); line-height: var(--line-height-tight, 1.3); color: var(--text-normal); }
.graph-controls .setting-item-description { display: none; }
.graph-controls .setting-item-control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }
.graph-controls .setting-item.mod-search-setting .setting-item-info { display: none; }
.graph-controls .setting-item.mod-search-setting .setting-item-control { flex: 1 1 auto; }
.graph-controls .setting-item.mod-search-setting .search-input-container { width: 100%; }
.graph-controls .setting-item.mod-slider { flex-direction: column; align-items: flex-start; gap: 0; }
.graph-controls .setting-item.mod-slider .setting-item-info { margin-right: 0; width: 100%; }
.graph-controls .setting-item.mod-slider .setting-item-control { width: 100%; padding-top: 12px; }
.graph-controls .slider-value { font-size: var(--slider-value-font-size, 13px); line-height: 1.3; color: var(--text-normal); font-variant-numeric: tabular-nums; }
.graph-controls .setting-item:not(.mod-slider):not(.mod-toggle):not(.mod-search-setting) .setting-item-info { display: none; }
.graph-controls .setting-item:not(.mod-slider):not(.mod-toggle):not(.mod-search-setting) .setting-item-control { flex: 1 1 auto; }
.graph-controls::-webkit-scrollbar { width: 8px; background: transparent; }
.graph-controls::-webkit-scrollbar-thumb { background: transparent; border-radius: 8px; }
.graph-controls:hover::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb-bg, rgba(0, 0, 0, 0.1)); }

.graph-controls .search-input-container { position: relative; }
.graph-controls .search-input-container::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  width: 16px;
  margin: auto 0;
  height: 16px;
  background-color: var(--search-icon-color, var(--text-muted));
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E");
  -webkit-mask-size: 16px 16px;
  -webkit-mask-repeat: no-repeat;
  pointer-events: none;
}
.graph-controls input[type="search"],
.graph-controls .graph-color-group input[type="text"] {
  width: 100%;
  height: var(--input-height, 30px);
  padding: 4px 8px 4px 30px;
  font-size: var(--font-ui-small, 13px);
  color: var(--text-normal);
  background-color: var(--background-modifier-form-field);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--input-radius, 5px);
  outline: none;
}
.graph-controls .graph-color-group input[type="text"] { padding: 4px 8px; width: 160px; flex: 0 0 160px; }
.graph-controls input[type="search"]::placeholder,
.graph-controls .graph-color-group input[type="text"]::placeholder { color: var(--input-placeholder-color, var(--text-faint)); }
.graph-controls input[type="search"]:focus,
.graph-controls .graph-color-group input[type="text"]:focus { border-color: var(--background-modifier-border-focus); box-shadow: 0 0 0 2px var(--background-modifier-border-focus); }
.graph-controls input[type="search"]::-webkit-search-cancel-button { display: none; }
.graph-controls .search-input-clear-button {
  position: absolute;
  top: 0;
  right: 2px;
  bottom: 0;
  width: 28px;
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--search-clear-button-color, var(--text-muted));
  cursor: var(--cursor, default);
}
.graph-controls .search-input-container.has-value .search-input-clear-button { display: flex; }
.graph-controls .search-input-clear-button::before {
  content: "";
  width: var(--search-clear-button-size, 13px);
  height: var(--search-clear-button-size, 13px);
  background-color: currentColor;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Ccircle cx='12' cy='12' r='11'/%3E%3Cpath d='M8 8l8 8M16 8l-8 8' stroke='white' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
}
.graph-controls .search-input-container.is-loading::after {
  content: "";
  position: absolute;
  right: 30px;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 50%;
  border: 2px solid var(--text-faint);
  border-top-color: transparent;
  animation: graph-spin 0.8s linear infinite;
}
@keyframes graph-spin { to { transform: rotate(360deg); } }

.graph-controls .checkbox-container {
  position: relative;
  width: var(--toggle-s-width, 34px);
  height: 19px;
  flex: 0 0 auto;
  border-radius: var(--toggle-radius, 18px);
  background-color: var(--background-modifier-border-hover, #dadada);
  box-shadow: inset 0 4px 10px rgba(0, 0, 0, 0.07);
  cursor: var(--cursor, default);
  transition: box-shadow 0.15s ease-in-out, outline 0.15s ease-in-out, border 0.15s ease-in-out, opacity 0.15s ease-in-out;
}
.graph-controls .checkbox-container input { position: absolute; opacity: 0; width: 16px; height: 16px; margin: 0; pointer-events: none; }
.graph-controls .checkbox-container::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: var(--toggle-s-thumb-width, 15px);
  height: var(--toggle-s-thumb-height, 15px);
  border-radius: var(--toggle-thumb-radius, 18px);
  background-color: var(--toggle-thumb-color, white);
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.1);
  transform: translateX(0);
  transition: transform 150ms ease-in-out;
}
.graph-controls .checkbox-container.is-enabled { background-color: var(--checkbox-color, var(--interactive-accent)); }
.graph-controls .checkbox-container.is-enabled::after { transform: translateX(15px); }

.graph-controls input.slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1 1 auto;
  min-width: 0;
  height: var(--slider-track-height, 4px);
  margin: 2px;
  padding: 0;
  border-radius: var(--radius-s, 4px);
  background: linear-gradient(to right,
    var(--slider-fill-background, var(--interactive-accent)) 0,
    var(--slider-fill-background, var(--interactive-accent)) calc(var(--slider-fill-ratio, 0) * 100%),
    var(--slider-track-background, #dadada) calc(var(--slider-fill-ratio, 0) * 100%));
  outline: none;
  cursor: var(--cursor, default);
}
.graph-controls input.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: var(--slider-thumb-width, 18px);
  height: var(--slider-thumb-height, 18px);
  border-radius: var(--slider-thumb-radius, 18px);
  background: var(--slider-thumb-background, white);
  border: var(--slider-thumb-border-width, 0.5px) solid var(--slider-thumb-border-color, #dadada);
  box-shadow: var(--slider-thumb-shadow, 0 0 2px 0 rgba(0, 0, 0, 0.1), 0 2px 6px 0 rgba(0, 0, 0, 0.1));
  transition: all 100ms linear;
  cursor: var(--cursor, default);
}

.graph-controls button {
  font-size: var(--font-ui-small, 13px);
  height: var(--input-height, 30px);
  padding: 4px 12px;
}
.graph-color-groups-container { position: relative; }
.graph-color-group { position: relative; display: flex; align-items: center; padding: 0 0 6px; transition: top 200ms ease-in-out; }
.graph-color-group input[type="color"] {
  width: 22px;
  height: 18px;
  margin: 0 2px 0 6px;
  padding: 0;
  border: 0;
  background: none;
  cursor: var(--cursor, default);
}
.graph-color-group input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.graph-color-group input[type="color"]::-webkit-color-swatch { border: 0; border-radius: var(--radius-s, 4px); }
.graph-color-group .clickable-icon { display: flex; align-items: center; justify-content: center; padding: 4px; width: 24px; height: 24px; border-radius: var(--radius-s, 4px); color: var(--icon-color, var(--text-muted)); }
.graph-color-group .clickable-icon .svg-icon { width: 16px; height: 16px; opacity: 0.85; }
.graph-color-button-container { margin: 0 0 10px; }
.graph-color-button-container button { width: 100%; }
.graph-color-group.drag-ghost { position: fixed; z-index: 1000; pointer-events: none; opacity: 0.8; }
.graph-controls .tree-item-children.is-grabbing .graph-color-group { position: relative; }
`;

export function installGraphStyles(): void {
  injectStyle("bedrock-graph-css", CSS);
}
