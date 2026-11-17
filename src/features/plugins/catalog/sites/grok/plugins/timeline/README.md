# Grok · Timeline

A compact conversation timeline rail on grok.com with starred messages and
search. This plugin contains no code: it invokes Voyager's first-party
`turnNavigator` primitive through a `native` op. The conversation id and the
scroller come from the Grok site adapter (`conversationIdPattern` for
`/c/<uuid>`, `scrollContainer` for the `[role="log"]` transcript scroller).
Starred messages are stored under `grok:conv:<id>` and never mix with other
sites.

- Requires Voyager plugin engine 1.6.0 or newer (`requires.handlers: ["turnNavigator"]`).
- Ships disabled; enable it from the popup on Grok.
- Grok puts a screen-reader-only `<h2>You</h2>` at the start of every user
  message. Indexing the whole `userTurn` would label each marker
  "YouVoyager…", so the `turn` param points at the message text itself, the
  `[data-bubble-text]` span. A user message without that span (one that is
  only an attachment) is still indexed as a whole.
- Grok has no message navigator of its own on the right edge, so nothing is
  hidden.

Choose dots, compact or ruler in the popup’s Timeline style setting.

## Live check

2026-11-17, grok.com, DOM only (the extension itself was not loaded): on a
two-turn conversation the `turn` selector matched one span per user message
with the prompt text and nothing else, the `[role="log"]` scroller matched
`scrollContainer`, and setting its `scrollTop` brought each turn into view.
Grok renders the transcript as a virtual list (`data-plane-row`), so on long
conversations only the rows near the viewport are in the DOM. The rail itself
has not been seen on grok.com yet.
