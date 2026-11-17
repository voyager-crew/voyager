# Grok · Ctrl/⌘+Enter to send

Makes **Enter insert a newline** and **Ctrl+Enter** (or **⌘+Enter** on macOS)
send from the Grok composer. **Shift+Enter** keeps the site's normal behavior.
Enable this plugin from Voyager's popup; there are no additional settings.
Disabling it restores the site's normal keyboard handling immediately.

The plugin invokes Voyager's `sendShortcut` primitive with no params. Its
contract requires the adapter's `composer`, `composerRoot` and `sendButton`
semantic keys. Grok's composer is the contenteditable query-bar editor, its
root is the surrounding form, and its send control is
`button[data-testid="chat-submit"]`. The listener follows composer remounts
during in-app navigation and ignores other editable elements.

The shortcut clicks only the matching composer root's enabled send button. It
does nothing when that button is missing or disabled, or a file upload is
pending; there is no fallback Enter dispatch. IME composition is left alone,
including keydown events that report `isComposing` or key code 229. Plain Enter
never sends.

This requires an extension update that ships `sendShortcut`. The manifest uses
`engine: ">=1.8.0"`; a catalog update alone cannot provide the primitive.

## Live check

Pending on grok.com. Confirm the adapter finds the composer, its form and its
send button; that Enter inserts a newline and does not send; that Ctrl/⌘+Enter
clicks the send button only while it is enabled and no upload is pending; and
that turning the plugin off restores the site's keyboard handling. Grok's own
disabled and upload markers are not separately named in `site.json`, so those
states still need a check on the live page.
