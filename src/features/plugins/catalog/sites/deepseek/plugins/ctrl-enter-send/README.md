# DeepSeek · Ctrl/⌘+Enter to send

Makes **Enter insert a newline** and **Ctrl+Enter** (or **⌘+Enter** on macOS)
send from the DeepSeek composer. **Shift+Enter** keeps the site's normal behavior.
Enable this plugin from Voyager's popup; there are no additional settings.
Disabling it restores the site's normal keyboard handling immediately.

The plugin invokes Voyager's `sendShortcut` primitive with no params. Its contract
requires the adapter's `composer`, `composerRoot` and `sendButton` semantic keys.
The listener follows composer remounts during in-app navigation and ignores other
editable elements.

The shortcut clicks only the matching composer root's enabled send button. It
does nothing when that button is missing or disabled, or a file upload is pending;
there is no fallback Enter dispatch. IME composition is left alone, including
keydown events that report `isComposing` or key code 229. Plain Enter never sends.

This requires an extension update that ships `sendShortcut`. The manifest uses
`engine: ">=1.8.0"`; a catalog update alone cannot provide the primitive.

## Safe live checks needed

These checks edit an unsent draft only. Clear the draft after each check.

1. Load the updated extension on DeepSeek and enable the plugin. Confirm that the adapter finds the composer, its root and its send button.
2. In a new conversation, type two short words, press Enter between them and confirm they remain in the composer on separate lines. Confirm no message is sent.
3. Select part of an unsent draft and press Enter. Confirm the selection becomes a newline and the surrounding text stays intact. Clear the draft.
4. Click in the middle of a draft line and press Enter. Confirm the textarea inserts a newline at the caret, preserves the surrounding text and places the caret after the newline. Type more text, then clear the draft. No message may appear in the conversation.
5. Press Shift+Enter in an unsent draft. Confirm the site's usual newline behavior remains available. Clear the draft.
6. Use an IME to compose text and press Enter to confirm a candidate. Confirm the candidate is accepted without sending or adding an extra newline. Clear the draft.
7. Navigate to another conversation in the app and repeat the plain-Enter check in the remounted composer. Confirm other editable fields retain their normal keyboard handling.
8. Turn the plugin off and confirm its listener is removed. Compare Enter behavior with the site's normal behavior using an empty composer; do not send a draft during this check.
9. Repeat the safe draft checks in light and dark themes. Confirm no added controls or layout changes.

For DeepSeek, verify the textarea composer on chat.deepseek.com, including its custom disabled send button.

## Actual-send checks — maintainer approval required

Ctrl/⌘+Enter sends a real message. Obtain the maintainer's explicit approval of
the account, conversation and test text before running these checks.

1. In the approved conversation, type the approved text and press Ctrl+Enter. Confirm exactly one message is sent through the native send button.
2. On macOS, repeat with ⌘+Enter and separately confirm Ctrl+Enter. Confirm exactly one message for each approved draft.
3. With the send button disabled or absent, press Ctrl/⌘+Enter and confirm no send attempt or fallback key event occurs.
4. While an approved test file is uploading, press Ctrl/⌘+Enter. Confirm no message is sent; after upload completion and once the send button is enabled, send only if the maintainer has approved that action.

Live check (2026-10-11, no message sent): plain Enter in an empty composer, at
a caret between words and over a selected word inserted a newline into React's
draft with the caret after it; typed text kept it, native Shift+Enter still
added one, and clearing the draft disabled the send button. Ctrl/⌘+Enter sends
and upload indicators remain unverified until the maintainer approves a test
send.
