---
id: voyager.chatgpt-reading-width
name: ChatGPT · Comfortable Reading Width
category: readability
version: 1.1.0
author: voyager-official
license: MIT
matches:
  - https://chatgpt.com/*
  - https://chat.openai.com/*
engine: '>=1.2.0'
settings:
  width: 'number (600–1600, default 768) — max reading width in pixels'
---

# ChatGPT · Comfortable Reading Width

Gives ChatGPT one **centered, adjustable reading column**. By default ChatGPT
caps every conversation turn — and the composer — at a fixed width, so the
thread feels narrow on large displays. This plugin widens that single centered
column.

## The fix

- ChatGPT sizes turns and the input box from the CSS variable
  `--thread-content-max-width` (`48rem` / 768px), consumed through the Tailwind
  utility `max-w-(--thread-content-max-width)`. The plugin applies the chosen
  width to those containers and centers the width-limited column containing
  the composer. It recognizes ChatGPT's legacy, unified, and tagged composer
  forms while leaving the full-width footer alone.

## Adjustable

Exposes a **width** setting (600–1600 px, default **768** — ChatGPT's native
width). In the Voyager popup the plugin shows a slider; dragging it updates the
width live. The value is substituted into the CSS (`max-width: {{width}}px`) by
Voyager's bundled engine.

This is a **declarative** plugin: pure CSS + a typed setting, interpreted by
Voyager's engine. No executable code.
