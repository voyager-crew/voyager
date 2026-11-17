# Grok · Quote replies

Select text inside a single assistant reply to show **Quote** near the
selection. Click it, or focus it with the keyboard and activate it, to append the
selected text to the message composer as a Markdown quote. Each line starts
with `> `; an existing draft keeps its text and gets a blank line before the
quote. The composer receives focus with the caret at the end. No message is sent.

Enable this plugin from Voyager's popup; there are no additional settings.
Selections in your own messages, thinking blocks, outside replies or across
multiple replies do not show the button. The button disappears when the
selection collapses, the page scrolls, Escape is pressed, an outside area is
pressed, the selected reply is re-rendered or the plugin is disabled. If the
composer is missing, a toast explains the problem and the selection stays intact.

The plugin invokes Voyager's `quoteReply` primitive with no params. Its contract
requires the adapter's `assistantTurn` and `composer` semantic keys. Grok's
adapter also declares `thinkingBlock`, so a selection that touches that block
shows nothing. Formula text is preserved as LaTeX where the reply renders KaTeX.
Light and dark colors follow Voyager's resolved page theme, and the button
supports RTL layouts.

Grok renders saved replies with a source newline between paragraphs. Voyager
skips whitespace next to a block, so each paragraph becomes one quote line
without blank quote lines in between. Releases before that fix add two blank
quote lines at each paragraph break of a reloaded reply. The quote still works,
so the manifest keeps the `quoteReply` floor, `engine: ">=1.8.0"`.

## Live check

2026-11-17, grok.com, light and dark themes: **Quote** appeared at the end of a
selection in a reply, beside Grok's own selection bar without overlapping it.
Clicking it put the quote into the query-bar editor as separate paragraphs with
the caret at the end, and nothing was sent. On a reloaded reply with source
newlines between paragraphs, a two-paragraph selection gave two `> ` lines and
no blank quote lines.
