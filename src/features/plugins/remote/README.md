# Remote host catalog (`remote/`)

Part of the [Plugin ecosystem overview](../README.md).

The official CSS/JSON plugins ship as a snapshot inside the extension, and the
same data is published per site at `<base>/hosts/<host>.json` (default base
`https://voyager.nagi.fun/catalog`, so DeepSeek is
`https://voyager.nagi.fun/catalog/hosts/chat.deepseek.com.json`). A selector fix
can therefore reach users without a store release, while the engine that reads
the data still ships in the package. The host file's optional `site` section is
adapter data validated by the same `validateSiteAdapterData`. It replaces the bundled
adapter only when its `catalogRevision` is strictly newer; ties and unstamped remote data
prefer the bundle. `scripts/build-plugin-catalog.ts` and production browser builds use the same
full-history first-parent Git source revision. Publishing the same commit ties its bundle,
and rebuilding older source cannot make it newer. `generatedAt` remains a diagnostic
publication timestamp. Production browser builds and catalog publication require full history;
shallow checkouts fail clearly rather than stamping a truncated revision. Dev builds and Vitest
stamp the bundle as 0, so any stamped remote adapter wins. Production Pages builds and deploys
run only from main, publishing the docs and catalog together. Source ordering assumes the
append-only main publication lineage; uncommitted production data carries HEAD’s revision. Cache reads do not rewrite or clear older entries, and plugin-list
authority and kill-switch rules are unchanged. A newer `site.json` fix can still travel
without an extension release.

- **`remote/HostCatalogSource.ts`** — a read-only `PluginSource`
  (`kind: 'remote'`). `list({ host })` serves whatever the cache holds for that
  host and never touches the network, so page loads, popup opens and
  catalog-change reloads all stay local. It is authoritative for a host only
  when the cached entry is a successful fetch written by the running extension
  version.
- **`remote/hostCatalogRefresh.ts`** — the only network writer, and it runs in
  the background only. Single flight per host, so concurrent tabs share one
  pass. Gates in order: the build flag; the host shape (plain hostnames, no
  wildcards or ports); the user settings (online-updates switch, check interval
  counted from the last attempt, failure backoff, writer-version staleness); and
  page eligibility, meaning at least one **enabled** plugin targets the host.
  Gemini and AI Studio are never catalog hosts (`isEligibleCatalogHost`), even
  with a local plugin enabled there, so they never produce a plugin catalog
  request. A manual check sends `force` and skips settings, due-time and enabled-plugin gates,
  but never the build flag or host eligibility.
- **`remote/hostCatalogPolicy.ts`** — the pure rules the background and the
  content script must agree on (which hosts may be looked up, when a check is
  due, the backoff curve, when a cached entry may be used at all), each one
  directly testable without storage or network.
- **`remote/hostCatalogCache.ts`** — one entry per host under
  `StorageKeys.PLUGIN_HOST_CATALOG_PREFIX`, i.e. `gvPluginHostCatalog:<host>` in
  `chrome.storage.local`. Readers subscribe to **content** changes only:
  recording a failed or byte-identical attempt must not remount plugin CSS or
  feed back into another refresh.
- **`remote/hostCatalogFile.ts`** — validates the published file (`format: 1`,
  matching `host`, a plugin array, optional `site` and `revoked` sections), which
  `scripts/build-plugin-catalog.ts` generates from `catalog/` with the CSS
  inlined. Every entry passes the same `validateManifest` as the bundled
  snapshot and the `site` section the same `validateSiteAdapterData`; a bad
  entry, revocation or `site` is skipped and logged; a bad file is discarded whole.
- **`remote/config.ts`** — build-time flags injected through Vite `define`:
  `VOYAGER_PLUGIN_CATALOG_URL` repoints the base URL (https only) for a preview
  environment, and `VOYAGER_PLUGIN_CATALOG_REMOTE=off` compiles a build that
  never contacts the catalog host, leaving the bundled snapshot as the only
  source. The second flag is the store-review fallback.

**Settings** live in `chrome.storage.sync` and are covered by
`SettingsBackupService`: `gvPluginOnlineUpdatesEnabled` (master switch, on by
default) and `gvPluginCatalogCheckInterval` (`1h` / `6h` / `24h` / `manual`,
default `6h`). The popup surfaces both on plugin sites, plus a manual check that
works even when the switch is off.

**Message**: a content script or the popup sends `gv.pluginCatalog.refresh`
(`PLUGIN_CATALOG_REFRESH_MESSAGE` in `runtime/messages.ts`) with
`{ host, force }`. The background decides and writes the cache entry; nothing
else fetches.

**Merge rules** — `mergePluginRecords` in `sources/defaultSources.ts`, per
plugin id:

- builtin ids always come from `builtin/`; a remote entry with the same id is
  ignored, so first-party scope and settings can never be rewritten remotely;
- build-only ids (packaged official plugins and catalog folders) always come
  from this build and cannot be replaced or revoked remotely;
- a remote entry whose `engine` range this build satisfies replaces the bundled
  copy;
- if the remote entry needs a newer engine, the bundled copy stays and carries
  `blockedUpdate`, which the popup renders as "needs a newer Voyager" (when
  neither copy is compatible the remote one is listed and the status machine
  reports needs-engine);
- when the remote catalog is authoritative for the host, a bundled plugin that
  targets the page is dropped only if its id is in `revoked`: the kill switch;
  a plugin merely absent from the catalog keeps its bundled copy, so an accidental
  build omission cannot uninstall it;
- a 404, a failed fetch, or an entry written by a different extension version
  contributes nothing, so the bundled snapshot stays in force until the next
  successful fetch;
- `local.*` ids belong to the user: an official or remote record in that
  namespace is dropped, and local plugins are added last, never replace an
  official id, and are outside the kill switch.

To revoke a plugin, remove its live manifest and add
`catalog/sites/<site>/revoked.json`:

```json
[{ "id": "voyager.deepseek-retired", "reason": "Retired because the host now provides it." }]
```

`catalog:build` requires unique ids in the site's `voyager.<site>-<kebab-case>`
namespace, a non-empty reason and no live plugin with the same id. It publishes
only the ids as an optional top-level `"revoked": ["voyager.deepseek-retired"]`
in every concrete host file of that site, even after its last plugin is removed.
The build fails if a plugin directory lacks `plugin.json`, or if `revoked.json`
has no concrete host that can publish it (including packaged-only Gemini and
AI Studio sites).
Each host file also revokes the site's live plugin ids whose `matches` no longer
cover that host. Narrowing a plugin to one host therefore stops its older bundled
copy on the site's other hosts. When renaming a plugin id, add the old id to
`revoked.json` so its bundled copy does not run alongside the renamed plugin.
The additive field keeps `format: 1`; older clients ignore it and still revoke
through absence from `plugins`. The reason stays in the source file.

## Separate opt-in Gemini selector file

Gemini keeps **zero plugin catalog requests**. Its optional **Online fixes for
Gemini page detection** switch is a separate channel in
`src/features/geminiSelectorFixes/`; it neither adds a `PluginSource` nor replaces
`site.json`. `allowsRemoteCatalog` and `isEligibleCatalogHost` still exclude Gemini
and AI Studio. AI Studio and Gemini Enterprise have no selector channel.

The switch defaults to **off**. Its strict boolean
`StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES` (`gvGeminiSelectorOnlineFixes`) lives in
`chrome.storage.local`, outside settings backup and sync. Off blocks **all**
selector requests, including manual checks, `force` and requests with an old
cache. Turning it off aborts in-flight checks and removes the selector cache.
The separate last-attempt record survives toggles, so turning it back on does
not reset the six-hour automatic interval. Only completed attempts are persisted;
an extension restart may therefore retry an interrupted check. Concurrent callers
share the same in-flight request. Manual checks bypass only the interval and
require the switch to remain on.

Only the background fetches the single `format: 1` file:

```text
https://voyager.nagi.fun/catalog/gemini-selectors/v1/hosts/gemini.google.com.json
```

The file contains only validated ordered locator lists. The literal allowlist in
`src/core/gemini/selectors/types.ts` covers conversation turns, sidebar entries and
folder display areas, model menus, message inputs, input collapse, Vim, prompt
history, slash commands, sent prompt previews, Folder as Project, folder activity,
conversation/export menus, the export selection bar, sidebar hit and hover areas, the active Gems sidebar,
message content for export/forks, context images, response/research-pack actions,
usage displays, code blocks/diagrams, user LaTeX paragraphs, search result images in exports, generated-image download icons and Canvas code panels. It contains no
plugins, CSS, actions, JavaScript, matches, capabilities or theme.

The [selector resolver README](../../../core/gemini/selectors/README.md) maps each
surface to its group and consumers. An unparsable locator drops only its surface's
group. A partial collection, conflict with an independent bundled/native check or
a target other than the operation's original element reruns the entire read with
the bundle, before any side effect. Remote-only checks stay off the bundled path.
A key whose repair can only confirm the bundled result stays packaged-only.

Identity/account/destructive-action policies, native menu association, clone
sanitizing, ARIA/focus safety, input and click protocols, source attributes, URL
and origin policy, CSS and independent native health stay packaged. So do the
unreachable repairs listed in the selector README, including scroll targets,
formula and Deep Research content, generated-image containers and Canvas document
editors. `generatedUi.*` frame keys require a **remote-path-only, URL-parsed origin
check** before they could become remote; this migration preserves the existing
packaged frame behavior. No remote locator can change that origin policy.

The builder reads the same selected `selector-data/` fragments as the bundle and
publishes one file with the full allowlist. Missing keys use the bundle; supplied
lists replace their whole profiles. A higher accepted revision replaces the entire
patch, and an empty patch withdraws all overrides. The cache is bound to the running
extension version. The [rollback runbook](../../../core/gemini/selectors/README.md#rollback-runbook)
covers higher-revision fixes, persistent withdrawal, CDN purge and build flags.

`gv.geminiSelectors.status`, `gv.geminiSelectors.setEnabled`, and
`gv.geminiSelectors.refresh` are the popup's background API. Turning the switch on
and checking identify the inspected tab; the background resolves its actual HTTPS
URL and admits only `gemini.google.com`. Reading status and turning the switch off
need no Gemini tab. Opening Gemini or its popup can request a due check; there is
no polling alarm. The options page uses the same popup with an explicit
`sourceTabId`; closing that source does not authorize a check for another active
tab. Page hydration, the background check and the popup run on `startMachine`.
The page snapshot is fixed for its content-script claim, so new downloads and
turning the switch off affect an open page only after a user refresh. No automatic
reload or PluginHost remount occurs.

GET requests omit cookies and referrers, reject redirects, and send no page or
conversation content or account identifiers. The URL exposes only the fixed host
name; the static host sees normal metadata such as IP address and User-Agent.
Announcements and plugin catalog settings remain separate.
`VOYAGER_GEMINI_SELECTOR_REMOTE=off` disables this channel, including cache use;
`VOYAGER_PLUGIN_CATALOG_REMOTE=off` disables both remote data channels. D13/D14
require the disclosure in all privacy locales and the store-listing reference.
