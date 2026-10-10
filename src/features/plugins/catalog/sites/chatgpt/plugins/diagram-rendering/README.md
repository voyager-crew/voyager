---
id: voyager.chatgpt-diagram-rendering
name: ChatGPT · Diagram rendering
category: readability
version: 1.0.0
author: voyager-official
license: GPL-3.0-or-later
matches:
  - https://chatgpt.com/*
  - https://chat.openai.com/*
engine: '>=1.7.0'
---

# ChatGPT · Diagram rendering

ChatGPT shows a Mermaid diagram it writes as a plain code block. With the
plugin on, each Mermaid block in a reply is drawn as a diagram, with the
renderer and detection Voyager uses on Gemini; a **Diagram / Code** toggle above
it brings the code back, and clicking the diagram opens it full screen. Blocks
labelled with another language stay code. Turning the plugin off removes the
diagrams and shows every code block again.

## How it works

The plugin contains no code of its own: it invokes Voyager's first-party
`mermaid` primitive through a `native` op, on the ChatGPT adapter's
`codeBlock` (`pre`) inside each `assistantTurn`. The language comes from the
block's `language-*` class; an unlabelled block is drawn only when its content
reads as a complete Mermaid diagram.

ChatGPT's code block is never moved or edited, so its copy button, text
selection and export keep working: the diagram sits in a panel just before it,
inside a shadow root, and the block is hidden with `data-gv-diagram-hidden`
only while the diagram view is chosen. The theme follows ChatGPT's light or dark
mode through `html[data-gv-scheme]`. ECharts and WaveDrom will join as more
`native` ops in this manifest.

- Requires Voyager plugin engine 1.7.0 or newer (`requires.handlers: ["mermaid"]`).
- Ships disabled; enable it from the popup on ChatGPT.

## Verification

- Page: pending a live check on a real ChatGPT conversation with a Mermaid block,
  including whether ChatGPT now draws Mermaid itself (the plugin must not draw a
  second copy).
- Target match count: pending (`document.querySelectorAll('[data-chatgpt-selection-message-id] pre').length`).
- Light theme: pending.
- Dark theme: pending.
- `bun run plugin:check src/features/plugins/catalog/sites/chatgpt/plugins/diagram-rendering`: passes.
- Popup health: pending.
