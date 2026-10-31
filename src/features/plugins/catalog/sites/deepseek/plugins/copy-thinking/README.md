# DeepSeek · Copy Thinking

Adds a small icon button, **Copy thinking**, above the thinking section of a
DeepSeek reply. A click copies the reasoning as plain text, line breaks kept,
and a toast confirms it (or says the browser refused the copy). This plugin
contains no code of its own: it invokes Voyager's first-party `copyButton`
primitive through a `native` op with `target: "thinkingBlock"`.

- The text is the thinking section's rendered text (the browser's `innerText`),
  trimmed. Voyager's own controls inside it are left out.
- The thinking section is never edited. A reply that streams or is re-rendered
  gets its button once it settles. Turning the plugin off removes every button.
- `target` is a `semanticKey` param, so the compatibility check requires the
  site to declare `thinkingBlock` without a `requires.semantic` entry.
- Requires the Voyager plugin engine that ships `copyButton` (`engine: ">=1.8.0"`).
- Ships disabled; enable it from the popup on DeepSeek.
