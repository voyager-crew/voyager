# Kimi conversation export

Adds Voyager's export toolbar to Kimi conversation pages. Select messages and
export JSON, Markdown, PDF or images using the shared conversation export flow.
The plugin is off by default and supports desktop browsers.

The `conversationExport` primitive reads Kimi's virtual conversation list from
the semantic `userTurn`, `assistantTurn` and `scrollContainer` selectors in
`site.json`. Each message's stable key is the `data-archer-id` attribute on its
`.chat-content-item` parent; loaded history stays in the DOM as the reader
scrolls up. Kimi exposed no generation-in-progress marker during the selector
survey, so the descriptor declares no `generating` selector and the reader
reports completeness as unknown rather than guessed. The scroll position is
restored after reading.

This plugin requires Voyager plugin engine `>=1.10.0`; the manifest contains
no site selectors or executable code.
