# Gemini · Hide Input Halo

Hides the blue radial-gradient halo Gemini draws behind its chat input
(`chat-window::before`) and the blurred colour blobs above the fold
(`chat-loading-animation`, `.nl-canvas`). This is Voyager's built-in Gemini
halo hider, packaged as an official plugin.

## How it works

CSS only: `style.css` holds the same rules as the native module's copy in
`src/styles/contentStyle/`, without its `body.gv-hide-input-halo` gate. The
plugin's stylesheet is the scope instead: the engine adds it only while the
plugin runs and removes it on unmount. There are no DOM ops, so the plugin
adds no class, observer or health tracking to the page. The rules do not depend
on the light or dark theme.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Gemini, including Enterprise,
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the existing "Hide input box halo" switch in Voyager's Gemini
  settings (`gvInputHaloHidden`, off by default). It has no switch or settings
  of its own.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native module.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.
