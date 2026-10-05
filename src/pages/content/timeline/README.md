# Timeline ownership

Start with the owner of the behavior being changed. `index.ts` is the `timeline` native feature: it
runs the shared route lifecycle (`runRouteTimeline`) and returns the stop the content script calls on
teardown. `manager.ts` creates a Gemini adapter for the
[shared timeline engine and view](../../../features/timeline/README.md). `GeminiTimelineAdapter.ts`
owns selector discovery, turn collection, scroll viewport discovery and native health reporting.

| Change                                                                              | Owner                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Find turns, stable IDs, prompt/response summaries                                   | `TimelineTurns.ts`                                                 |
| Marker snapshot, star display, Library hydration and verified legacy aliases        | `TimelineState.ts`                                                 |
| Star persistence, migration, serialized writes and cloud merges                     | [Saved Library store](../../../features/savedLibrary/starStore.ts) |
| Scoped hierarchy persistence and level/collapse edits                               | `TimelineHierarchy.ts`                                             |
| Collapsed positions and hidden marker geometry                                      | `TimelineHierarchyGeometry.ts`                                     |
| Dot/preview/shortcut navigation, active turn, scrolling and navigation cancellation | `TimelineNavigation.ts`                                            |
| Rail composition, styling, preview, viewport sync and resize debounce               | `TimelineView.ts`                                                  |
| Marker measurements/geometry, virtual/dense dots, ruler wave and runner animation   | `TimelineDotLayer.ts`                                              |
| Slider geometry, scroll dragging and hover fade                                     | `TimelineSlider.ts`                                                |
| Persisted width/position restoration, migration, dragging and cached placement      | `TimelineRailPlacement.ts`                                         |
| Preview list, search, pinning and compact hover bridge                              | `TimelinePreviewPanel.ts`                                          |
| Preview long-press timing, cancellation and click suppression                       | `TimelinePreviewPress.ts`                                          |
| Hover delay, tooltip content layout and visibility                                  | `TimelineTooltip.ts`                                               |
| Marker clicks, long press and hierarchy menu                                        | `TimelineMarkerInteractions.ts`                                    |
| Timestamp opt-in, draft adoption, history matching and timestamp DOM                | `TimelineTimestamps.ts`                                            |

`TimelineState` owns the marker snapshot and exposes its hierarchy owner directly. Its shared storage
listener routes hierarchy changes after star changes; `TimelineHierarchy` owns the account context
and level/collapse maps. State owns one shared `TimelineHydration` primitive per store for readiness,
read retries and ordering against complete active-scope snapshots. `TimelineDotLayer` owns dot elements and measured positions;
DOM nodes do not belong in persisted state. Owners take their required data/actions explicitly,
without a reference back to the manager. Rendering reads state; user actions and storage events
update state and notify the manager.

A native viewport rebind preserves conversation state. Conversation teardown cancels each owner's
listeners, observers, timers and animation frames. The shared `historyTimestampStore` has page
lifetime: the timestamp owner unsubscribes from it but must not stop it. State and timestamp owners
capture the conversation URL so delayed work retains the correct account and conversation scope.

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

Owner tests exercise DOM behavior and data invariants. The `TimelineManager*` tests cover composition:
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
focus/listener cleanup. [`HighlightTimelineMarkers`](../highlight/HighlightTimelineMarkers.ts) owns
highlight ticks and observes the rail's DOM contract (`.gemini-timeline-bar`,
`.timeline-track-content`, `.timeline-style-compact`). Update its tests when that contract changes;
the two managers do not call each other.
