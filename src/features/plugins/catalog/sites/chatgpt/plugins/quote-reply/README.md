# ChatGPT · Quote replies

Select text inside a single assistant reply to show **Quote** near the selection.
Click it, or focus it with the keyboard and activate it, to append the selected
text to the message composer as a Markdown quote. Each line starts with `> `;
an existing draft keeps its text and gets a blank line before the quote. The
composer receives focus with the caret at the end. No message is sent.

Enable this plugin from Voyager’s popup; there are no additional settings.
Selections in your own messages, outside replies or across multiple replies do
not show the button. The button disappears when the selection collapses, the
page scrolls, Escape is pressed, an outside area is
pressed, the selected reply is re-rendered or the plugin is disabled. If the
composer is missing, a toast explains the problem and the selection stays intact.

The plugin invokes Voyager’s `quoteReply` primitive with no params. Its contract
requires the adapter’s `assistantTurn` and `composer` semantic keys. Formula text
is preserved as LaTeX where the reply renders KaTeX. Light and dark colors follow
Voyager’s resolved page theme, and the button supports RTL layouts.

This requires an extension update that ships `quoteReply`. The manifest uses
`engine: ">=1.8.0"`; a catalog update alone cannot provide the primitive.

## Live check

Chrome, light theme, an existing conversation, nothing sent: selecting reply
text shows one localized Quote button; activating it inserts the quote as
paragraphs inside ChatGPT's editor (`> ` stays literal text, not a blockquote),
focuses it and leaves the caret on the empty line after the quote. Quoting again
into that draft adds the next quote after a blank line. Selecting the user's own
message shows no button. Clearing the composer and reloading leaves it empty, so
ChatGPT's own draft storage keeps nothing behind. ChatGPT's site adapter declares
no thinking block, so reasoning panes are not excluded; formulas, RTL and
keyboard activation were not checked live.
