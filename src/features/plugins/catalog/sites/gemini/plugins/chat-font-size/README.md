# Gemini · Chat Font Size

Sets the text size of Gemini's chat messages, user turns and replies alike.
Code blocks follow at 0.875 of the chosen size. This is Voyager's built-in
Gemini chat font size setting, packaged as an official plugin.

## How it works

CSS only: `style.css` holds the native module's rules
(`src/pages/content/chatFontSize`) with the size replaced by the `fontSize`
setting. The sizes are percentages, so an element nested in another matched
one (a paragraph inside `message-content`) compounds them, exactly as the
native module always has. The plugin's stylesheet is its scope: the engine adds
it while the plugin runs, rewrites it in place when the size changes, and
removes it on unmount. There are no DOM ops, so the plugin adds no class,
observer or health tracking to the page. The rules do not depend on the light
or dark theme.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Gemini, including Enterprise,
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the existing chat font size switch and slider in Voyager's
  Gemini settings (`gvChatFontSizeEnabled`, off by default; `gvChatFontSize`,
  80–150 %, default 100). Its `fontSize` setting is read from that slider; the
  value saved for it in the plugin list is ignored.
- A stored size outside 80–150 renders clamped. Unlike the native module, the
  plugin never writes the clamped value back.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native module.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.
