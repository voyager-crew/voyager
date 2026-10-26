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
single source. Packaged fragments hold locators whose only available proof
would confirm the bundled result, along with the site's fixed protocols.

| Site                         | Online page detection coverage                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini, including Enterprise | Conversation turns and content; sidebar and Gems; composer and prompt tools; menus; export and image surfaces; code and Canvas panels. The [Gemini registry](../gemini/selectors/README.md#groups-and-consumers) lists each surface. |
| AI Studio                    | Composer candidates and send containers; library tables and rows; Library navigation links.                                                                                                                                          |
| ChatGPT                      | Composer and handoff candidates, Vim input, complete reply roots for export and the local bridge.                                                                                                                                    |
| Claude                       | Composer and handoff candidates, Vim input and complete reply roots for export.                                                                                                                                                      |
| Kimi                         | Composer candidates, Vim input and complete reply roots for export.                                                                                                                                                                  |
| DeepSeek                     | Complete reply roots for export. Input profiles remain packaged because their proof can only confirm the existing read.                                                                                                              |

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
Once ready, the snapshot stays fixed until the user refreshes the page.

Validation caps each site's profiles at 65,536 UTF-8 bytes, each ordered list at
32 entries and each locator at 2,048 UTF-16 code units. Empty strings and unsafe
control characters are rejected. A malformed or unparsable locator drops its
whole surface group. Unknown keys or an oversized section drop the section,
without invalidating plugins or unrelated site data.

Consumers perform a pure read against one captured view before any click,
insertion, send, export, download or persistent write. Remote data counts only
when an independent native or bundled read proves the complete result and its
original owner. A partial list, reordered result, conflicting evidence or wrong
element reruns the entire operation against the bundle. Rejected candidates
never contribute descendants or side effects. These checks stay off the
bundled path: without remote changes, the reader runs once and no remote guard
runs.

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
reads. This stops automatic and manual requests and does not clear folders,
drafts, highlights or other user data. The local catalog cache is retained.
Withdrawal cannot undo an action already completed.
