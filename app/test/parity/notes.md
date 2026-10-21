## Notes on the remaining differences

- **Accept an embed suggestion**: timing only. The original fills attachment suggestions a moment
  later than notes; when Enter arrives before that it keeps the typed text. With a longer wait both
  insert `![[mountain.png]]`.
- **Note embed + ArrowUp**: the original lands at the goal column inside the revealed `![[…]]`
  source; Bedrock lands at the start of the line (the embed widget is replaced until the cursor
  arrives).
- Not part of the table: "[[ with no query" ordering (depends on each vault copy's file times),
  and the first `[[^` block suggestion right after typing (the original reads the saved file,
  Bedrock reads the live editor text).

## Checked outside the key-sequence harness

| Behaviour | How it was checked | Result |
|---|---|---|
| 1 MB note: typing latency | `node test/parity/perf.mjs <port>`: one key every 120 ms, keydown to next painted frame | Bedrock p50 19 ms / p95 27 ms; original p50 30 ms / p95 35 ms (same machine, live preview) |
| 1 MB note: reading view | 2,000-section note | ~43 sections in the DOM (original ~29), pusher + estimated height, scroll renders the new window |
| Table editor DOM | CDP dump of both apps | same structure: `.cm-table-widget > .table-wrapper > table.table-editor`, cell `.table-cell-wrapper`, drag handles, `+` row/column buttons, nested editor in the active cell |
| Table cell menu | right-click in a cell, both apps | Add link / Add external link / Format / Paragraph (disabled) / Insert (disabled) / clipboard / Row / Column / Sort A→Z, Z→A; Row and Column submenus match |
| Editor context menu | right-click in text, both apps | same items and submenus (Format, Paragraph, Insert), "Search for …" and "Extract current selection..." with a selection |
| Export to PDF | modal fields compared with the original; export run in Bedrock | same fields, options and defaults; PDF written by the main process |
| Popout windows | "Move current tab to new window" in Bedrock | real window, same App/vault/cache, editor works, saved under `floating` in workspace.json |
| Link / tag / colour suggest DOM | CDP dump of both apps | `.suggestion-container > .suggestion > .suggestion-item(.mod-complex)`, title/note/aux, instructions footer |
