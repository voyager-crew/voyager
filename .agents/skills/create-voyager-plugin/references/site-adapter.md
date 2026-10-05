# Site adapter

Read this for the selected path; shared constraints and PR evidence remain in [SKILL.md](../SKILL.md).

**(b) Site adapter change.** `catalog/sites/<site>/site.json`: `matches`, the
semantic `selectors`, `theme`, `brandColor`, `capabilities`,
`conversationIdPattern`, `turnKeyAttributes` (attributes that keep a user
message's identity across remounts; leave them out unless the host has them).
Pick this when the site redesigned and every plugin on
it now misses, or when a key the vocabulary already names is absent. A fix to an
existing site reaches users through the per-host catalog. A **new** site does
not: host permission and content-script registration ship inside the package, so
a new `site.json` needs an extension release (plan D16).

## Implementation

For an existing-site selector fix, edit `catalog/sites/<site>/site.json`; the TypeScript adapters
for plugin platforms are one-line shells over the JSON. Only keys from
`src/features/plugins/sites/semanticKeys.ts` are accepted, and a key the site
cannot honestly provide is **left out**, not filled with a guess: a wrong
selector fails silently on every plugin that trusts it, while a plugin that
names a key the site leaves out shows `needs-semantic` in the popup, which is
the honest outcome. Every selector must parse; the site file's validation
rejects one that does not before it can throw in the page. Widening `matches`
widens every plugin under that site, so recheck each one still stays inside it.

`theme` and `brandColor` are what let a new site inherit Voyager's existing UI
untouched: the first is translated into the `data-gv-scheme` root attribute every
light/dark rule keys off, the second into the `--gv-pm-brand*` variables every
accent reads. Both are data, so getting them right here is the whole theme
adaptation — no per-site CSS follows.

A new site also needs its directory, a `CODEOWNERS` line, and an extension
release (D16).

```bash
bun run plugin:check src/features/plugins/catalog/sites/<site>/plugins/<id>   # each plugin
bun run test src/features/plugins
bun run catalog:build
```

Use these focused checks while developing; the final PR verification in `SKILL.md` covers unchanged checks already run.

## Complete when

- **Site adapter change**: every semantic key in `site.json` is one the site
  genuinely provides, every plugin under the site still passes `plugin:check`
  and stays inside the new `matches`, the suite and `catalog:build` pass, and
  live checks show the affected plugins still working on the real site. A new site
  additionally has its CODEOWNERS line and is scheduled into a release.
