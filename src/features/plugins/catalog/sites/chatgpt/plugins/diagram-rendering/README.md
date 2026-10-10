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

ChatGPT shows an ECharts option or a WaveDrom timing diagram it writes as a
plain code block. With the plugin on, each such block in a reply is drawn with
the renderer and detection Voyager uses on Gemini; a **Diagram / Code** toggle
above it brings the code back. Blocks labelled with another language stay code.
Turning the plugin off removes the diagrams and shows every code block again.

- **ECharts**: a block labelled `echarts`, `echart` or `chart`, or an untagged
  one whose content is an ECharts option, is parsed (never evaluated), sanitized
  and drawn as an interactive chart. Its **Fullscreen** toolbar button opens it
  full screen, since clicks on the chart belong to its legend and tooltips.
- **WaveDrom**: a block labelled `wavedrom` or `wavejson`, or an untagged one
  whose content reads as WaveJSON, is drawn as a timing diagram on the light
  backdrop Gemini uses; clicking it opens it full screen. Invalid or unfinished
  WaveJSON stays code.

Mermaid is not part of this plugin: ChatGPT now draws Mermaid itself
(`[data-chatgpt-mermaid-preview]`) and leaves no code block behind, so a second
copy would only duplicate it. Voyager's `mermaid` primitive stays available for
other sites.

## How it works

The plugin contains no code of its own: two `native` ops invoke Voyager's
first-party `echarts` and `wavedrom` primitives on the ChatGPT adapter's
`codeBlock` (`[data-markdown-copy="code-block"]`, source in its `code`) inside
each `assistantTurn`. Both read the language from the header label
`[data-markdown-copy="exclude"] .truncate`. ChatGPT localizes the label of an
untagged block (纯文本, Texte brut, …), so the engine counts a label as a
language only when it is shaped like an id such as `echarts` or `json`;
anything else, and `text` / `plaintext`, leaves the block to content detection.

ChatGPT's code block is never moved or edited, so its copy button, text
selection and export keep working: the diagram sits in a panel just before it,
inside a shadow root, and the block is hidden with `data-gv-diagram-hidden`
only while the diagram view is chosen. The theme follows ChatGPT's light or dark
mode through `html[data-gv-scheme]`.

- Requires Voyager plugin engine 1.7.0 or newer (`requires.handlers: ["echarts", "wavedrom"]`).
- Ships disabled; enable it from the popup on ChatGPT.

## Verification

- Page: tagged blocks show `echarts` / `wavedrom` in the header label (live
  check); Mermaid is drawn by ChatGPT itself, with no code block left.
- Target match count: pending (`document.querySelectorAll('[data-chatgpt-selection-message-id] [data-markdown-copy="code-block"]').length`).
- ECharts and WaveDrom, light and dark theme: pending.
- `bun run plugin:check src/features/plugins/catalog/sites/chatgpt/plugins/diagram-rendering`: passes.
- Popup health: pending.
