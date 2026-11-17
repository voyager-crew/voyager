# Grok · Comfortable Reading Width

Gives Grok one centered, adjustable reading column (600-1600 px, default
1000 px). Grok sizes its conversation column, the user bubble and the composer
from a single page width, 800 px natively; this plugin replaces that width, so
all three move together and the composer stays lined up under the column. The
sidebar keeps its native size. A width larger than the chat area is capped by
Grok's own layout, which keeps its side gutters.

Disable the plugin to restore the native 800 px width. The width is a normal
Voyager plugin setting and is stored with the rest of the plugin state.

The width is Grok's `--grok-page-max-width` variable, which Grok writes inline
on its `[data-chat-width]` wrapper; the plugin overrides it from a stylesheet
while a `gv-plugin-grok-readable` class is on `<body>`. Grok's own text-column
setting writes the same variable, so the plugin wins while it is on.

Live check (2026-11-17, grok.com, 1700 px window): at 1000 px the answer text
was 930 px wide and the composer 964 px, both centered; at 1600 px both stopped
at the chat area with about 40 px gutters and no horizontal scroll.

This is a declarative plugin: pure CSS and a typed setting interpreted by
Voyager's bundled plugin engine. It does not execute remote JavaScript or load
external resources.
