// Sync UI styles, written from scratch on Obsidian's public variables and class names
// (.status-bar-item.plugin-sync, .sync-status-icon.mod-*, .mod-sync-history, .diff-line.mod-*).
// Injected once as a <style> so this module stays self-contained.
export const SYNC_CSS = `
.status-bar-item.plugin-sync { padding: 0 var(--size-2-2); cursor: var(--cursor); }
.status-bar-item.plugin-sync:hover { background-color: var(--background-modifier-hover); }
.sync-status-icon { display: flex; align-items: center; }
.sync-status-icon.mod-success { color: var(--text-success); }
.sync-status-icon.mod-working { color: var(--interactive-accent); }
.sync-status-icon.mod-error { color: var(--text-error); }
.sync-status-icon.mod-muted { color: var(--text-faint); }
.sync-status-icon.mod-working svg { animation: bedrock-sync-spin 1.4s linear infinite; }
@keyframes bedrock-sync-spin { to { transform: rotate(360deg); } }
.menu-item.sync-menu-status { color: var(--text-muted); max-width: 320px; white-space: normal; cursor: default; }
.menu-item.sync-menu-status .menu-item-title { white-space: normal; font-size: var(--font-ui-smaller); line-height: var(--line-height-tight); }

.modal.mod-sync-history { width: var(--dialog-max-width, 1100px); max-width: 92vw; height: 80vh; padding: 0; overflow: hidden; }
.mod-sync-history .modal-content { height: 100%; }
.sync-history { display: flex; height: 100%; min-height: 0; }
.sync-history-sidebar { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--background-modifier-border); background: var(--background-secondary); min-height: 0; }
.sync-history-file { display: flex; align-items: center; gap: var(--size-4-2); padding: var(--size-4-3) var(--size-4-3) var(--size-4-2); font-weight: var(--font-semibold); color: var(--text-normal); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sync-history-file-icon { display: flex; color: var(--text-muted); }
.sync-history-sidebar .search-input-container { margin: 0 var(--size-4-3) var(--size-4-2); }
.sync-history-sidebar .search-input-container input { width: 100%; }
.sync-history-list { flex: 1; overflow-y: auto; padding: 0 var(--size-4-2) var(--size-4-2); }
.sync-history-group { font-size: var(--font-ui-smaller); color: var(--text-faint); font-weight: var(--font-semibold); padding: var(--size-4-3) var(--size-4-2) var(--size-4-1); }
.sync-history-list-item { padding: var(--size-4-1) var(--size-4-2); border-radius: var(--radius-s); margin-bottom: 2px; cursor: var(--cursor); }
.sync-history-list-item:hover { background: var(--background-modifier-hover); }
.sync-history-list-item.is-active { background: var(--interactive-accent); color: var(--text-on-accent); }
.sync-history-list-item.is-active .sync-history-list-item-meta { color: var(--text-on-accent); opacity: 0.85; }
.sync-history-list-item-title { display: flex; align-items: center; gap: var(--size-4-2); font-size: var(--font-ui-small); }
.sync-history-list-item-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync-history-list-item-meta { font-size: var(--font-ui-smaller); color: var(--text-muted); }
.sync-history-badge { font-size: var(--font-ui-smaller); padding: 0 var(--size-2-2); border-radius: var(--radius-s); background: var(--background-modifier-hover); }
.sync-history-footer { display: flex; gap: var(--size-4-2); padding: var(--size-4-2) var(--size-4-3); border-top: 1px solid var(--background-modifier-border); }
.sync-history-footer button { flex: 1; }
.sync-history-content-container { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.sync-history-content-container .modal-setting-titlebar { display: flex; align-items: center; padding: var(--size-4-2) var(--size-4-4); padding-inline-end: 52px; border-bottom: 1px solid var(--background-modifier-border); min-height: 48px; }
.sync-history-content-container .modal-setting-title { flex-grow: 1; font-size: var(--font-ui-medium); font-weight: var(--font-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync-history-content-container .modal-setting-titlebar-toggle { display: flex; align-items: center; gap: var(--size-4-2); margin: 0 var(--size-4-3); font-size: var(--font-ui-small); }
.sync-history-content-container .modal-setting-titlebar-actions { display: flex; gap: var(--size-4-1); }
.sync-history-content { flex: 1; overflow: auto; padding: var(--size-4-4) var(--size-4-6); user-select: text; }
.sync-history-text { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-text); font-size: var(--font-text-size, 16px); line-height: var(--line-height-normal); background: none; border: none; padding: 0; }
.sync-history-content-empty, .sync-history-loading { color: var(--text-muted); padding: var(--size-4-4); text-align: center; font-size: var(--font-ui-small); }
.diff-view { user-select: text; font-family: var(--font-text); line-height: var(--line-height-normal); }
.diff-line { padding: 0 var(--size-4-2); white-space: pre-wrap; word-break: break-word; display: flex; }
.diff-line > .diff-sign { width: 1.2em; flex-shrink: 0; color: var(--text-faint); user-select: none; }
.diff-line.mod-left { background-color: color-mix(in srgb, var(--background-modifier-error) 20%, transparent); }
.diff-line.mod-left .diff-changed { background-color: color-mix(in srgb, var(--background-modifier-error) 45%, transparent); }
.diff-line.mod-right { background-color: color-mix(in srgb, var(--background-modifier-success) 20%, transparent); }
.diff-line.mod-right .diff-changed { background-color: color-mix(in srgb, var(--background-modifier-success) 45%, transparent); }

.modal.mod-sync-log { width: 760px; max-width: 92vw; }
.sync-log-toolbar { display: flex; gap: var(--size-4-2); justify-content: flex-end; margin-bottom: var(--size-4-2); }
.sync-log-container { max-height: 60vh; overflow-y: auto; font-size: var(--font-ui-small); user-select: text; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); }
.sync-log-item { display: flex; gap: var(--size-4-3); padding: var(--size-2-3) var(--size-4-3); border-bottom: 1px solid var(--background-modifier-border); }
.sync-log-item:last-child { border-bottom: none; }
.sync-log-time { color: var(--text-faint); flex-shrink: 0; width: 120px; }
.sync-log-text { word-break: break-word; }
.sync-log-item.mod-error .sync-log-text { color: var(--text-error); }
.sync-log-item.mod-conflict .sync-log-text { color: var(--text-warning); }

.bedrock-sync-excluded .sync-excluded-list { margin: var(--size-4-2) 0; }
.sync-exclude-folder { display: flex; align-items: center; gap: var(--size-4-2); padding: var(--size-4-1) var(--size-4-2); border-radius: var(--radius-s); }
.sync-exclude-folder:hover { background: var(--background-modifier-hover); }
.sync-exclude-folder-icon { display: flex; color: var(--text-muted); }
.sync-exclude-folder-name { flex: 1; }

.bedrock-sync-settings .sync-intro { color: var(--text-normal); margin: 0 0 var(--size-4-3); }
.bedrock-sync-settings .sync-signin-buttons { display: flex; justify-content: flex-end; gap: var(--size-4-2); margin-top: var(--size-4-4); }
.sync-usage-bar { margin-top: var(--size-4-2); height: 6px; border-radius: 3px; background: var(--background-modifier-border); overflow: hidden; max-width: 320px; }
.sync-usage-bar-fill { height: 100%; background: var(--interactive-accent); border-radius: 3px; }
.sync-usage-bar.mod-warning .sync-usage-bar-fill { background: var(--text-error); }
.bedrock-sync-settings .sync-config-note, .bedrock-sync-settings .sync-privacy-note { padding: 0 0 var(--size-4-3); }
.notice .sync-notice-actions { display: flex; gap: var(--size-4-2); margin-top: var(--size-4-2); }
`;

let injected = false;
export function injectSyncCss(): void {
  if (injected) return;
  injected = true;
  const st = document.createElement("style");
  st.id = "bedrock-sync-css";
  st.textContent = SYNC_CSS;
  // right after the default theme, so community themes and snippets (added later) win
  const base = document.head.querySelector('link[href="app.css"]');
  if (base) base.after(st);
  else document.head.prepend(st);
}
