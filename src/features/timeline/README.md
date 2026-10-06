# Shared timeline ownership

`TimelineEngine` composes one captured conversation through `TimelineAdapter`. The adapter supplies
a turn source, viewport discovery, mount, route identity and storage policy. The engine owns state,
hierarchy geometry, the rail,
preview, tooltips, interactions, navigation and settings application. The same owners render Gemini,
ChatGPT, Claude and DeepSeek.

| Behavior                                                            | Owner                                               |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| Rail composition, styles, preview and viewport synchronization      | `TimelineView`                                      |
| Dot geometry, dense/virtual dots, ruler wave and runner             | `TimelineDotLayer`                                  |
| Slider scroll dragging and fade                                     | `TimelineSlider`                                    |
| Width/position restore, migration and dragging                      | `TimelineRailPlacement`                             |
| Preview search, pinning and hover bridge                            | `TimelinePreviewPanel`, `TimelinePreviewPress`      |
| Tooltip delay, content and visibility                               | `TimelineTooltip`                                   |
| Marker navigation, star long press and hierarchy menu               | `TimelineMarkerInteractions`                        |
| Shortcuts, active turn and navigation cancellation                  | `TimelineNavigation`                                |
| Virtualized turn homing, reversed scrollers and remembered geometry | `VirtualizedTimelineNavigation`, `scrollMotion`     |
| Marker snapshot, star display, aliases and Library hydration        | `TimelineState`                                     |
| Persisted stars, migration, serialized writes and cloud merges      | [Saved Library store](../savedLibrary/starStore.ts) |
| Hierarchy edits and persistence                                     | `TimelineHierarchy`                                 |
| Store readiness, read settlement and snapshot ordering              | `TimelineHydration`                                 |
| Collapse layout                                                     | `TimelineHierarchyGeometry`                         |

The [Gemini adapter](../../pages/content/timeline/GeminiTimelineAdapter.ts) retains Gemini selector
priority, stable identities and timestamps. Its small
[storage policy](../../pages/content/timeline/GeminiTimelineStorage.ts) retains hierarchy account scope,
legacy hierarchy keys and serialized formats, and verifies stored turn aliases. New Gemini stars
can include an opaque account annotation captured at the press; this annotation does not filter
Library reads. All sites use the same `TimelineState` and hierarchy owner.

The [catalog adapter](adapters/catalog/CatalogTimelineAdapter.ts) receives semantic selectors from
`site.json` and optional `turnNavigator` manifest parameters. It retains identity and ownership
across virtualized DOM windows. Its [storage policy](adapters/catalog/CatalogTimelineStorage.ts)
stores hierarchy in extension storage, one `gvCatalogTimelineHierarchy:<siteId>` blob per site in the
Gemini blob shape. A site that declares `accountIdAttributes` (ChatGPT) scopes that blob to the hashed
account; the hierarchy watches those attributes, rehydrates from the new account when they change,
and while the account is unknown shows no outline and refuses edits. Other sites stay unscoped, and
only Gemini's migration reads an unscoped blob behind a missing scoped one. Each accepted edit
is a per-turn change (one turn's level or collapse) captured with its bucket and conversation. The
page-wide `outlineSaveQueue` orders it, and its write (the background's, on a catalog site) applies
it to the entry freshly read from storage, so it never writes a remembered entry, and the save completes even if the timeline is torn down. The displayed outline is
the latest storage snapshot, always accepted, with the page's unwritten changes for that bucket and
conversation overlaid; a remounted timeline therefore sees an earlier session's pending edits. Each
successful write reads the bucket back and publishes that read as the snapshot, which retires the
change without relying on its own storage event. Every snapshot (read, event or read-back) claims a
page-wide order when it starts, and an owner ignores one older than the last it took. A Gemini
localStorage outline with no extension-storage entry is the snapshot until extension storage has
held the conversation; a failed migration changes nothing, and once extension storage held it, its
absence is a deletion that also clears the legacy keys, which only mirror extension-storage outlines. Cloud sync keeps each catalog
site's buckets, keyed by storage key, in its own Drive file
(`gemini-voyager-timeline-hierarchy.site-<siteId>.json`, see
[catalogHierarchySync](catalogHierarchySync.ts)); uploads merge into that file, and a restore always
merges into the local buckets. The background is the single writer of catalog buckets
([catalogOutlineMessages](../../pages/background/catalogOutlineMessages.ts)): page edits from every
tab and restores from the popup or a page run one at a time per site, each step re-reading storage
([catalogOutlineWriter](catalogOutlineWriter.ts)); a page still reads its outline from storage and
refreshes on its change events. Gemini outlines keep their page-side write. Clearing a catalog
outline leaves a deletion marker in its bucket (`deleted[conversationId]`), so a merge keeps it
cleared unless an edit is newer, and an edit is dated after the entry or marker it replaces even
when another device's clock dated that ahead; markers expire after 180 days.
The popup syncs every catalog site; a site's own page syncs only that site.
ChatGPT stars carry the same hashed account annotation. Stars for every site come from the Saved
Library through its
[client](../savedLibrary/StarredMessagesService.ts), whose requests use the background store as the
single write owner. In the cloud a catalog site's stars have their own file too
(`gemini-voyager-stars.site-<siteId>.json`, see [starSitePolicy](../savedLibrary/starSitePolicy.ts)),
synced by the same catalog messages and by every Gemini star sync. A Gemini account file keeps the
catalog stars older versions put there but gains no new ones; the shared Gemini file, used without
account isolation, still carries them for older versions. Every edit requires evidence that the turn belongs to the current conversation.
Old page star arrays are neither read, imported, written nor purged.

Viewport replacement rebinds scroll and intersection observation while retaining conversation state.
Path/query replacement destroys the engine and creates a fresh conversation adapter; `runRouteTimeline`
owns that route lifetime for every site (Gemini adds its conversation-route filter and 500 ms settle
delay, catalog sites forward `hashchange`). Gemini's shared
history timestamp store has page lifetime: conversation teardown unsubscribes without stopping it.
Plugin scope abort immediately destroys the engine before pending startup settles, so an old cleanup
cannot remove a newly enabled rail.

A star edit requires a successful Saved Library read or a complete external Library snapshot.
Failed reads reject at the background/service boundary and leave persisted stars intact.
`TimelineState` owns separate `TimelineHydration` instances for Library stars and hierarchy, applying
the same readiness, in-flight read settlement and snapshot ordering rules independently. Failed attempts release the
read; the next edit retries, and writes remain refused until hydration succeeds. A complete external
snapshot for the resolved active scope also restores readiness and takes precedence over older
pending reads. Hierarchy loads independently of Library stars. Level/collapse edits before or during
the first read are refused; ready edits stay synchronous, while an edit after a settled failure
waits for a successful retry. Stored aliases and mounted identity use separate policy resolvers: an
unverified Gemini DOM-window `u-N` cannot receive a stored full-history turn’s star or deep link.

Rail and preview styles are injected from `timeline.css` and `timelinePreview.css` by the view and removed on teardown. Shared theme tokens and
coachmark replicas remain in `public/contentStyle.css` because other features use them. Existing
`.gemini-timeline-bar`, `.timeline-track-content` and `.timeline-style-compact` classes remain the
highlight marker DOM contract. New DOM ownership metadata is `gv-` prefixed.

Catalog message times come only from sends. A site whose `site.json` names `turnKeyAttributes`
(ChatGPT today) gets a page-lifetime [send ledger](adapters/catalog/sendTimestamps.ts) that subscribes
to [`trackUserSends`](../plugins/sends/trackUserSends.ts) and records the produced turn's host key,
gated by the same message-timestamps setting. [Times](adapters/catalog/sendTimesStore.ts) live in one
`gvMessageTimestamps:<site>:conv:<id>` key per conversation, never in Gemini's `gvMessageTimestamps`
blob, which saves whole snapshots and would drop other tabs' entries. Each key is columnar (53-bit
hashed turn keys, seconds after a base; about 20 bytes a turn). The page asks the background to store
a send ([`gv.sendTimes.record`](../../pages/background/sendTimeMessages.ts)); the background is the
only writer, accepts a site's sends only from that site's own pages, and runs each site's writes in
one serial queue, every step reading storage afresh. A `gvMessageTimestamps:<site>:index` list lets
the first send of a worker's lifetime prune the oldest conversations past the site cap (5000 with
required `unlimitedStorage`, else 2000), and a failed read never leads to a write. Pages read the
keys themselves and refresh on storage changes. Turns mounted from history are never stamped, and the time
shows in the dot's tooltip only: nothing is inserted into the host's transcript. Claude and DeepSeek
name no turn key and show none.

The packaged `turnNavigator` primitive remains the compatibility entry point for old remote catalogs.
Its name, parameter validator and engine floor are unchanged; both bundled and cached remote manifests
run the shared engine. Older extension builds can continue reading these unchanged manifests.
