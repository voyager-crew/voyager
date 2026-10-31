# Kimi · Site check

A tool for reporting that Voyager broke on Kimi. While the plugin is on, a small
**Site check** button sits near the bottom inline-end corner. It opens a panel
that lists every selector Voyager relies on for this page with its match count
right now: the site adapter's semantic keys, and for each running plugin the
keys it reads, the raw selectors of its DOM ops and primitive params, and the
`folders` rules of `site.json` when its primitive reads them. A visible key that
finds nothing reads **Found nothing**; a conversation-only key on another page
reads **Only in a chat**; raw selectors and folder rules carry no expectation
and read **Nothing, may be normal**.

The report holds the site id, the redacted route, the extension and browser
versions, the plugins on the page with their status, the selector table and the
picked element. It never holds message text, titles, account names or emails,
or a full URL. Enable it from Voyager's popup (off by default); there are no
settings.

The plugin invokes Voyager's `siteCheck` primitive with no params, so it needs
an extension that ships the primitive. The manifest uses `engine: ">=1.10.0"`.
