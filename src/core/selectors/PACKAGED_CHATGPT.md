# Chatgpt locator trust ledger (1/3)

Part of the [complete trust ledger](PACKAGED_DATA.md). A = action/data/identity proof; B = trusted Voyager UI placement; §6 = packaged protocol. `bundle copy` preserves baseline literals for the named online counterpart. `legacy adapter` retains the pre-branch override path, including OFF semantics. Keys refer to this site’s selector-data fragments or semantic site fields; duplicate source copies share one row.

Parts: [1](PACKAGED_CHATGPT.md), [2](PACKAGED_CHATGPT_SOURCES.md), [3](PACKAGED_CHATGPT_ACTIONS.md).

| Key                          | Tier / delivery | Reason                                                                                                      |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `actions.homeLink`           | A / online      | Navigates to the app home; packaged origin/root route proves the href.                                      |
| `actions.newChat`            | A / online      | Navigates to a new chat; native route/action policy proves the control.                                     |
| `actions.shareButton`        | A / online      | Opens host sharing UI; native button/action evidence proves ownership.                                      |
| `actions.temporaryToggle`    | A / online      | Changes temporary-chat state; native toggle identity/state must agree.                                      |
| `actions.thinking`           | A / online      | Reads model state; native model/effort metadata must agree.                                                 |
| `alignmentCanvas`            | B / bundle copy | Canvas bounds only align Voyager export UI. Online counterpart: `exportLayout.alignmentCanvas`.             |
| `alignmentComposer`          | B / bundle copy | Composer bounds only align Voyager export UI. Online counterpart: `exportLayout.alignmentComposer`.         |
| `assistantHeading`           | A / packaged    | Native role heading identifies exported reply content; arbitrary headings cannot prove that role.           |
| `assistantMarkdown`          | A / packaged    | Reply source fallback uses fixed native grammar; arbitrary markup cannot prove a second source.             |
| `assistantTurn`              | A / online      | Determines exported reply identity; native role/identity is required.                                       |
| `assistantUnit`              | A / packaged    | Native role/ID grammar binds exported data to its reply.                                                    |
| `attachmentArea`             | A / packaged    | Handoff inventories files; native attachment membership must stay independent.                              |
| `attachmentBusy`             | §6 / packaged   | Native upload-busy evidence cannot be removed by remote data.                                               |
| `attachmentCards`            | A / packaged    | Handoff inventories files; a filename/remove button cannot prove attachment membership.                     |
| `attachmentControl`          | §6 / packaged   | Native attachment control protocol owns removal and cancellation.                                           |
| `attachmentMarkerAttributes` | §6 / packaged   | Source attribute names are fixed attachment identity protocol.                                              |
| `attachmentMarkers`          | §6 / packaged   | Native attachment markers independently prove pending uploads.                                              |
| `attachmentNotice`           | §6 / packaged   | Native upload-notice evidence cannot be removed by remote data.                                             |
| `attachmentPreview`          | §6 / packaged   | Native upload-preview evidence prevents premature send/handoff.                                             |
| `attachmentProgress`         | §6 / packaged   | Native progress evidence prevents premature send/handoff.                                                   |
| `attachmentRemovalPreview`   | §6 / packaged   | Native removal-preview state cannot be redefined by a repair.                                               |
| `bridge.replyContent`        | A / online      | Supplies bridge reply data; complete text must belong to the proved reply.                                  |
| `broadControls`              | B / bundle copy | Collision probe only positions the Voyager export button. Online counterpart: `exportLayout.broadControls`. |
| `canvasContent`              | B / bundle copy | Canvas content box only positions Voyager export UI. Online counterpart: `exportLayout.canvasContent`.      |
| `canvasOwner`                | B / bundle copy | Canvas boundary only positions Voyager export UI. Online counterpart: `exportLayout.canvasOwner`.           |
| `codeBlock`                  | A / online      | Supplies copied/exported code; native source and complete ownership are required.                           |
| `composer`                   | A / online      | Selects a host editor for text insertion; native ownership must remain independent.                         |
| `composerCandidates`         | A / packaged    | Compatibility editor fallback; another editor cannot be proved without native ownership.                    |
| `composerEditable`           | §6 / packaged   | Native editable types define write and cancellation behavior.                                               |
| `composerLabelAttributes`    | A / packaged    | Handoff label precedence is fixed source grammar; another attribute cannot prove its meaning.               |
| `composerNativeEditable`     | §6 / packaged   | Independent native editable witness cannot be supplied by a remote repair.                                  |
| `composerNativeRoot`         | §6 / packaged   | Independent native ownership witness cannot be supplied by a remote repair.                                 |
| `composerPlaceholder`        | A / packaged    | Handoff source text uses native placeholder evidence; another string cannot certify the editor.             |
| `composerRoot`               | A / online      | Scopes send/upload operations; needs independent editor and submit ownership.                               |
| `composerRootFallback`       | §6 / packaged   | Native form fallback supplies independent write/send association.                                           |
| `controls`                   | B / bundle copy | Avoids native controls when placing the Voyager export button. Online counterpart: `exportLayout.controls`. |
| `export.activeConversation`  | A / packaged    | Current-route identity binds export; a remote value cannot define active-chat identity.                     |
| `export.assistantContent`    | A / online      | Supplies exported reply text; must preserve the complete proved reply.                                      |
| `export.attachmentAction`    | A / packaged    | Exported attachment action metadata uses fixed source grammar; another label proves no provenance.          |
| `export.codeLanguage`        | A / online      | Supplies exported code language; language-* metadata must corroborate the label.                            |
| `export.copyExcluded`        | A / packaged    | Fixed native serialization exclusions prevent toolbar text entering exported content.                       |
| `export.desktopTurns`        | A / packaged    | Native turn-ID grammar defines crawl admission; another wrapper proves no turn ID.                          |
