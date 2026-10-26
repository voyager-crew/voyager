# Gemini · Vim Input

Vim-style modal editing in the Gemini prompt input. This is Voyager's built-in
Gemini Vim input mode, packaged as an official plugin: the manifest contains no
code of its own and invokes the first-party `vimInput` primitive through a
`native` op, so it runs the same Vim implementation as the native module.

Editing starts in insert mode. Press `Escape` for normal mode, use motions such
as `h`, `l`, `w` and `b`, `v` for selection, or commands such as `x` and `u`,
then press `i` to return to insert mode.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Consumer Gemini
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the existing Vim input switch in Voyager's Gemini settings
  (`gvInputVimMode`, off by default). It has no switch or settings of its own.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native module.

## Composer

The manifest sets no `params.composer`, so the primitive reads the Gemini site
adapter's `composer` selector (`input-area-v2, rich-textarea, .text-input-field`)
and resolves the editable inside it, the same `rich-textarea .ql-editor` the
native module edits. The HUD then takes the native module's composer layout in
the bottom gutter of `.text-input-field`. A `composer` param that matched the
editor itself would switch the HUD to the floating layout used for other sites,
so this manifest leaves it out. The primitive still falls back to the shared
chat-input lookup when the adapter selector misses.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.

Requires plugin engine 1.4.0 or newer (the `vimInput` primitive's floor), the
`vimInput` handler and the site's `composer` semantic selector.
