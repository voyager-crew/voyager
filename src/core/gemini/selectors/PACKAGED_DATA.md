# Gemini locator trust ledger (1/5)

Part of the [complete trust ledger](../../selectors/PACKAGED_DATA.md). A = action/data/identity proof; B = trusted Voyager UI placement; §6 = packaged protocol. `bundle copy` preserves baseline literals for the named online counterpart. `legacy adapter` retains the pre-branch override path, including OFF semantics. Keys refer to this site’s selector-data fragments or semantic site fields; duplicate source copies share one row.

Parts: [1](PACKAGED_DATA.md), [2](PACKAGED_SURFACES.md), [3](PACKAGED_CONTENT.md), [4](PACKAGED_INPUT.md), [5](PACKAGED_ACTIONS.md).

| Key                                | Tier / delivery | Reason                                                                                                                                                |
| ---------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionsContainer`                 | A / bundle copy | Scopes sidebar actions; independent toggle/new-chat association must prove ownership. Online counterpart: `sidebar.actionsContainer`.                 |
| `activity.inputs`                  | A / online      | Captures sent prompts for activity; native editor ownership proves the input.                                                                         |
| `activity.owner`                   | A / packaged    | Activity records require native composer ownership; another wrapper proves no send owner.                                                             |
| `activity.send`                    | §6 / packaged   | Native send-control association is the event protocol for activity recording.                                                                         |
| `alignmentCanvas`                  | B / bundle copy | Canvas bounds only align Voyager export UI. Online counterpart: `exportLayout.alignmentCanvas`.                                                       |
| `alignmentComposer`                | B / bundle copy | Composer bounds only align Voyager export UI. Online counterpart: `exportLayout.alignmentComposer`.                                                   |
| `assistantTurn`                    | A / packaged    | Native semantic evidence stays independent; specific turn/composer/code profiles repair consumers, while another semantic source cannot prove itself. |
| `avoidRow`                         | §6 / packaged   | Boolean toolbar algorithm option, not a locator.                                                                                                      |
| `broadControls`                    | B / bundle copy | Collision probe only positions the Voyager export button. Online counterpart: `exportLayout.broadControls`.                                           |
| `canvas.codeEditor`                | A / packaged    | Exported editor content needs native editor/source grammar; another editable cannot prove code ownership.                                             |
| `canvas.codeLanguage`              | A / packaged    | Exported language uses native metadata; arbitrary labels cannot prove language identity.                                                              |
| `canvas.codeLine`                  | A / packaged    | Exported line boundaries use native editor grammar; arbitrary text nodes cannot prove source-line identity.                                           |
| `canvas.codeLines`                 | A / packaged    | Exported line ordering uses native editor grammar; an arbitrary collection cannot prove original source order.                                        |
| `canvas.codePanels`                | A / online      | Supplies exported Canvas code/title; independent source/title ownership proves the panel.                                                             |
| `canvas.codeTitle`                 | A / packaged    | Exported filename uses native title precedence; arbitrary labels cannot prove the document title.                                                     |
| `canvas.documentEditors`           | A / online      | Complete native ProseMirror immediate shells must belong to fixed Canvas owners.                                                                      |
| `canvas.documentTitleInputs`       | A / packaged    | Exported title-input value has no independent canonical title witness.                                                                                |
| `canvas.documentTitles`            | A / packaged    | Exported document title has no independent canonical witness outside native title metadata.                                                           |
| `canvas.indicators`                | A / packaged    | Native Canvas source/state indicators are the document admission witness; arbitrary marks prove no document identity.                                 |
| `canvas.proseMirror`               | A / packaged    | Native ProseMirror content is the independent document-editor witness; another source cannot certify itself.                                          |
| `canvasContent`                    | B / bundle copy | Canvas content box only positions Voyager export UI. Online counterpart: `exportLayout.canvasContent`.                                                |
| `canvasEntry.downloadItem`         | §6 / packaged   | Native download command identity is fixed interaction protocol.                                                                                       |
| `canvasEntry.editor`               | A / packaged    | Supplies exported Canvas content; arbitrary editable content cannot prove document ownership.                                                         |
| `canvasEntry.menus`                | A / online      | Native menu/download_md action and unique expanded ARIA controller must bind it to the original Canvas document.                                      |
| `canvasEntry.owner`                | A / packaged    | Scopes Canvas export; arbitrary wrappers cannot prove the native editor/action owner.                                                                 |
| `canvasOwner`                      | B / bundle copy | Canvas boundary only positions Voyager export UI. Online counterpart: `exportLayout.canvasOwner`.                                                     |
| `code.buttons`                     | B / online      | Places the Voyager code-collapse toggle beside native buttons only.                                                                                   |
| `code.content`                     | A / packaged    | Exported code source follows native grammar; arbitrary text cannot prove original code.                                                               |
| `code.decoration`                  | §6 / packaged   | Native decoration is independent code-host proof, not remote placement evidence.                                                                      |
| `code.host`                        | A / online      | Supplies copied/exported code; independent native code and decoration prove its complete owner.                                                       |
| `code.language`                    | A / packaged    | Exported language follows native metadata; arbitrary header text cannot prove language.                                                               |
| `code.shell`                       | §6 / packaged   | Native shell is independent code-host proof, not remote placement evidence.                                                                           |
| `codeBlock`                        | A / packaged    | Native semantic evidence stays independent; specific turn/composer/code profiles repair consumers, while another semantic source cannot prove itself. |
| `composer`                         | A / packaged    | Native semantic evidence stays independent; specific turn/composer/code profiles repair consumers, while another semantic source cannot prove itself. |
| `composer.candidates`              | A / online      | Selects the editor for text insertion; independent native editor ownership is required.                                                               |
| `composer.draftCandidates`         | A / online      | Reads/writes persisted drafts; independent native editor ownership is required.                                                                       |
| `composer.draftEditExclusion`      | §6 / packaged   | Inline-edit rejection floor prevents drafts from targeting another edit session.                                                                      |
| `composer.draftPlaceholderHost`    | A / packaged    | Draft placeholder source has native precedence; arbitrary text cannot prove input state.                                                              |
| `composer.keyEditables`            | §6 / packaged   | Native editable/event grammar is the send safety floor.                                                                                               |
| `composer.notificationGenerating`  | §6 / packaged   | Native generation evidence determines notification timing.                                                                                            |
| `composer.notificationInteraction` | §6 / packaged   | Native interaction evidence determines notification cancellation.                                                                                     |
| `composer.notificationTyping`      | §6 / packaged   | Native typing evidence determines notification cancellation.                                                                                          |
| `composer.semanticInput`           | §6 / packaged   | Independent native editable/health witness cannot certify itself remotely.                                                                            |
| `composer.sendContainers`          | A / online      | Selects the owner of a send; requires independently proved editor and control.                                                                        |
| `composer.uploadPreview`           | §6 / packaged   | Native upload witness independently prevents premature send/completion.                                                                               |
| `composer.uploadPreviewFallback`   | §6 / packaged   | Native fallback upload witness independently prevents premature send/completion.                                                                      |
| `composerRoot`                     | A / packaged    | Native semantic evidence stays independent; specific turn/composer/code profiles repair consumers, while another semantic source cannot prove itself. |
| `content`                          | §6 / packaged   | Native sidebar content grammar supplies independent ownership evidence.                                                                               |
| `content.answer`                   | A / online      | Supplies saved/exported reply text; complete native reply ownership is required.                                                                      |
| `content.highlightRoot`            | A / packaged    | Saved highlight source depends on native content boundaries; arbitrary wrappers cannot prove stable source coordinates.                               |
| `content.timelinePreview`          | A / packaged    | Stored timeline preview preference has no independent witness for a different preferred text subset.                                                  |
| `content.userLines`                | A / online      | Supplies saved/exported prompt text; complete native user-turn ownership is required.                                                                 |
| `contentInner`                     | §6 / packaged   | Native sidebar inner-content grammar supplies independent state/layout evidence.                                                                      |
| `context.images`                   | A / online      | Supplies images for stored/exported context; native source and turn ownership are required.                                                           |
| `context.users`                    | A / online      | Captured prompt bodies require complete independently owned turns and native content leaves.                                                          |
| `context.responses`                | A / online      | Captured reply bodies require complete independently owned turns and native content leaves.                                                           |
| `controls`                         | B / bundle copy | Avoids native controls when placing the Voyager export button. Online counterpart: `exportLayout.controls`.                                           |
| `conversation.roots`               | A / online      | Scopes conversation operations; must be the scrolling common ancestor of every proved turn.                                                           |
| `currentIcon`                      | A / packaged    | Current Gem icon has no independent canonical source outside the native icon field.                                                                   |
| `currentName`                      | A / packaged    | Current Gem name has no independent canonical source outside the native name field.                                                                   |
| `daily`                            | A / packaged    | Cached daily usage uses native value/label grammar; arbitrary numbers cannot prove this metric.                                                       |
| `deepResearch.browseDomain`        | A / packaged    | Exported citation domain uses native source grammar; arbitrary labels prove no domain attribution.                                                    |
