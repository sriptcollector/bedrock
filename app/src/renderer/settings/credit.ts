// "Inspired by Obsidian" credit (brand.json → inspiredBy), shown at the bottom of Settings › General.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { INSPIRED_BY } from "../../shared/brand";

export function renderCredit(el: HTMLElement): void {
  if (!INSPIRED_BY) return;
  const c = el.createDiv("bedrock-inspired-credit");
  // The original's logo is only shown if the lead has dropped the official file in (see brand.json).
  const logoUrl = new URL("inspired-by.svg", location.href);
  try {
    if (fs.existsSync(fileURLToPath(logoUrl))) c.createEl("img", { cls: "bedrock-inspired-logo", attr: { src: logoUrl.href, alt: `${INSPIRED_BY.name} logo`, width: "16", height: "16" } });
  } catch {
    /* no logo */
  }
  c.createSpan({ text: `Inspired by ${INSPIRED_BY.name}. ` });
  c.createSpan({ cls: "bedrock-inspired-note", text: INSPIRED_BY.notAffiliated });
}
