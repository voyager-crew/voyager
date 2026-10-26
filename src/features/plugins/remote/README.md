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
  pass. Each pass runs on `hostCatalogCheckMachine.ts` (`hostCatalogCheck`):
  turning updates off cancels preparation and fetch, while an already-started
  cache write settles before the host is freed. A timeout aborts the fetch and
  records the failed attempt; late responses cannot write over a later check.
  Gates in order: the build flag; the host shape (plain hostnames, no
  wildcards or ports); the user settings (online-updates switch, check interval
  counted from the last attempt, failure backoff, writer-version staleness); and
  page eligibility: a supported site has packaged page-locator data, or at least
  one **enabled** plugin targets its host. This includes Gemini Enterprise and
  both AI Studio hosts. A manual check sends
  `force` and bypasses the automatic-update switch, due-time and enabled-plugin
  gates; build-time disabling and hostname validation still apply.
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
default `6h`). The popup surfaces both on every supported site.
Opening it reads the cache. Manual checks bypass the switch and interval.
Turning updates off stops automatic requests. Cached data remains
local; page hydration uses the bundle while updates are off.

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
  copy; native timeline identity parameters retain their packaged values, so an
  update cannot redirect saved stars or account ownership;
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
has no concrete host that can publish it. Gemini and AI Studio official plugins
remain build-only and cannot be revoked remotely.
Each host file also revokes the site's live plugin ids whose `matches` no longer
cover that host. Narrowing a plugin to one host therefore stops its older bundled
copy on the site's other hosts. When renaming a plugin id, add the old id to
`revoked.json` so its bundled copy does not run alongside the renamed plugin.
The additive field keeps `format: 1`; older clients ignore it and still revoke
through absence from `plugins`. The reason stays in the source file.

## Page-locator profiles in site data

The optional `site.locators` section maps namespaced profile keys to ordered
string arrays. Site-specific policy owns each literal allowlist and fallback
group. `core/selectors/contracts/` registers each site; Gemini retains its
domain vocabulary in `core/gemini/selectors/types.ts`.
`validateSiteAdapterData` validates this section independently: an over-limit
section is omitted and an unknown key is reported and ignored, while a malformed or unparsable
locator drops only its surface’s group. The host’s plugin list, other adapter data and kill switch still work.

Every supported host uses the same channel, for example:

```text
https://voyager.nagi.fun/catalog/hosts/gemini.google.com.json
https://voyager.nagi.fun/catalog/hosts/business.gemini.google.json
https://voyager.nagi.fun/catalog/hosts/aistudio.google.com.json
```

Gemini and AI Studio receive locator data while their official plugins, CSS,
host admission, identity and interaction protocols stay packaged. Enterprise
reads the same Gemini data under the same guards. Each other site reads its own
profiles alongside its existing catalog plugins. The
[resolver README](../../../core/selectors/README.md) lists the exact coverage
and independent checks that protect each operation.
A key whose repair can only confirm the bundle stays packaged-only.

The catalog builder reads the same selected non-`*-packaged.json` fragments as
`bundle.ts`. Revision, cache writer version, refresh timing and withdrawal use
this channel’s existing machinery. A resolved adapter must be newer than the
bundle before its profiles can apply. Missing or empty `site.locators` restores
only its namespaced profiles on the next page load. A complete withdrawal also
restores admitted `site.selectors` values to their packaged values. No second
setting, cache, endpoint or publisher is involved.

Shared per-site hydration is a `startMachine` flow. It reuses PluginHost’s first adapter and settings reads; when the cache has no newer adapter, startup does not wait for settings. It reads resolved catalog site data once per content-script claim. Changes to
update settings during that read settle on the bundle; an error, timeout or
page teardown cannot adopt late data. After readiness, the snapshot stays fixed
until the page is loaded again. New fixes, withdrawals and switching updates off
therefore take effect after a user refresh, with no automatic reload or remount.
The page requests a due catalog check after hydration; opening the popup only
reads the cache, and its refresh button requests a manual check.

Every consumer guard and `remoteKeys` decision remains packaged. A partial
collection, conflict with an independent native/bundled check or target other
than the operation’s original element falls back for the whole operation before
any side effect. These checks remain off the bundled path.

The [rollback runbook](../../../core/selectors/README.md#rollback-runbook)
covers higher-revision fixes and withdrawing locators in the host file.
`VOYAGER_PLUGIN_CATALOG_REMOTE=off` disables the single catalog channel,
including every site’s cached profiles. Requests omit cookies and send no page or
conversation content or account identifiers. Hosting providers see ordinary
connection metadata such as IP address, User-Agent and the hostname in the URL.
Announcement and cloud-sync settings remain separate. D13/D14 require the same
coverage and request disclosure in every privacy locale and store-listing draft.
