// Tooltips: any element with a non-empty aria-label shows its label in a `.tooltip` (with a
// `.tooltip-arrow`) after a delay (1 s, or data-tooltip-delay), below it by default or where
// data-tooltip-position says (top / left / right add mod-top / mod-left / mod-right), kept inside
// the window. Moving straight from one tooltip to the next shows the next one at once.
// Works in the main window and in popout windows (installTooltips(doc)).

const DEFAULT_DELAY = 1000;
const HIDE_DELAY = 100;
const QUICK_SWITCH = 100;

let tipEl: HTMLElement | null = null;
let target: HTMLElement | null = null;
let showTimer: any = null;
let hideTimer: any = null;
let lastHidden = 0;
const installed = new WeakSet<Document>();

function labelOf(el: HTMLElement): string {
  return (el.getAttribute("aria-label") ?? "").trim();
}

export function hideTooltip(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (tipEl) {
    tipEl.remove();
    tipEl = null;
    lastHidden = Date.now();
  }
  target = null;
}

/** Show a tooltip for `el` now (obsidian API displayTooltip). */
export function showTooltip(el: HTMLElement, content: string | DocumentFragment, o: { placement?: string; classes?: string[]; gap?: number } = {}): void {
  hideTooltip();
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;
  const tip = doc.body.createDiv("tooltip");
  if (typeof content === "string") tip.setText(content);
  else tip.appendChild(content);
  const placement = o.placement ?? el.getAttribute("data-tooltip-position") ?? "bottom";
  if (placement !== "bottom") tip.addClass(`mod-${placement}`);
  for (const c of o.classes ?? (el.getAttribute("data-tooltip-classes") ?? "").split(" ").filter(Boolean)) tip.addClass(c);
  const arrow = tip.createDiv("tooltip-arrow");
  const gap = (o.gap ?? Number(el.getAttribute("data-tooltip-gap") || 8)) + (placement === "top" ? 5 : 0);
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const W = win.innerWidth;
  const H = win.innerHeight;
  let left: number;
  let top: number;
  if (placement === "top" || placement === "bottom") {
    left = r.left + r.width / 2 - t.width / 2;
    top = placement === "top" ? r.top - t.height - gap : r.bottom + gap;
    if (placement === "bottom" && top + t.height > H - 4) top = r.top - t.height - gap - 5;
  } else {
    top = r.top + r.height / 2 - t.height / 2;
    left = placement === "left" ? r.left - t.width - gap : r.right + gap;
  }
  const clampedLeft = Math.max(4, Math.min(left, W - t.width - 4));
  const clampedTop = Math.max(4, Math.min(top, H - t.height - 4));
  tip.style.left = `${Math.round(clampedLeft)}px`;
  tip.style.top = `${Math.round(clampedTop)}px`;
  // Keep the arrow pointing at the element when the box was shifted.
  if (placement === "top" || placement === "bottom") arrow.style.left = `${Math.round(r.left + r.width / 2 - clampedLeft)}px`;
  else arrow.style.top = `${Math.round(r.top + r.height / 2 - clampedTop)}px`;
  tipEl = tip;
  target = el;
}

export function installTooltips(doc: Document = document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  doc.addEventListener(
    "mouseover",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[aria-label]") as HTMLElement | null;
      if (!el || !labelOf(el) || el.hasAttribute("data-tooltip-disabled")) return;
      if (el === target) {
        clearTimeout(hideTimer);
        return;
      }
      clearTimeout(showTimer);
      const delay = Date.now() - lastHidden < QUICK_SWITCH || tipEl ? 0 : Number(el.getAttribute("data-tooltip-delay") ?? DEFAULT_DELAY);
      if (tipEl) hideTooltip();
      showTimer = setTimeout(() => {
        if (el.isConnected && el.matches(":hover")) showTooltip(el, labelOf(el));
      }, delay);
    },
    true,
  );
  doc.addEventListener(
    "mouseout",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[aria-label]") as HTMLElement | null;
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      clearTimeout(showTimer);
      if (el === target) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideTooltip, HIDE_DELAY);
      }
    },
    true,
  );
  // Clicks, keys and scrolling hide it.
  for (const t of ["mousedown", "keydown", "wheel"]) doc.addEventListener(t, () => hideTooltip(), true);
}
