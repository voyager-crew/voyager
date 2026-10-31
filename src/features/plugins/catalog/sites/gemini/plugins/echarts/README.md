# Gemini · ECharts charts

Shows ECharts code blocks in Gemini's replies as ECharts charts. This is
Voyager's built-in Gemini ECharts rendering, packaged as an official plugin: the
manifest contains no code of its own and invokes the first-party `echarts`
primitive through a `native` op.

A block labelled `echarts`, `echart` or `chart`, or an unlabelled one whose content is an ECharts option, is parsed (never evaluated), sanitized and drawn as an interactive chart. Its **Fullscreen** toolbar button opens it full screen, since clicks on the chart belong to its legend and tooltips.

## What it adds on Gemini

The primitive is called with Gemini's code block shape (language label
`.code-block-decoration > span`, source `code[data-test-id="code-content"]`)
and two options the native module's behaviour needs:

- `copyButton`: the diagram's toolbar gets a **Copy** button, because the
  diagram view hides Gemini's code block together with its own copy button.
  It copies the block's source text.
- `exportImage`: PNG and PDF exports carry the drawn diagram; Markdown keeps
  the fenced source. Exports carry a PNG of the chart. A block still drawing, shown as code, or whose
  plugin is off exports its source.

Gemini's code block is never moved or edited: the diagram sits in a panel just
before it, inside a shadow root, and the block is hidden with
`data-gv-diagram-hidden` only while the diagram view is chosen. Turning the
plugin off removes every panel and shows the code again.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. Gemini, including Enterprise,
  can receive page-locator fixes through the shared Online updates setting.
- Controlled by the ECharts switch in Voyager's Gemini settings (`gvEchartsEnabled`, on unless set
  to `false`). It has no switch or settings of its own.
- Needs no extra site access: Voyager's content script already runs on Gemini.
- Covers `gemini.google.com` only, like the native module. Gemini Enterprise
  (`business.gemini.google`) is outside its `matches`.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native module used to start.

Requires plugin engine `>=1.9.0` (the `copyButton` and `exportImage` params)
and the Gemini site adapter's `codeBlock` anchor.
