# AI Studio · Formula Copy

Click an inline or block formula on AI Studio (`aistudio.google.com` and
`aistudio.google.cn`) to copy it. This is Voyager's built-in AI Studio formula
copy, packaged as an official plugin: the manifest contains no code of its own
and invokes the first-party `formulaCopy` primitive through a `native` op, so
the behaviour is the same service the native module runs.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. AI Studio pages
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the existing formula copy switch, copy format and selection
  conversion in Voyager's settings (`gvFormulaCopyEnabled`,
  `gvFormulaCopyFormat`, `gvFormulaCopySelectionLatex`). It has no switch or
  settings of its own. Gemini's formula copy (`voyager.gemini-formula-copy`)
  reads the same keys, so one switch, one format and one selection conversion
  apply to both sites.
- Needs no extra site access: Voyager's content script already runs on AI
  Studio.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.

Requires plugin engine 1.3.0 or newer (the `formulaCopy` primitive's floor).
