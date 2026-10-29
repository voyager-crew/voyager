# Prompt Manager on Claude

Wraps the existing Prompt Manager engine with the `promptManager` primitive.
The switch reads and writes this page host's entry in `gvPromptCustomWebsites`,
not `gvPluginsState`; existing coverage takes effect without a migration.
The panel, floating trigger, prompt library and preferences retain their behavior.

Turning coverage off unmounts the panel and its listeners. Gemini, AI Studio
and non-catalog custom websites keep their existing startup paths.
