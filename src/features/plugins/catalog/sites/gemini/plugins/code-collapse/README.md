# Gemini · Code Block Collapse

Adds a collapse button to long Gemini code blocks (24 lines, or 520px of
rendered code), next to the block's copy button. This is Voyager's built-in
Gemini code block collapse, packaged as an official plugin: the manifest
contains no code of its own and invokes the first-party `codeCollapse`
primitive through a `native` op.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Consumer Gemini
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the "Collapse long code blocks" switch in Voyager's Gemini
  settings (`gvCodeBlockCollapseEnabled`, on by default). It has no switch or
  settings of its own; the native module reads the same key.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native module.

## Gemini behaviour

On the Gemini site adapter the primitive follows Gemini's own collapse rather
than its defaults for other sites, so `params` stays empty:

- every `codeBlock` on the page is a candidate, thinking included;
- long blocks stay expanded until you fold them, and there is no expand all /
  collapse all bar;
- the button joins `.code-block-decoration .buttons`, or the header when that
  row is missing;
- Mermaid and other diagram blocks are never collapsed;
- the clip and fade come from Voyager's content stylesheet, as before.

A block another code collapse already holds (a local plugin, or the native
module in a rollback build) is left to it until it lets go.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.

Requires the plugin engine that adds the Gemini policy (`>=next` until
release), the `codeCollapse` handler and the site's `assistantTurn` and
`codeBlock` semantic selectors.
