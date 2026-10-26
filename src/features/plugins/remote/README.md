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

## Separate opt-in Gemini selector files

Gemini keeps **zero plugin catalog requests**. Its optional **Online fixes for
Gemini page detection** switch is a separate data channel, implemented in
`src/features/geminiSelectorFixes/`; it does not add a `PluginSource` or replace
`site.json`. `allowsRemoteCatalog` and `isEligibleCatalogHost` still exclude
Gemini and AI Studio. AI Studio has no selector channel either.

The switch defaults to **off**. Its strict boolean
`StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES` (`gvGeminiSelectorOnlineFixes`) lives
in `chrome.storage.local`, outside settings backup and sync. Off blocks **all**
selector requests, including `force`, manual checks and requests with an old
cache. Turning it off aborts in-flight checks and removes the selector cache.
The separate last-attempt record survives toggles, so turning it back on does
not reset the six-hour automatic interval. Manual checks bypass only the
interval and require consent to remain on. Only completed attempts are
persisted, so a check interrupted by an extension restart may be retried; while
a check is in flight, every other caller shares that one request.

Only the background fetches:

```text
https://voyager.nagi.fun/catalog/gemini-selectors/v3/hosts/gemini.google.com.json
```

Gemini Enterprise is not covered: its pages never start the Gemini turn
consumers, so a file for it would have no reader.

The `v3` file (`format: 3`) carries ordered `turn.*`, `sidebar.*`, `modelPicker.*`,
`composer.*`, `inputCollapse.*`, `vim.*`, `promptHistory.*`, `slash.*`, `sentChips.*`,
`project.*` and `activity.*` profiles. The publisher reads the same per-surface
JSON fragments in `selector-data/` as the bundle. These cover conversation turns,
sidebar entries/titles and folder display areas, model menu discovery, message
inputs and their controls, input collapse, Vim, prompt history, slash commands,
sent prompt previews, Folder as Project and folder activity. Each surface has its own
syntax-fallback group. A remote read must preserve the complete independently
verified collection and the operation's original input; a miss or mismatch reruns
the whole read with bundled data. The configured Vim wrapper-to-editable order,
hidden fallback and accepted HUD selector are preserved; collapse scans, mutation
flushes and resize measurements each use one read session.
Identity extraction, account controls, delete/rename/confirmation, deletion
tracking and click policy remain packaged. So do locators whose online match would
have to equal the packaged one before use (sidebar toggle, hosts, new-chat and
actions containers in `sidebar-packaged.json`; saved, exported and printed
conversation titles in `sidebar-titles.json`): neither file is published. Edit/send protocols, attachment/related-UI checks, HUD
anchors, chip text and mount points, and project insertion/removal rules also stay
packaged; `*-packaged.json` fragments never enter publication. The files contain no plugins,
CSS, actions, JavaScript, matches, capabilities or theme. The bundle and remote
files use the same selector-data guard. A newer accepted revision
replaces the previous patch; each supplied list replaces that bundled list as
a whole. Missing keys keep their bundled values. An empty patch withdraws all
online overrides. Roll back by reverting the data and publishing a **higher**
source revision, not by lowering `catalogRevision`.

The publisher keeps `/gemini-selectors/v1/hosts/gemini.google.com.json` and
`/gemini-selectors/v2/hosts/gemini.google.com.json` for older extensions. The
`format: 1` projection contains only the original five `turn.*` profiles; the
`format: 2` projection adds the original sidebar and model menu profiles. Neither
projection gains composer keys: older clients would reject the entire file.
The current client fetches only v3 and requires format 3 on that response.
Valid format 1 and 2 caches remain readable, with newer surfaces using bundled
profiles until a v3 response replaces them. The cache is still bound to
`extensionVersion`, so an extension upgrade discards another version's cache.
New profiles extend only the latest format’s literal allowlist and its contract test.
Earlier projections retain their existing lists. Profile additions require no consent
or user-record migration.

`gv.geminiSelectors.status`, `gv.geminiSelectors.setEnabled`, and
`gv.geminiSelectors.refresh` are the popup's background API. Turning the switch
on and checking identify the inspected tab; the background resolves its actual
HTTPS URL and admits only `gemini.google.com`. Reading the status and turning
the switch off need no Gemini tab, so the popup on any tab can turn it off.
Opening Gemini or its popup can request a due check; there is no polling alarm.
The options page uses the same popup with its explicit `sourceTabId`; a closed
source does not authorize checks for a different active tab. Selectors
are snapshotted once per page, so new data and turning the switch off affect
open pages only after the user refreshes. There is no automatic reload.

GET requests omit cookies and referrers, reject redirects, and send no page or
conversation content or account identifiers. The URL exposes only the fixed
host name; normal network metadata such as IP address and User-Agent is visible
to the static host. Announcements and plugin catalog settings remain separate.
`VOYAGER_GEMINI_SELECTOR_REMOTE=off` disables this channel at build time;
`VOYAGER_PLUGIN_CATALOG_REMOTE=off` also disables it. The disclosure is kept in
all privacy locales and the store-listing reference, as required by D13/D14.
