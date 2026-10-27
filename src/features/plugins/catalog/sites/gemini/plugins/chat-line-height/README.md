# Gemini · Chat Spacing

Sets the line height and the paragraph spacing of Gemini's chat messages. Both
follow one switch, as they always have in Voyager's Gemini settings. This is
Voyager's built-in Gemini chat spacing setting, packaged as an official plugin.

## How it works

CSS only: `style.css` holds the rules of the two native modules
(`src/pages/content/chatLineHeight` and `chatParagraphSpacing`) with their
values replaced by the `lineHeight` (percent) and `paragraphSpacing` (px)
settings. Every selector keeps its `body` prefix, so its line height outranks
the 1.6 / 1.5 line heights of the chat font size rules whichever stylesheet is
injected first, and whichever of the two (plugin or native module) runs each
feature. The plugin's stylesheet is its scope: the engine adds it while the
plugin runs, rewrites it in place when a value changes, and removes it on
unmount. There are no DOM ops, so the plugin adds no class, observer or health
tracking to the page. The rules do not depend on the light or dark theme.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Gemini, including Enterprise,
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the existing chat spacing switch and sliders in Voyager's
  Gemini settings (`gvChatLineHeightEnabled`, off by default;
  `gvChatLineHeight`, 120–220 %, default 160; `gvChatParagraphSpacing`,
  0–24 px, default 12). Its settings are read from those sliders; the values
  saved for it in the plugin list are ignored.
- A stored value outside its range renders clamped. Unlike the native modules,
  the plugin never writes the clamped value back.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native modules.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.
