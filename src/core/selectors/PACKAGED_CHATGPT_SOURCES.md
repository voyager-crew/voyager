# Chatgpt locator trust ledger (2/3)

Part of the [complete trust ledger](PACKAGED_DATA.md). A = action/data/identity proof; B = trusted Voyager UI placement; §6 = packaged protocol. `bundle copy` preserves baseline literals for the named online counterpart. `legacy adapter` retains the pre-branch override path, including OFF semantics. Keys refer to this site’s selector-data fragments or semantic site fields; duplicate source copies share one row.

Parts: [1](PACKAGED_CHATGPT.md), [2](PACKAGED_CHATGPT_SOURCES.md), [3](PACKAGED_CHATGPT_ACTIONS.md).

| Key                              | Tier / delivery | Reason                                                                                                                       |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `export.historyPending`          | A / online      | Decides export readiness; aria-busy/status must identify pending history.                                                    |
| `export.imageGeneration`         | A / packaged    | Only the native imagegen class identifies generated provenance; language-* describes code, and URLs/role also match uploads. |
| `export.legacyAssistant`         | A / packaged    | Legacy assistant-role grammar defines export identity; arbitrary text proves no role.                                        |
| `export.legacyContainer`         | A / packaged    | Legacy role/ID container grammar defines crawl admission; a wrapper alone proves no role.                                    |
| `export.legacyFrame`             | A / packaged    | Legacy role frame defines crawl admission; a renamed frame alone proves no role.                                             |
| `export.legacyUser`              | A / packaged    | Legacy user-role grammar defines export identity; arbitrary text proves no role.                                             |
| `export.loggedOutAssistant`      | A / online      | Supplies exported logged-out replies; complete native roles must agree.                                                      |
| `export.loggedOutMessages`       | A / packaged    | Native logged-out role grammar defines export admission; arbitrary markup proves no role.                                    |
| `export.loggedOutStreaming`      | A / online      | Decides logged-out export readiness; native reply state must agree.                                                          |
| `export.loggedOutThread`         | A / online      | Scopes exported turns; must contain the complete native conversation.                                                        |
| `export.mermaidPreview`          | A / packaged    | Fixed preview-source exclusion prevents a rendered image replacing exported diagram source.                                  |
| `export.roots`                   | A / packaged    | Native main landmark scopes export; no independent identity admits another outer shell.                                      |
| `export.streaming`               | A / online      | Decides export readiness for the current reply; native streaming state must agree.                                           |
| `export.threadList`              | A / online      | Scopes history export; must contain every native conversation-turn-ID node.                                                  |
| `export.turnItem`                | A / packaged    | Native stable-ID grammar binds exported turns; no independent replacement ID source exists.                                  |
| `export.uploadCandidates`        | A / packaged    | Exported uploads need native provenance; arbitrary images cannot prove uploaded origin.                                      |
| `export.userAttachments`         | A / packaged    | Exported attachment inventory needs native provenance; an arbitrary image proves no attachment.                              |
| `export.userBubble`              | A / packaged    | Legacy prompt source uses native role grammar; remote userTurn is the separately proved repair.                              |
| `export.userUnit`                | A / packaged    | Native role grammar binds exported prompts; arbitrary nodes cannot prove user identity.                                      |
| `exportLayout.alignmentCanvas`   | B / online      | Canvas bounds only align Voyager export UI.                                                                                  |
| `exportLayout.alignmentComposer` | B / online      | Composer bounds only align Voyager export UI.                                                                                |
| `exportLayout.broadControls`     | B / online      | Collision probe only positions the Voyager export button.                                                                    |
| `exportLayout.canvasContent`     | B / online      | Canvas content box only positions Voyager export UI.                                                                         |
| `exportLayout.canvasOwner`       | B / online      | Canvas boundary only positions Voyager export UI.                                                                            |
| `exportLayout.controls`          | B / online      | Avoids native controls when placing the Voyager export button.                                                               |
| `exportLayout.fallbackRoot`      | B / online      | Fallback landmark only mounts Voyager export UI.                                                                             |
| `exportLayout.fullscreenCanvas`  | B / online      | Fullscreen probe only positions Voyager export UI.                                                                           |
| `exportLayout.inactiveCanvas`    | B / online      | Inactive Canvas probe only decides Voyager UI visibility.                                                                    |
| `exportLayout.interactive`       | B / online      | Avoids host controls when placing Voyager export UI.                                                                         |
| `exportLayout.overlaySidebar`    | B / online      | Sidebar bounds only position Voyager export UI.                                                                              |
| `exportLayout.turns`             | B / online      | Turn-shaped layout probe only places Voyager export UI; it supplies no turn data.                                            |
| `fallbackRoot`                   | B / bundle copy | Fallback landmark only mounts Voyager export UI. Online counterpart: `exportLayout.fallbackRoot`.                            |
| `fileInput`                      | §6 / packaged   | FileList transfer uses native input[type=file] write semantics.                                                              |
| `fullscreenCanvas`               | B / bundle copy | Fullscreen probe only positions Voyager export UI. Online counterpart: `exportLayout.fullscreenCanvas`.                      |
| `genericComposer`                | A / packaged    | Last editor fallback; another generic editable cannot prove main-composer identity.                                          |
| `guide.overlays`                 | §6 / packaged   | Native menu/dialog association is the guide interaction safety floor.                                                        |
| `handoffObservedAttributes`      | §6 / packaged   | Observed attribute names are an event protocol, not locators.                                                                |
| `headerActions`                  | B / online      | Places Voyager header controls without selecting a host action.                                                              |
| `inactiveCanvas`                 | B / bundle copy | Inactive Canvas probe only decides Voyager UI visibility. Online counterpart: `exportLayout.inactiveCanvas`.                 |
| `input.candidates`               | A / online      | Selects the editor that receives text; requires native editor ownership.                                                     |
| `input.clearance`                | B / online      | Clearance probe only positions Voyager prompt UI.                                                                            |
| `input.fab`                      | B / online      | FAB probe only chooses Voyager prompt-button placement.                                                                      |
| `input.handoff`                  | A / online      | Selects the editor receiving a handoff; requires native editor ownership.                                                    |
