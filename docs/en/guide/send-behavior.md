# Send Behavior

::: info
**Note**: This feature is available in version 1.3.7 and later.
:::

Change the send shortcut to `Ctrl+Enter` (or `⌘+Enter` on macOS), turning `Enter` into a newline key so you can compose multi-line prompts with ease.

## Why This Feature

By default, pressing `Enter` sends the message immediately. When writing longer prompts, pasting multi-line code, or carefully formatting your input, this often leads to accidental sends — you just wanted a new line, but the message was already sent.

When enabled:

- **Enter** → Insert newline
- **Ctrl+Enter** (macOS: **⌘+Enter**) → Send message

Shift+Enter and IME composition keep the site's own behavior, and Ctrl/⌘+Enter waits while an attachment is still uploading.

## How to Enable

1. Open the Voyager popup.
2. Turn on **Input** → **Ctrl/Cmd+Enter to send**.

## Other Sites

- **AI Studio** works the other way around: turn on **Enter to send on AI Studio** to send with `Enter` and add a new line with `Ctrl/⌘+Enter`.
- **Claude, ChatGPT, DeepSeek, Kimi, and Grok**: open the Voyager popup on that site and turn on **Ctrl/⌘+Enter to send** in the **Plugins** card. See [All plugins](/en/guide/plugins) for each site's plugins.
- **Safari**: if Gemini needs Enter pressed twice to send, turn on **Fix Enter key on Safari**.

## Features

- **Zero Performance Overhead**: When disabled, no keyboard event listeners are active — no impact on page performance.
- **Instant Toggle**: Changes take effect immediately after toggling in settings, no page refresh needed.
