# Grok · Table Copy

Adds a small toolbar above each table in a Grok reply with two icon buttons:
**Copy table as Markdown** and **Copy table for spreadsheets (TSV)**. Grok has
no table copy of its own. This plugin contains no code of its own: it invokes
Voyager's first-party `tableCopy` primitive through a `native` op.

- Markdown is the table conversation export writes (`extractTable`), so a
  formula in a cell stays LaTeX (`$x^2$`) instead of KaTeX's flattened glyph
  text.
- TSV keeps formulas as LaTeX too, drops bold and code markers, and prefixes an
  apostrophe to a cell that starts with `=`, `+`, `-` or `@` (plain numbers
  excepted) so a spreadsheet pastes it as text rather than evaluating it.
- The table is never edited. Tables inside the thinking block and tables nested
  in another table get no toolbar. Turning the plugin off removes every toolbar.
- Requires Voyager plugin engine 1.8.0 or newer (`requires.handlers: ["tableCopy"]`).
- Ships disabled; enable it from the popup on Grok.

## Live check

2026-11-17, grok.com, DOM only (the extension itself was not loaded): a reply's
table was found under `assistantTurn`, its header and body rows read as a
3 × 3 table with the formula column as `$x^2$`, `$y^2$`, `$z^2$`, and the
toolbar markup, inserted before the table, sat at the top right of Grok's
table card in light and dark themes. Clicking the buttons and the copied toast
have not been seen on grok.com yet.
