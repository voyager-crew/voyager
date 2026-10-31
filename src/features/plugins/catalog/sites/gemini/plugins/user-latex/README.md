# Gemini · LaTeX in Your Messages

Renders the `$…$` and `$$…$$` LaTeX you type in your own Gemini messages. This
is Voyager's built-in Gemini user-message LaTeX rendering, packaged as an
official plugin: the manifest contains no code of its own and invokes the
first-party `userLatex` primitive through a `native` op, so it runs the same
renderer as the native module. Each rendered line keeps its source for export,
the timeline and copy, and turning the feature off puts the original text back.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Gemini, including Enterprise,
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the "Render LaTeX in my messages" switch in Voyager's Gemini
  settings (`gvUserLatexEnabled`, on by default). It has no switch or settings
  of its own; the native module reads the same key.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native module.

## Lines

`params.turn` is `p.query-text-line`, one line of a sent message, the element
the native module renders. `params.unit` is `turn`, so each line is rendered
whole, as the native module does: a quoted line (`> $x$`) still renders even
though Voyager's quote styling adds its own class and a hidden marker to it.
The site adapter's `userTurn` names the whole message bubble, which is why the
manifest names the line instead.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.

Requires the plugin engine that adds the `userLatex` `unit` param (`>=1.9.0`)
and the `userLatex` handler.
