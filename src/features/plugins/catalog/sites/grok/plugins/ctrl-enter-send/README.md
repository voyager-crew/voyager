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

The manifest uses `engine: ">=1.8.0"`, the `sendShortcut` floor.

While a reply is streaming, Grok shows its send button again as soon as the
composer holds text, and sending stops the running reply before the new message
goes out. Ctrl/⌘+Enter does the same as Grok's own Enter there. With an empty
composer Grok shows only its stop button, so Ctrl/⌘+Enter does nothing.

## Live check

2026-11-17, grok.com: Enter inserted a new paragraph and did not send, on the
home page and in a conversation. Ctrl+Enter sent exactly one message, both as
the first message of a new chat and inside a conversation. Ctrl+Enter during a
streaming reply stopped it and sent the new text once, matching Grok's own Enter
with the plugin off. File-upload states were not checked.
