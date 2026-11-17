# Grok · Formula Copy

Click an inline or block formula on grok.com to copy its LaTeX. This plugin
contains no code of its own: it invokes Voyager's first-party `formulaCopy`
primitive through a `native` op, so the behaviour is the same as the built-in
formula copy on Claude and ChatGPT.

Grok renders math with KaTeX and keeps the source in the MathML
`<annotation encoding="application/x-tex">`; there is no `data-math`
attribute. Inline formulas are copied as the `.katex` element's source, and
display formulas as their `.katex-display` wrapper's.

- Requires Voyager plugin engine 1.3.0 or newer (`requires.handlers: ["formulaCopy"]`).
- Ships disabled; enable it from the popup on Grok.

## Live check

2026-11-17, grok.com, DOM only (the extension itself was not loaded): the
primitive's lookup and extraction, run in the page, returned the exact LaTeX
for every formula in a reply (`E=mc^2`, the quadratic formula as a display
formula, and the `x^2` formulas inside a table). The click and the copied
toast have not been seen on grok.com yet.
