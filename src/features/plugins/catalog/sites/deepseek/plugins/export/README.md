# DeepSeek conversation export

Adds Voyager’s export toolbar to DeepSeek conversation pages. Select messages and
export JSON, Markdown, PDF or images using the shared conversation export flow.
The plugin is off by default and supports desktop browsers.

The `conversationExport` primitive reads DeepSeek’s virtual list from the semantic
`userTurn`, `assistantTurn` and `scrollContainer` selectors in `site.json`. It
collects message snapshots while scrolling and restores the scroll position after
reading. An uncertain or interrupted read warns that the export may be incomplete.

This plugin requires Voyager plugin engine `>=1.10.0`; the manifest contains
no site selectors or executable code.
