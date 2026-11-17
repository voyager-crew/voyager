# Grok · Reading Typography

Adjusts the text size, line height and paragraph spacing of Grok answers. The
controls match Voyager's Gemini font size and spacing settings: text size in
percent (80-150), and one spacing switch for line height (120-220 percent) and
paragraph spacing (0-24 px). Both switches are off by default, and a switch that
is off leaves its properties native.

Only the answer's markdown (`[data-markdown-row]` inside the assistant turn)
changes: paragraphs, list items and table cells. Grok renders all three at
15 px on a 24 px line, so each scales from 15 px and 125% makes them 18.75 px.
The size is absolute, so nested lists and tables never compound. Code blocks
keep their own size, block formulas stay native because KaTeX sizes them in em
outside the paragraphs, and the thinking block, user messages and the composer
are left alone. Grok spaces paragraphs 16 px on the bottom, which is the
spacing default.

Uses the Grok adapter's `assistantTurn` semantic key. No extra host permissions,
native handler, remote resources or new storage keys. Disabling the plugin
removes the scoped class, both switch attributes and the stylesheet.
