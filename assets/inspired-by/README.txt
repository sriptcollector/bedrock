Obsidian logo for the "Inspired by Obsidian" credit
====================================================

The credit (Settings > General footer, About, welcome note, README header) shows Obsidian's
official logo small and unmodified next to the brand.json -> inspiredBy.notAffiliated sentence.
Until obsidian.svg exists here, the credit renders text-only ("Inspired by Obsidian.").

Source (checked 2026-10-21): Obsidian's public brand page, https://obsidian.md/brand
Official files linked from that page:
  Icon (gem):       https://obsidian.md/images/obsidian-logo-gradient.svg   <- save as obsidian.svg
  Logo + wordmark:  https://obsidian.md/images/obsidian-logo-text-purple.svg
                    https://obsidian.md/images/obsidian-logo-text-black.svg
                    https://obsidian.md/images/obsidian-logo-text-white-purple.svg
  Figma:            https://www.figma.com/community/file/1246118009912598137

Terms stated on the brand page (summary; see the page for the exact wording):
  - The Obsidian name, logo and app icon are trademarks.
  - Do not edit, change, distort, recolor or reconfigure the logo.
  - Single-colour use: the whole logomark black or white.
  - Commercial use of Obsidian assets: contact Obsidian first (address on the brand page).
  The page does not cover third-party "inspired by" credits specifically. Bedrock is free and
  non-commercial; if in doubt, ask Obsidian through the contact on the brand page.

The lead downloads the file (never extract it from the app). app/scripts/build.mjs copies it into
the build as renderer/inspired-by.svg when it is present.
