# Prompt Manager on Grok

Wraps the existing Prompt Manager engine with the `promptManager` primitive.
The switch reads and writes this page host's entry in `gvPromptCustomWebsites`,
not `gvPluginsState`; existing coverage takes effect without a migration.
The panel, floating trigger, prompt library and preferences retain their behavior.

The primitive takes no params and reads no semantic keys. Inserting a prompt
uses Voyager's chat-input finder. Grok is not a packaged input-locator site, so
that finder uses the generic candidate list; the adapter's `composer` is a
`contenteditable` textbox, which is one of those candidates.

Turning coverage off unmounts the panel and its listeners. Gemini, AI Studio
and non-catalog custom websites keep their existing startup paths.

Live check: pending on grok.com (the floating trigger, opening the panel, and
inserting a saved prompt into the query-bar editor without sending).
