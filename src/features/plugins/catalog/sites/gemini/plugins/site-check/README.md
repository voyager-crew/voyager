# Gemini · Site check

A tool for reporting that Voyager broke on Gemini. While the plugin is on, a
small **Site check** button sits near the bottom inline-end corner. It opens a
panel that lists every selector Voyager relies on for this page with its match
count right now: the site adapter's semantic keys, and for each running plugin
the keys it reads, the raw selectors of its DOM ops and primitive params, and
the `folders` rules of `site.json` when its primitive reads them. A key that
should be on every page and finds nothing reads **Found nothing**; a
conversation-only key on another page reads **Only in a chat**; raw selectors
and folder rules carry no expectation and read **Nothing, may be normal**.

**Pick an element** outlines what the pointer is over; a click picks it and
Escape or Cancel leaves. The panel then adds which selectors match the picked
element and its ancestors, and its structure: tag names, class names (except
ones that carry content, such as a code block's language, and any inside a
message), `role`, a few ARIA states and `data-*` names, with values only for
structural attributes such as `data-testid` and for `true`/`false`. A pick
inside a drawing (an SVG, or a diagram Voyager drew) becomes the drawing,
shown by its tag alone. Text nodes and text-bearing attributes (`aria-label`,
`title`, `alt`, `placeholder`, `href`, `src`, `value`, …) are never read.

The preview shows exactly the Markdown that **Copy report** puts on the
clipboard; **Download .json** saves the same report; **Copy and open an
issue** copies it and opens the bug report form with only a short title,
summary and the extension and browser versions in the URL. The report holds
the site id, the route with every segment but the site's route words replaced by `:id`, the extension,
engine and browser versions, the plugins on the page with their status, the
selector table and the picked element. It never holds message text, titles,
account names or emails, or a full URL; a local plugin is named `local.#n`
and its selectors are withheld.

Turn it on with **Site check** in the Conversations card of Voyager's popup (off by default); the switch is stored as `gvSiteCheckEnabled`, shared by Gemini and AI Studio.

The plugin invokes Voyager's `siteCheck` primitive with no params, so it needs
an extension that ships the primitive. The manifest uses `engine: ">=1.10.0"`.
