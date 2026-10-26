# Site page detection data

All six supported sites use the existing plugin catalog host files:
`https://voyager.nagi.fun/catalog/hosts/<host>.json`. Gemini Enterprise uses the
Gemini data and guards; both AI Studio hosts use AI Studio data. A page never
reads another site's profiles. There is one online-update setting, cache,
refresher and publisher; see the [remote catalog](../../features/plugins/remote/README.md).

## Source and boundaries

Each site's `catalog/sites/<site>/selector-data/` directory owns its locator
fragments. [`contracts/`](contracts/) declares literal remote keys, rejection
groups and publication files. [`bundle.ts`](bundle.ts) and the catalog publisher
read those same fragments. Existing semantic keys keep `site.json` as their
single source. Packaged fragments hold the site's fixed protocols and locators
without an independent proof that could admit a useful replacement.

The [complete packaged-data ledger](PACKAGED_DATA.md) lists every retained key
and its reason. Some renamable classes have **no independent proof** of a safe
replacement; those remain packaged until a new proof is implemented. They are
not immutable protocols, and a class rename may still require an extension release.

| Site                         | Online page detection coverage                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini, including Enterprise | Conversation turns and content; sidebar and Gems; composer and prompt tools; menus; export and image surfaces; code and Canvas panels. The [Gemini registry](../gemini/selectors/README.md#groups-and-consumers) lists each surface. |
| AI Studio                    | Composer candidates; complete library rows and drag targets; prompt history, sidebar and navigation children. Placement slots remain packaged.                                                                                       |
| ChatGPT                      | Composer and handoff candidates, composer owners, Vim input, turns, model controls, header actions, temporary-chat navigation, export/streaming roots, code hosts, sidebar and scroll owners.                                        |
| Claude                       | Composer and handoff candidates, Vim input, complete reply roots for export, sidebar and scroll owners.                                                                                                                              |
| Kimi                         | Composer candidates, Vim input, complete reply roots for export, sidebar and scroll owners.                                                                                                                                          |
| DeepSeek                     | Complete reply roots for export, code hosts, sidebar and scroll owners. Input profiles remain packaged because their proof can only confirm the existing read.                                                                       |

Host admission, account controls, content IDs and parsed-ID equality, destructive
actions, native clone sanitizing and ARIA association remain packaged. So do
send/Stop/IME/disabled checks, click sequences, editor writes, source and origin
policy, HTML/MathML serialization, CSS and Voyager-owned DOM. Native Gemini and
AI Studio official plugin manifests remain packaged. Other sites' existing
catalog plugins retain their existing CSS/JSON distribution.

Remote timeline manifests also retain their packaged data-backend, conversation
and account identity parameters. Explicit local imports keep their user-defined
parameters.

## Shared snapshot and guards

[`service.ts`](service.ts) owns one snapshot per site. Hydration uses
[`hydration.ts`](hydration.ts), a `startMachine` flow with `reading`, `settled`
and `retired` states. The host and adapter ID must identify the same packaged
site, and the catalog revision must exceed the bundle. Settings changes,
timeouts and retirement settle pending work without accepting late results.
The first adapter and settings reads are shared with PluginHost. Cached adapter
selection uses the same revision/identity rule at first mount and later reloads,
regardless of Online updates. The switch governs profile hydration and whether
semantic reads use the adapter or the guarded snapshot.
Native features add no catalog wait. At their first mount, after the existing
settings/coverage reads, they fix the snapshot already available. If cache
hydration is still pending, that page keeps the bundle and later catalog results
cannot switch it; a subsequent page load can try again. A timely eligible cache
supplies the first mount. Once ready, the profile snapshot stays fixed until the
user refreshes the page; consumer proofs still run against the current DOM.

[`semanticSource.ts`](semanticSource.ts) separately resolves the initial semantic
read mode through `startMachine`, reusing that same settings read without delaying
profile readiness. If the initial setting resolves to OFF after profiles are
ready, subsequent semantic reads use the baseline adapter; this cannot install
late profiles. A settings change while the read is pending, a read failure or
teardown invalidates that result. Once the mode settles, later setting changes
require a page refresh.

Validation caps each site's profiles at 65,536 UTF-8 bytes, each ordered list at
32 entries and each locator at 2,048 UTF-16 code units. Empty strings and unsafe
control characters are rejected. A malformed or unparsable locator drops its
whole surface group. Unknown keys are reported and ignored so older clients retain their other repairs. An oversized section drops the section without invalidating plugins or unrelated site data. Authoring fragments remain strict about unexpected keys.

With Online updates on, consumers of keys admitted to the guarded page-locator
contract perform a pure read against one captured view before any click,
insertion, send, export, download or persistent write. Remote data counts only
when an independent native or bundled read proves the complete result and its
original owner. A partial list, reordered result, conflicting evidence or wrong
element reruns the entire operation against the bundle. Rejected candidates
never contribute descendants or side effects. These checks stay off the
bundled path: without remote changes, the reader runs once and no remote guard
runs.

ChatGPT's `composerRoot` is admitted separately from its composer/send group.
A repair must identify exactly one owner containing the independently proven
editor and one native submit button with the same form association. This permits
an owner outside `<form>` while rejecting duplicate roots, other editors,
conversation content, dialogs and Voyager UI. Notifications recheck this owner
for each operation; enclosing upload owners also retain their pending-upload
check. The proof lives in
[`chatgptRootProof.ts`](../services/composer/chatgptRootProof.ts).

With Online updates off, every semantic key, including admitted contract keys,
reads the resolved adapter value exactly as at baseline `6fa19b4ae`. Cached
`site.selectors` overrides keep their existing revision and identity rules; the
new guarded proofs apply only with Online updates on. Fields outside the guarded
contract retain their earlier catalog override behavior in either mode.
Namespaced `site.locators` profiles use the bundle while updates are off.
Independent native ownership proofs still read packaged evidence.

## Rollback runbook

1. Correct the site's locator fragment and retain the failing DOM fixture. The
   new main-line commit must yield a higher first-parent `catalogRevision`.
2. Run affected tests and `bun run catalog:build`; inspect the affected host
   files, revision, profile keys and size limits.
3. Publish through the normal Pages workflow and purge each affected
   `/catalog/hosts/<host>.json` CDN entry. Check those exact files.
4. Clients receive the correction at the next due or manual check and apply it
   after a user refresh. To withdraw all page-location fixes, publish a newer
   host file with `site.locators` absent or empty and restore every admitted
   `site.selectors` value to its packaged value. Emptying `site.locators` alone
   leaves semantic-key fixes active. Retain the remaining site data.
5. A build with `VOYAGER_PLUGIN_CATALOG_REMOTE=off` disables the whole channel.

Locally, turn **Online updates** off and refresh the page to restore bundled
`site.locators` profiles and baseline semantic reads from the resolved adapter.
This stops automatic requests; manual checks remain available. Cached plugins
and all existing site-adapter fields remain usable, including admitted semantic
keys, at the first mount and on catalog reload. It does not clear folders, drafts,
highlights or other user data.
The local catalog cache is retained.
Withdrawal cannot undo an action already completed.
