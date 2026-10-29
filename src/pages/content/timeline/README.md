# Timeline ownership

Start with the owner of the behavior being changed. The fixed builtin `voyager.gemini-timeline`
starts the shared `turnNavigator` entry through `pluginHandler.ts` at the original heavy-feature
start point, after the history and message timestamp page services. PluginHost owns the native
master setting through its existing legacy binding. The Gemini backend in
`features/timeline/adapters/gemini/activateSharedGeminiTimeline.ts` waits for both page caches and
retains native sync settings, storage and identity. `startGeminiTimelineRail.ts` owns Gemini's
route/DOM lifetime and synchronous stop. Scope abort
stops the rail before the plugin cleanup ledger drains. The migrated native registry entry is retired in stage 7. Rolling back to the native rail means
reverting both stage 7 retirement commits (9c2161df, 0ae260c1) and the commit that removed the
`legacy` owner option. The official handler continues to use this module. Local `turnNavigator` with literal `dataBackend: "shared"`
uses this rail and native data policy after both page caches are ready. It inherits the official
admission but follows its own plugin switch. Both rails claim the same exclusive resource;
turn off the current holder to hand over. Shared identity overrides, Business, Enterprise and
custom-website coverage are refused. Both official and local activations create a Gemini adapter
for the [shared timeline engine and view](../../../features/timeline/README.md). `GeminiTimelineAdapter.ts`
supplies native storage, the time reader and scroll viewport discovery. `GeminiTimelineTurnSource.ts`
owns selector discovery and turn collection; only the rail's source reports native health.

| Change                                                                              | Owner                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Find turns, stable IDs, prompt/response summaries                                   | `TimelineTurns.ts`                                                           |
| Marker snapshot, star display, Library hydration and verified legacy aliases        | `TimelineState.ts`                                                           |
| Star persistence, migration, serialized writes and cloud merges                     | [Saved Library store](../../../features/savedLibrary/starStore.ts)           |
| Scoped hierarchy persistence and level/collapse edits                               | `TimelineHierarchy.ts`                                                       |
| Collapsed positions and hidden marker geometry                                      | `TimelineHierarchyGeometry.ts`                                               |
| Dot/preview/shortcut navigation, active turn, scrolling and navigation cancellation | `TimelineNavigation.ts`                                                      |
| Rail composition, styling, preview, viewport sync and resize debounce               | `TimelineView.ts`                                                            |
| Marker measurements/geometry, virtual/dense dots, ruler wave and runner animation   | `TimelineDotLayer.ts`                                                        |
| Slider geometry, scroll dragging and hover fade                                     | `TimelineSlider.ts`                                                          |
| Persisted width/position restoration, migration, dragging and cached placement      | `TimelineRailPlacement.ts`                                                   |
| Preview list, search, pinning and compact hover bridge                              | `TimelinePreviewPanel.ts`                                                    |
| Preview long-press timing, cancellation and click suppression                       | `TimelinePreviewPress.ts`                                                    |
| Hover delay, tooltip content layout and visibility                                  | `TimelineTooltip.ts`                                                         |
| Marker clicks, long press and hierarchy menu                                        | `TimelineMarkerInteractions.ts`                                              |
| Timestamp opt-in and the shared page cache                                          | [`messageTimestampPageService`](../timestamp/messageTimestampPageService.ts) |
| Draft adoption, history matching and message label ownership                        | [`MessageTimestamps`](../timestamp/MessageTimestamps.ts)                     |
| Route-scoped timestamp DOM discovery and remount observation                        | [`messageTimestampCollector`](../timestamp/messageTimestampCollector.ts)     |
| Read-only rail timestamps and history alias refresh                                 | `TimelineTimestamps.ts`                                                      |

The engine reads marker snapshots and edits stars/levels through the shared `TimelineDataSession`
interface, whose factory retains this adapter's native storage policy. `TimelineState` implements
that route-owned session; its public hierarchy surface exposes only level/collapse reads and edits.
Its shared storage
listener routes hierarchy changes after star changes; `TimelineHierarchy` owns the account context
and level/collapse maps. State owns one shared `TimelineHydration` primitive per store for readiness,
read retries and ordering against complete active-scope snapshots. `TimelineDotLayer` owns dot elements and measured positions;
DOM nodes do not belong in persisted state. Owners take their required data/actions explicitly,
without a reference back to the manager. Rendering reads state; user actions and storage events
update state and notify the manager.

A native viewport rebind preserves conversation state. Conversation teardown cancels each owner's
listeners, observers, timers and animation frames. The shared `historyTimestampStore` has page
lifetime and one owner, [`historyTimestampPageService`](../timestamp/historyTimestampPageService.ts):
the timestamp owners wait for it and subscribe, but never start or stop it. Each navigation owner
holds a keyboard shortcut lease and releases it on teardown. State and timestamp owners
capture the conversation URL so delayed work retains the correct account and conversation scope.

`gvTimelineEnabled` controls only the Gemini rail. Message time labels and recording belong to the
page service and follow `gvShowMessageTimestamps` independently. Its route collectors share one
`TimestampService`, so a delayed write from one conversation cannot replace another route's cache.
A route change retires its old collector immediately; the next waits for Gemini's router to render.
The collector watches the body to detect replacement of `main`, ignores its own label mutations and
owns every label it creates, including nodes in detached roots. Rail cleanup stops neither timestamp
page service. The rail time reader keeps an independent history subscription for alias-driven star
refreshes even when message time display is off.

Keep these less obvious boundaries intact:

- Gemini turn selectors come from [`@/core/gemini/turnSelectors`](../../../core/gemini/turnSelectors.ts),
  read at query time. Its keys are not interchangeable: each keeps the entries and order its owners
  relied on, and detection order decides which selector the timeline stores.

- A mounted `u-N` is a DOM-window position. Only a complete history mapping can prove that it is a
  stored full-conversation alias. Use `TimelineState` for alias resolution before star/hierarchy edits.
- Placement restoration belongs to `TimelineRailPlacement`, including the v1 pixel-to-v2 percentage
  migration. The manager loads settings and preserves application order; it does not write placement
  or measured-marker fields. `TimelineView.measureMarkers` updates the dot measurements and viewport span.
- A state repaint preserves the user's manually scrolled rail position. Synchronize the rail to the
  native viewport only for navigation, native scrolling or layout changes that require it.
- Keep setup and cleanup together when moving UI behavior. Closing a surface must cancel its pending
  work, including callbacks that have not yet made anything visible.

Owner tests exercise DOM behavior and data invariants. The `TimelineManager*` tests now compose the
shared engine with the Gemini adapter and cover composition:
viewport replacement, real navigation surfaces, initialization and teardown. Migrate those assertions
with their owner instead of retaining private manager forwarding methods for old tests.

State, hierarchy, geometry, view, navigation and interaction owners in the table live in
`src/features/timeline/`. Gemini supplies `GeminiTimelineStorage.ts`, turns and timestamps from this
directory. Hierarchy serialized formats, legacy localStorage keys and account isolation remain
unchanged. Every timeline reads and writes stars through the Saved Library client; the background
store owns the neutral star snapshot and its v1 compatibility projection. Old page star arrays are
left untouched and are never read or imported.

## Highlight integration

[`../highlight/manager.ts`](../highlight/manager.ts) owns account/route loading, records, text anchors
and mutations. [`HighlightEditor`](../highlight/HighlightEditor.ts) owns the annotation popover and
focus/listener cleanup. [`HighlightTimelineAnnotations`](../highlight/highlightTimelineAnnotations.ts)
publishes each visible highlight to the page-wide
[`timelineAnnotations`](../../../features/timeline/timelineAnnotations.ts) registry as plain data:
its turn's marker id (from `readServerTurnId`), how far down that turn the mark sits, a tick colour
and a label. The timeline's [`TimelineAnnotationLayer`](../../../features/timeline/TimelineAnnotationLayer.ts)
places and draws the ticks in every rail style, including collapsed and dense rails, and hands a
click back to the publisher. Neither side reads the other's DOM, and the two managers do not call
each other.
