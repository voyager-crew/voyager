# Shared timeline ownership

`TimelineEngine` composes one captured conversation through `TimelineAdapter`. The adapter supplies
a turn source, viewport discovery, mount, route identity and storage policy. The engine owns state,
hierarchy geometry, the rail,
preview, tooltips, interactions, navigation and settings application. The same owners render Gemini,
ChatGPT, Claude and DeepSeek. Every route obtains its data through
[`TimelineDataSession`](TimelineDataSession.ts): a narrow interface for marker snapshots, stars,
verified aliases and level/collapse edits. Its factory uses the existing `TimelineState` owner with
the adapter's captured storage policy; it creates no second store or write queue. A rail's teardown
retires its session, while already accepted hierarchy saves keep their captured destination and
finish through the existing queue.

| Behavior                                                            | Owner                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Rail composition, styles, preview and viewport synchronization      | `TimelineView`                                                                                             |
| Dot geometry, dense/virtual dots, ruler wave and runner             | `TimelineDotLayer`                                                                                         |
| Slider scroll dragging and fade                                     | `TimelineSlider`                                                                                           |
| Width/position restore, migration and dragging                      | `TimelineRailPlacement`                                                                                    |
| Preview search, pinning and hover bridge                            | `TimelinePreviewPanel`, `TimelinePreviewPress`                                                             |
| Tooltip delay, content and visibility                               | `TimelineTooltip`                                                                                          |
| Marker navigation, star long press and hierarchy menu               | `TimelineMarkerInteractions`                                                                               |
| Shortcuts, active turn and navigation cancellation                  | `TimelineNavigation`                                                                                       |
| Virtualized turn homing, reversed scrollers and remembered geometry | `VirtualizedTimelineNavigation`, `scrollMotion`, `homingEstimate`, `homingRun`, `activeTurn`, `activeHold` |
| Preview search marks and ignoring the timeline's own DOM edits      | `timelineSearchHighlight`                                                                                  |
| Sync settings read and live popup changes                           | `timelineSyncSettings`                                                                                     |
| When navigation re-discovers the container and viewport             | `timelineRefreshPolicy`                                                                                    |
| Marker snapshot, star display, aliases and Library hydration        | `TimelineDataSession`, implemented by `TimelineState`                                                      |
| Persisted stars, migration, serialized writes and cloud merges      | [Saved Library store](../savedLibrary/starStore.ts)                                                        |
| Hierarchy edits and persistence                                     | `TimelineHierarchy`                                                                                        |
| Store readiness, read settlement and snapshot ordering              | `TimelineHydration`                                                                                        |
| Collapse layout                                                     | `TimelineHierarchyGeometry`                                                                                |
| Annotation ticks published by other features (highlights)           | `timelineAnnotations`, `TimelineAnnotationLayer`                                                           |

The [Gemini adapter](../../pages/content/timeline/GeminiTimelineAdapter.ts) retains Gemini selector
priority, stable identities and timestamps. Its small
[storage policy](../../pages/content/timeline/GeminiTimelineStorage.ts) retains hierarchy account scope,
legacy hierarchy keys and serialized formats, and verifies stored turn aliases. New Gemini stars
can include an opaque account annotation captured at the press; this annotation does not filter
Library reads. All sites use the same `TimelineState` and hierarchy owner.

The fixed Gemini plugin and local consumer-Gemini plugins start through the same `turnNavigator`
entry, selecting this native policy with literal `dataBackend: "shared"`; they cannot override
conversation, account or turn identity. The official rail declares its knobs as plugin
settings bound to their existing sync keys; local replacements use their own plugin settings.
`adapters/gemini/activateSharedGeminiTimeline.ts` waits for the existing history and message
page services before creating a data session. Its startup machine retires pending readiness on
scope abort, and the shared route owner stops the rail immediately. PluginHost owns each switch.
The public primitive and
fixed builtin arbitrate one `timeline-rail` resource. Catalog sites keep their adapter and
storage policy.

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

A catalog site whose `site.json` has a `timeline.history` section (ChatGPT, #1112) also lists the
turns its host never mounted. ChatGPT's virtual list mounts one to three exchange items and reserves no
height for the rest, so the DOM cannot show they exist. Per route, the
[history loader](adapters/catalog/historyLoader.ts) reads the conversation's saved branch through the
reader the section names (ChatGPT's reuses the export's `ChatGptHistoryReader` with the section's
same-origin paths) on `startMachine`, so a read the route outlives is dropped. The
[history merge](adapters/catalog/historyMerge.ts) joins mounted turns to its entries by the section's
key attributes and gives each entry the `c-<hash>` id the DOM-only merge gives the mounted turn, so
stars and outline levels keep their ids; a never-mounted turn stands on a detached placeholder, which
fails every edit's page-evidence check. A mounted prompt the list lacks stays after the turn before
it and asks for a bounded re-read; a failed first read leaves the DOM-only merge in charge.
`timeline.homing.mode: "step"` runs [`homingRun`](homingRun.ts) on `startMachine` (#1116). ChatGPT
loads its history in pages: fetched turns it has not mounted keep an estimated height, so a far jump
inside them lands and mounts within ~100 ms, while turns older than the loaded pages reserve nothing
and the next page is fetched (2-5 s each) only once the view reaches the top. The run jumps instantly
to the turn's place estimated by its ordinal ([`homingEstimate`](homingEstimate.ts): between the nearest turns seen on each side, else the mounted pitch),
waits for the DOM to answer (mutations or scrolls, then quiet) instead of a fixed hop, and repeats; at
the top of what is loaded it waits for the older page without scrolling again and pulses the target
marker (`gv-timeline-homing-wait`). A mounted target is aimed instantly (a near one glides) and aimed
again when the host re-measures it. ChatGPT places unmeasured turns by its own estimates and
re-anchors as it measures them, so a target mounted more than 0.9 of a view away, one its re-layout
lost, or one a jump brought no nearer is approached in steps under a view. A measured exchange in
the viewport can be crossed directly: navigation aims at its own prompt or jumps to its edge to
mount the next exchange. If an overshoot leaves usable measurements on both sides, the search can
jump between them. An instant move counts as progress even when the mounted turns stay the same.
A run ends on arrival, after `stallMs` (default 4 s) without search or alignment progress,
after `edgePatienceMs` (default 10 s) waiting at the top, after 60 moves, or on a person's wheel or touch
(`isUserEvent`); both tunables come from `site.json`. `releaseWith: "wheel"` dispatches a scripted wheel
in the scroll's direction before each navigation scroll, because ChatGPT pins its thread to the newest
turn until a wheel arrives. The active marker is searched among the turns measured in the latest pass
only ([`activeTurn`](activeTurn.ts)): a remembered centre of an unmounted turn belongs to an older
frame. A navigation holds the clicked marker for 900 ms (a run for its whole length), and the hold's
expiry recomputes it once if a person scrolled meanwhile ([`activeHold`](activeHold.ts)); a run that
ends without arriving recomputes it at once.

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

Rail, context menu, slider and preview styles are injected from `timeline.css`, `timelineContextMenu.css`, `timelineSlider.css` and `timelinePreview.css` by the view and removed on teardown. Shared theme tokens and
coachmark replicas remain in `src/styles/contentStyle/` because other features use them. Existing
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
Existing parameters and their engine floors remain compatible; the optional shared backend has its
own next-release floor. Both bundled and cached remote manifests run the shared engine. Older extension builds can continue reading these unchanged manifests.
