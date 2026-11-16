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

`export.generating` is `button[data-testid="composer-stop"]`, the composer stop
button captured on grok.com on 2026-11-16. It is in the document only while a
reply is streaming. The virtual-DOM fallback treats that button as an
in-progress reply, and a finished crawl that never sees it can report itself
complete.

This plugin requires Voyager plugin engine `>=1.10.0`. The manifest contains
no site selectors or executable code.
