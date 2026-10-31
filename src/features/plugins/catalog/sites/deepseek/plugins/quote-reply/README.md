# DeepSeek · Quote replies

Select text inside a single assistant reply to show **Quote** near the selection.
Click it, or focus it with the keyboard and activate it, to append the selected
text to the message composer as a Markdown quote. Each line starts with `> `;
an existing draft keeps its text and gets a blank line before the quote. The
composer receives focus with the caret at the end. No message is sent.

Enable this plugin from Voyager’s popup; there are no additional settings.
Selections in your own messages, thinking blocks, outside replies or across
multiple replies do not show the button. The button disappears when the
selection collapses, the page scrolls, Escape is pressed, an outside area is
pressed, the selected reply is re-rendered or the plugin is disabled. If the
composer is missing, a toast explains the problem and the selection stays intact.

The plugin invokes Voyager’s `quoteReply` primitive with no params. Its contract
requires the adapter’s `assistantTurn` and `composer` semantic keys. Formula text
is preserved as LaTeX where the reply renders KaTeX. Light and dark colors follow
Voyager’s resolved page theme, and the button supports RTL layouts.

This requires an extension update that ships `quoteReply`. The manifest uses
`engine: ">=1.8.0"`; a catalog update alone cannot provide the primitive.

## Live check

Chrome, dark theme, an existing conversation, nothing sent: selecting two
paragraphs of a reply shows one localized Quote button just below the
selection end; activating it fills an empty composer with `> ` lines ending in
a newline, focuses it and leaves the caret at the end. With an unsent draft the
quote follows a blank line. Selecting the user's own message shows no button,
and Escape hides it. Thinking blocks, formulas, RTL and keyboard activation were
not checked live; unit tests cover them.
