// Community plugin and theme browsers (Settings › Community plugins › Browse, Appearance › Themes ›
// Manage). One window per kind; reopened windows are focused.
import { CommunityBrowser } from "./browser";

const open: Partial<Record<"plugins" | "themes", CommunityBrowser>> = {};

export function openCommunityBrowser(app: any, kind: "plugins" | "themes", focusId?: string): CommunityBrowser {
  let b = open[kind];
  if (!b) b = open[kind] = new CommunityBrowser(app, kind);
  b.open(focusId);
  return b;
}
