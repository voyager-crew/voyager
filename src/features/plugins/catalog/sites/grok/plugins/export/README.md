# Grok conversation export

Adds Voyager's export toolbar to Grok conversation pages. Select messages and
export JSON, Markdown, PDF or images using the shared conversation export flow.
The plugin is off by default and supports desktop browsers.

The manifest only invokes `conversationExport`. It does not fetch anything. On
an open `https://grok.com/c/<uuid>` conversation the packaged reader asks
grok.com for that conversation's response tree and message bodies, keeps the
branch named by the `rid` query (or the newest leaf), and does not scroll the
page. If that read is not a 2xx response, does not have the expected shape, or
times out, the same export reads the virtual transcript instead:
`read: "virtual"`, `messageKey: "data-plane-row"`, scroller
`div[data-testid="chat-transcript-scroller"]`.

`export.generating` is omitted. The 2026-11-15 capture did not include a stop
control, so a DOM read cannot claim to be complete. `GROK_GENERATING_SELECTOR_PLACEHOLDER`
in `grokConversation.ts` is the marker for that gap. It is the string
`UNVERIFIED`, not a selector, and must not be copied into `site.json`.

This plugin requires Voyager plugin engine `>=1.10.0`. The manifest contains
no site selectors or executable code.
