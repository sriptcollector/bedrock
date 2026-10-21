// Injects a view's stylesheet once, right after the app stylesheet, so community themes and CSS
// snippets (added later in <head>) still override it.
const injected = new Set<string>();

export function injectStyle(id: string, css: string): void {
  if (injected.has(id) || typeof document === "undefined") return;
  injected.add(id);
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  const appLink = document.head.querySelector('link[href$="app.css"]');
  if (appLink) appLink.insertAdjacentElement("afterend", el);
  else document.head.prepend(el);
}
