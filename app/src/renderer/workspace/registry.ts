// View registry: built-in views and plugin views register here the same way (registerView,
// registerExtensions). Extension point for graph/canvas/search/backlinks/... views.
import { Events } from "../api/events";
import type { View } from "./view";
import type { WorkspaceLeaf } from "./leaf";

export type ViewCreator = (leaf: WorkspaceLeaf) => View;

export class ViewRegistry extends Events {
  viewByType: Record<string, ViewCreator> = {};
  typeByExtension: Record<string, string> = {};

  registerView(type: string, creator: ViewCreator): void {
    if (this.viewByType[type]) throw new Error(`Attempting to register an existing view type "${type}"`);
    this.viewByType[type] = creator;
    this.trigger("view-registered", type);
  }

  unregisterView(type: string): void {
    delete this.viewByType[type];
    this.trigger("view-unregistered", type);
  }

  isViewRegistered(type: string): boolean {
    return !!this.viewByType[type];
  }

  getViewCreatorByType(type: string): ViewCreator | undefined {
    return this.viewByType[type];
  }

  registerExtensions(exts: string[], type: string): void {
    for (const e of exts) {
      const k = e.toLowerCase();
      if (this.typeByExtension[k] && this.typeByExtension[k] !== type) throw new Error(`Attempting to register an existing file extension "${e}"`);
      this.typeByExtension[k] = type;
    }
    this.trigger("extensions-updated");
  }

  unregisterExtensions(exts: string[]): void {
    for (const e of exts) delete this.typeByExtension[e.toLowerCase()];
    this.trigger("extensions-updated");
  }

  isExtensionRegistered(ext: string): boolean {
    return !!this.typeByExtension[ext.toLowerCase()];
  }

  getTypeByExtension(ext: string): string | undefined {
    return this.typeByExtension[ext.toLowerCase()];
  }
}
