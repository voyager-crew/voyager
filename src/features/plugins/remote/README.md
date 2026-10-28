# Remote host catalog (`remote/`)

Part of the [Plugin ecosystem overview](../README.md). Page-locator rules have one source of truth: the [resolver invariants](../../../core/selectors/README.md#invariants).

The official CSS/JSON plugins ship as a snapshot inside the extension, and the
same data is published per site at `<base>/hosts/<host>.json` (default base
`https://voyager.nagi.fun/catalog`, so DeepSeek is
`https://voyager.nagi.fun/catalog/hosts/chat.deepseek.com.json`). A selector fix
can therefore reach users without a store release, while the engine that reads
the data still ships in the package. The host file's optional `site` section uses
the shared site-data guards. Statically injected hosts publish restricted site records
([packaged host records](#packaged-host-records)); other hosts publish full adapters. It replaces the bundled
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
  snapshot. Every host's `site` section uses `readSiteAdapterData`, including its
  selector and locator validation. A bad
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
Turning updates off stops automatic requests. Cached plugin manifests and site
adapter data remain usable under the same revision and identity rules at first
mount and on catalog reload. The resolver invariants define OFF reads and the declarative compatibility boundary.

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

## Packaged host records

Gemini (including Enterprise) and both AI Studio hosts publish a narrow `site`:
`id`, `label`, `matches`, `theme`, `selectors`, `catalogRevision` when set and
optional `locators`, with `plugins: []` retaining the format-1 envelope.
`label` and `theme` stay because the current parser and every released parser
require them to accept the whole record. The publisher omits only optional
fields those parsers do not require.

The complete bundled `selectors` map is published intentionally. Voyager v1.9.0
requests a catalog file for every host and applies a valid matching override wholesale.
It currently rejects these records because it does not recognize `composerRoot`
and `sendButton`. Before removing any selector keys, verify that v1.9.0 still
rejects the resulting record. Releases from 2.0.0 before unknown-key tolerance
exclude packaged hosts from requests under D14; the current parser tolerates
unknown selector keys.

The client reads these records through the same `readSiteAdapterData` path as
every other host. Its packaged path takes the revision, identity, admitted
semantic selectors and locators, and pins all other fields to the bundle.
Non-packaged host files carry full adapters and plugin lists.

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

The [resolver invariants](../../../core/selectors/README.md#invariants) define
site isolation, trust tiers, mount safety and packaged boundaries. The
[trust ledger](../../../core/selectors/PACKAGED_DATA.md) records the decision for
every key. Gemini and AI Studio official plugins and CSS remain packaged.

The catalog builder reads the same selected non-`*-packaged.json` fragments as
`bundle.ts`. Revision, cache writer version, refresh timing and withdrawal use
this channel’s existing machinery. A resolved adapter must be newer than the
bundle before its profiles can apply. Missing or empty `site.locators` restores
only its namespaced profiles on the next page load. A complete withdrawal also
restores admitted `site.selectors` values to their packaged values.

Shared per-site hydration and its bounded adapter result use `startMachine` and
share PluginHost’s first adapter and settings reads. Only hydration and the
refresh gate use a capped adapter result; PluginHost keeps awaiting the original
cache read, including reads slower than 250 ms, with Online updates on or off. The
[startup readiness rule](../../../core/selectors/README.md#startup-readiness)
defines the bounded first-consumer wait, frozen page view and independent
baseline adapter precedence. New page-locator fixes, withdrawals and switching
updates off take effect after a user refresh, with no automatic reload or native
remount.
The page requests a due catalog check after hydration; opening the popup only
reads the cache, and its refresh button requests a manual check.

The [rollback runbook](../../../core/selectors/README.md#rollback-runbook)
covers higher-revision fixes and withdrawing locators in the host file.
`VOYAGER_PLUGIN_CATALOG_REMOTE=off` disables the single catalog channel,
including every site’s cached profiles. Requests omit cookies and send no page or
conversation content or account identifiers. Hosting providers see ordinary
connection metadata such as IP address, User-Agent and the hostname in the URL.
Announcement and cloud-sync settings remain separate. D13/D14 require the same
coverage and request disclosure in every privacy locale and store-listing draft.
