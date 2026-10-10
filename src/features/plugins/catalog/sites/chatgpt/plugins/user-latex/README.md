---
id: voyager.chatgpt-user-latex
name: ChatGPT · LaTeX in Your Messages
category: readability
version: 1.0.0
author: voyager-official
license: GPL-3.0-or-later
matches:
  - https://chatgpt.com/*
  - https://chat.openai.com/*
engine: '>=1.7.0'
---

# ChatGPT · LaTeX in Your Messages

ChatGPT renders math in its replies but leaves the LaTeX you type in your own
messages as raw text: "Is this $I_3$ the identity matrix?" shows `$I_3$`
(issue #1051). With the plugin on, `$…$` and `$$…$$` in your messages render
with KaTeX, as Voyager already does on Gemini. Dollar amounts such as `$5` and
`$10` stay text. Turning it off puts the original text back.

## How it works

The plugin contains no code of its own: it invokes Voyager's first-party
`userLatex` primitive through a `native` op, on the ChatGPT adapter's
`userTurn` (the `[data-user-message-bubble]` user bubble). Only text-only
elements inside the bubble are rendered; the composer, editable fields, code
and Voyager's own UI never are. Each rendered element keeps its source in
`data-user-latex-original`, so export, the timeline, stars and send times read
the LaTeX you typed rather than the rendered glyphs.

- Requires Voyager plugin engine 1.7.0 or newer (`requires.handlers: ["userLatex"]`).
- Ships disabled; enable it from the popup on ChatGPT.

## Verification

- Page: pending a live check on a real ChatGPT conversation.
- Target match count: pending (`document.querySelectorAll('[data-user-message-bubble]').length`).
- Light theme: pending.
- Dark theme: pending.
- `bun run plugin:check src/features/plugins/catalog/sites/chatgpt/plugins/user-latex`: passes.
- Popup health: pending.
