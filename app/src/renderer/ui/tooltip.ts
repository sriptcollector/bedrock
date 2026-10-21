// Tooltips: any element with an aria-label shows it in a small dark bubble after a short hover
// (data-tooltip-position: top | bottom | left | right, default bottom). Also backs the API's
// setTooltip / displayTooltip. One tooltip per document (the settings popout has its own).

type Placement = "top" | "bottom" | "left" | "right";

const SHOW_DELAY = 500;
const GAP = 8;
const installed = new WeakSet<Document>();

interface State {
  el: HTMLElement | null;
  target: HTMLElement | null;
  timer: number | null;
  lastHide: number;
}
const states = new WeakMap<Document, State>();

function state(doc: Document): State {
  let s = states.get(doc);
  if (!s) states.set(doc, (s = { el: null, target: null, timer: null, lastHide: 0 }));
  return s;
}

export function hideTooltip(doc: Document = document): void {
  const s = state(doc);
  if (s.timer !== null) doc.defaultView?.clearTimeout(s.timer);
  s.timer = null;
  if (s.el) {
    s.el.remove();
    s.el = null;
    s.lastHide = Date.now();
  }
  s.target = null;
}

export function showTooltip(target: HTMLElement, content: string | DocumentFragment, placement?: Placement): void {
  const doc = target.ownerDocument;
  const win = doc.defaultView ?? window;
  hideTooltip(doc);
  if (!target.isConnected || (typeof content === "string" && !content.trim())) return;
  const s = state(doc);
  const pos: Placement = placement ?? ((target.getAttribute("data-tooltip-position") as Placement) || "bottom");
  const el = doc.createElement("div");
  el.className = `tooltip mod-${pos}`;
  if (typeof content === "string") el.append(content);
  else el.appendChild(content);
  const arrowEl = doc.createElement("div");
  arrowEl.className = "tooltip-arrow";
  el.appendChild(arrowEl);
  doc.body.appendChild(el);
  const r = target.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  let x = 0;
  let y = 0;
  if (pos === "right") {
    x = r.right + GAP;
    y = r.top + r.height / 2 - t.height / 2;
  } else if (pos === "left") {
    x = r.left - GAP - t.width;
    y = r.top + r.height / 2 - t.height / 2;
  } else if (pos === "top") {
    x = r.left + r.width / 2 - t.width / 2;
    y = r.top - GAP - t.height;
  } else {
    x = r.left + r.width / 2 - t.width / 2;
    y = r.bottom + GAP;
  }
  // Keep inside the window; the arrow keeps pointing at the target.
  const cx = Math.max(4, Math.min(x, win.innerWidth - t.width - 4));
  const cy = Math.max(4, Math.min(y, win.innerHeight - t.height - 4));
  el.style.left = cx + "px";
  el.style.top = cy + "px";
  const arrow = arrowEl;
  if (pos === "top" || pos === "bottom") arrow.style.left = r.left + r.width / 2 - cx + "px";
  else arrow.style.top = r.top + r.height / 2 - cy + "px";
  s.el = el;
  s.target = target;
}

export function installTooltips(doc: Document = document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  const win = doc.defaultView ?? window;
  doc.addEventListener(
    "mouseover",
    (e) => {
      const s = state(doc);
      const t = (e.target as Element | null)?.closest?.("[aria-label]") as HTMLElement | null;
      if (!t || t === s.target) return;
      if (t.closest(".tooltip, .menu, .suggestion-container") || t.hasAttribute("data-tooltip-disabled")) return;
      const label = t.getAttribute("aria-label") ?? "";
      if (!label.trim()) return;
      const quick = !!s.el || Date.now() - s.lastHide < 300;
      hideTooltip(doc);
      s.target = t;
      s.timer = win.setTimeout(() => {
        s.timer = null;
        if (t.isConnected && t.matches(":hover")) showTooltip(t, t.getAttribute("aria-label") ?? "");
      }, quick ? 0 : Number(t.getAttribute("data-tooltip-delay") ?? SHOW_DELAY));
    },
    true,
  );
  doc.addEventListener(
    "mouseout",
    (e) => {
      const s = state(doc);
      if (!s.target) return;
      const to = e.relatedTarget as Node | null;
      if (to && s.target.contains(to)) return;
      if ((e.target as Node) === s.target || s.target.contains(e.target as Node)) hideTooltip(doc);
    },
    true,
  );
  for (const ev of ["mousedown", "wheel", "keydown"]) doc.addEventListener(ev, () => hideTooltip(doc), true);
  win.addEventListener("blur", () => hideTooltip(doc));
}
