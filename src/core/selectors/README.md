# Site page detection data

## Invariants

1. One online channel: every site's page locators use `<base>/hosts/<host>.json`, the existing Online updates setting, cache, refresher and publisher.
2. OFF or no remote data equals `6fa19b4ae`: preserve cached adapter precedence and reads, bundled values and their order, behavior and query cost; OFF disables new namespaced profiles, not baseline cached adapters.
3. Tier A keys require independent page proof; Tier B keys trust the official catalog subject to the shared mount rule below; design §6 protocols stay packaged.
4. Every consumer of a published key reads through its contract; an independent native proof or §6 protocol is an explicit, reviewed exception.
5. Each site reads only its own data; Gemini Enterprise uses Gemini, both AI Studio hosts use AI Studio, and unknown hosts get the generic profile.
6. Unknown remote keys are reported and ignored without rejecting known keys, other adapter data, plugins or the kill switch.
7. A site override is never weaker than at baseline: declarative `sidebar` and `headerActions` targets retain exactly their `6fa19b4ae` catalog trust, while placement reads apply Tier B mount safety.

The [remote catalog](../../features/plugins/remote/README.md) owns transport and cache details.
`bun run selectors:check` enforces published-literal and site-import boundaries plus per-site loader parity; the complete OFF snapshots in `__tests__/bundledOffParity.test.ts` pin values and ordering. Both run in `verify:pr` and CI.

## Source and boundaries

Each site's `catalog/sites/<site>/selector-data/` directory owns its locator
fragments. [`contracts/`](contracts/) declares literal remote keys, rejection
groups and publication files. [`bundle.ts`](bundle.ts) and the catalog publisher
read those same fragments. Existing semantic keys keep `site.json` as their
single source. The [per-key trust ledger](PACKAGED_DATA.md) classifies published profiles,
packaged fragments and semantic keys on all six sites. Tier A requires independent
page proof when a locator drives a host action, supplies stored/exported data, or
decides the conversation, turn, account, Gem, folder or project an operation uses.
Tier B is trusted official-catalog data used only to place or avoid Voyager UI.
It cannot act on the host or supply data. Design §6 protocols stay packaged;
a retained Tier A locator has a per-key reason why a replacement cannot be proved
without trusting that replacement.

| Site                         | Online page detection coverage                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini, including Enterprise | Conversation turns and content; sidebar and Gems; composer and prompt tools; menus; export and image surfaces; code and Canvas panels. The [Gemini registry](../gemini/selectors/README.md#groups-and-consumers) lists each surface. |
| AI Studio                    | Composer candidates; complete library rows and drag targets; prompt history, sidebar and navigation children. Navigation insertion slots and UI layout are also covered.                                                             |
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

With Online updates on, Tier A consumers perform a pure read against one
captured view before a host action, export or persistent write. Independent
native or bundled evidence must prove the complete result and its original owner.
A partial list, reordered result, conflicting evidence or wrong target reruns the
whole operation against the bundle; rejected candidates contribute no descendants
or side effects.

Tier B covers export-toolbar layout, HUD and prompt UI placement, insertion
slots, alignment and avoidance probes. It needs no ownership proof: a matching
value from the official catalog is trusted, as existing site overrides were.
Zero matches fall back for that operation. <a id="tier-b-mount-rule"></a>The shared mount rule walks composed ancestors, including shadow roots and assigned slots. It rejects contenteditable, input, textarea, select, option, button, linked anchors, summary, label, pre and code, and these ARIA roles: textbox, combobox, button, link, menuitem, menuitemcheckbox, menuitemradio, switch, checkbox, radio, treeitem, tab and option. A model-title decoration may cross only its independently validated native picker-row boundary; nested controls and code still fail.
Literal allowlists, group rejection, syntax checks and size limits apply to both
tiers. A mixed-use locator is Tier A unless placement has its own separate key.

The bundled path does not run either tier’s new checks (invariant 2).

ChatGPT's `composerRoot` is admitted separately from its composer/send group.
A repair must identify exactly one owner containing the independently proven
editor and one native submit button with the same form association. This permits
an owner outside `<form>` while rejecting duplicate roots, other editors,
conversation content, dialogs and Voyager UI. Notifications recheck this owner
for each operation; enclosing upload owners also retain their pending-upload
check. The proof lives in
[`chatgptRootProof.ts`](../services/composer/chatgptRootProof.ts).

Declarative operations resolve `sidebar` and `headerActions` from the original
adapter in both modes, including targets inside controls, exactly as at baseline.
They do not pass through the placement guard. Other admitted semantic consumers
use the frozen guarded view with updates on and the resolved adapter with updates
off. Independent native ownership proofs always read packaged evidence.

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
