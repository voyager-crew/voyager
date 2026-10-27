# Export ownership

Start with the owner of the behavior being changed. `index.ts` is the composition root: it
resolves the export site once per page, creates the runner, and mounts the entry points
(persistent toolbar, conversation/response menus, logo dropdown, copy-as-image). An official
plugin mounts them and calls the returned stop when it unmounts: `voyager.gemini-export`
(`pluginHandler.ts`, admitted by `geminiBuiltinStartup.startExport`), and every other host through
the `conversationExport` primitive (`voyager.chatgpt-export`, `voyager.deepseek-export`). Stopping
removes every entry point, closes the dialog and cancels the active run. File writing
(JSON/Markdown/PDF/image) lives in `src/features/export/`; it renders only content that was read
from the page beforehand (`extractTurnContent` with an extractor from `createContentExtractor`).

The primitive picks the site's reader with `exportSiteFor` (`sites/resolveExportSite.ts`): a site
Voyager ships a reader for (ChatGPT's thread crawl, keyed by the bundled site id) keeps it, and
answers the popup's export card when its entry points say `opensFromPopup`; any other site uses
`sites/catalogSite.ts`, with facts in the adapter's versioned `export` descriptor. `catalogReader.ts` snapshots mounted messages or
crawls a virtual list. Virtual reading requires `export.messageKey`; without a key, use
`mounted` to read the current DOM once in order, always with `unknown` completeness.
`catalogReaderMerge.ts` orders keyed messages with adjacent-window constraints and a Kahn
topological sort, breaking ties by first appearance; contradictory constraints are uncertain.
A `messageKey` site must guarantee that DOM order within each mounted window equals conversation order.
A pinned message that never reappears has no later ordering evidence, so unrelated keys retain first-appearance order.
During continuous streaming each dirty poll still extracts the entire mounted window, and
content clones remain until selection ends; incremental extraction is outside this phase. A read
claims completeness only after stable top and bottom boundaries with no interruption or
identity ambiguity and configured generation detection. The runner warns before selection for partial/unknown reads and stops
on generation or route changes. The primitive's scope owns its toolbar, dialog and active run.
The `export` descriptor (including `read`, `messageKey`, `title` and `generating`) accepts remote updates like other selectors: catalog maintainers are trusted to maintain these export completeness and reading policies.

| Change                                                                               | Owner                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Platform selectors, titles and content dialect; ChatGPT crawl, session, thread watch | `adapter/`                                                                           |
| Per-host export: label, entry points, turn source, lazy history; site registration   | `exportSite.ts`, `sites/` (+ `adapter/platformAdapters.ts`)                          |
| Read turns and selectable messages from the page, Canvas snapshots, message ids      | `conversationCollector.ts` (+ `conversationDom.ts`, shared with fork)                |
| One export run: preload, resume, preparation/release, final export, operation abort  | `exportRun.ts` (+ `preparedExport.ts`, `pendingExportState.ts`, `topNodePreload.ts`) |
| Selection mode: checkboxes, bar, role filters, lazy-load refresh, Cancel/Escape      | `exportSelectionSession.ts` (DOM), `exportSelectionMachine.ts` (states and effects)  |
| ChatGPT crawl progress (turns read) and its Cancel                                   | `chatgptCrawlProgress.ts`                                                            |
| Export turn anchor health after collection                                           | `exportRun.ts`, `exportHealth.ts`                                                    |
| Shared cancellation checks                                                           | `exportCancellation.ts`                                                              |
| Centring the selection bar over the conversation                                     | `exportOverlayUi.ts`                                                                 |
| Generated-UI iframe screenshots and their permission prompt                          | `generatedUiScreenshots.ts`                                                          |
| Export item in Gemini conversation / sidebar / response menus                        | `conversationMenuExportObserver.ts` (+ `conversationMenuInjection.ts`)               |
| Opening a sidebar conversation before exporting it                                   | `sidebarConversationNavigation.ts`                                                   |
| Copy a single response as an image (button, width menu, Safari fallbacks)            | `responseCopyImageAction.ts`                                                         |
| Gemini export as the `voyager.gemini-export` official plugin                         | `pluginHandler.ts`                                                                   |
| Logo dropdown button (old Gemini layout) and its re-creation after re-renders        | `logoExportButton.ts`                                                                |
| Always-visible toolbar (lr26 Gemini, ChatGPT and other plugin hosts)                 | `persistentExportToolbar.ts`, `exportEntryGate.ts`                                   |
| Where that toolbar sits and which host controls it keeps clear of                    | `toolbarPlacement.ts`, `toolbarAvoidance.ts`, `toolbarOcclusion.ts`                  |
| Dragging that toolbar and remembering its spot per site                              | `toolbarDrag.ts`, `toolbarPosition.ts`                                               |
| Dictionaries, language reads and the `t()` used by every export surface              | `exportLocale.ts`                                                                    |
| Progress, outcome and problem toasts of every export surface                         | `src/features/export/ui/exportToasts.ts`                                             |

Each owner takes its dependencies explicitly (site, translator, callbacks) and keeps
its listeners, observers and timers beside the code that installs them. Page-wide observers
(menu watcher, copy-image buttons) are singletons that stop on `beforeunload` or when the plugin
unmounts, removing what they injected. The runner is the only
owner of the active export operation: a new run aborts the previous one and dismisses its
selection UI.

Keep these less obvious boundaries intact:

- Gemini's preload click can reload the page. `exportRun.ts` persists the run in sessionStorage
  before clicking; `startExportButton` resumes it on the page's first plugin mount, so only while
  `voyager.gemini-export` is on. A remount on the same page (switch off and on) does not resume,
  and page teardown cancels without clearing the stored run. Do not move that persist after the click.
- `generatedUiScreenshots.ensureGeneratedUiScreenshotPermission()` must run while the user gesture
  is still valid: before the run in the dialog, and before `takeSelection()` in selection mode.
- `exportRun.ts` awaits `preparedExport.runPreparedExport()` through the entire selection session.
  A turn source's `prepare()` returns a session that owns what it read (ChatGPT: the crawl, the
  thread watch and the checkbox hosts) and stands in for the source until it is released after
  selection ends, including cancellation, teardown and failures. Starting a preparation releases
  the previous one, so an older run can never publish over a newer run.
- Final builders read Saved Library stars once per build; selection needs no star input.
  Gemini keeps its verified stored turn aliases. ChatGPT captures the timeline's normalized
  user-bubble hash during the existing crawl or selected-prompt extraction; assistant-only
  retained selections resolve only their paired prompt. Read failures reject; no page star
  cache or mirror participates.
- Fork and export share Gemini pairing (`conversationDom.ts`) but not ids: fork keeps `makeTurnId`
  (`fork/turnId.ts`); export keeps `resolveUniqueExportTurnIds` (`selectionIds.ts`).
- Selection UI is removed (`takeSelection()`) before screenshots so it is not captured.
- Opening a sidebar conversation uses the native link click; the `location.assign` fallback is the
  only full navigation and is pre-existing.

Owner tests exercise DOM behavior through each module's interface: `exportRun.test.ts` covers a run
end to end with a fake site, `exportSelectionSession.test.ts` the selection UI.
