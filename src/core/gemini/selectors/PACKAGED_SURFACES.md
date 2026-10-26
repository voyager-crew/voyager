# Gemini locator trust ledger (2/5)

Part of the [complete trust ledger](../../selectors/PACKAGED_DATA.md). A = action/data/identity proof; B = trusted Voyager UI placement; §6 = packaged protocol. `bundle copy` preserves baseline literals for the named online counterpart. `legacy adapter` retains the pre-branch override path, including OFF semantics. Keys refer to this site’s selector-data fragments or semantic site fields; duplicate source copies share one row.

Parts: [1](PACKAGED_DATA.md), [2](PACKAGED_SURFACES.md), [3](PACKAGED_CONTENT.md), [4](PACKAGED_INPUT.md), [5](PACKAGED_ACTIONS.md).

| Key                              | Tier / delivery | Reason                                                                                                                 |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `deepResearch.browseLinks`       | A / packaged    | Exported citations use fixed href/source protocol; a remote link cannot prove its own provenance.                      |
| `deepResearch.browseList`        | A / packaged    | Exported browse ordering uses native source grammar; another list proves no provenance.                                |
| `deepResearch.browseTitle`       | A / packaged    | Exported citation title uses native source grammar; arbitrary text proves no citation attribution.                     |
| `deepResearch.documentTitle`     | A / packaged    | Exported filename/title has no independent canonical title witness outside the native source.                          |
| `deepResearch.items`             | A / online      | Exports research items; native browse links and current-reply ownership prove each item.                               |
| `deepResearch.menuContent`       | §6 / packaged   | Native menu-content grammar supplies independent action association.                                                   |
| `deepResearch.menuExport`        | §6 / packaged   | Native export action identity is fixed interaction protocol.                                                           |
| `deepResearch.menuPanel`         | §6 / packaged   | Native ARIA menu role supplies independent action association.                                                         |
| `deepResearch.menuShare`         | §6 / packaged   | Native share action identity is fixed interaction protocol.                                                            |
| `deepResearch.panel`             | A / online      | Scopes research export; protocol browse evidence must belong to the current reply.                                     |
| `deepResearch.reportCandidates`  | A / online      | Exports report text; protocol browse evidence and current-reply ownership prove the report.                            |
| `deepResearch.reportHeadings`    | A / packaged    | Exported title fallback has native precedence; arbitrary headings prove no document title.                             |
| `deepResearch.thinkingPanels`    | A / online      | Exports research reasoning; browse protocol and current-reply ownership prove its panel.                               |
| `deepResearch.thought`           | A / packaged    | Exported thought order uses native source grammar; arbitrary text cannot prove a thought boundary.                     |
| `deepResearch.thoughtContent`    | A / packaged    | Exported thought content uses native grammar; arbitrary text proves no thought role.                                   |
| `deepResearch.thoughtHeader`     | A / packaged    | Exported thought heading uses native source grammar; arbitrary headings prove no thought role.                         |
| `descriptionEvidence`            | §6 / packaged   | Native Gem URL/row/source evidence or exclusion supplies independent Gem ownership proof.                              |
| `excluded`                       | §6 / packaged   | Native Gem URL/row/source evidence or exclusion supplies independent Gem ownership proof.                              |
| `export.assistantFallback`       | A / packaged    | Legacy reply fallback uses native role/source grammar; another body cannot prove assistant attribution.                |
| `export.attachmentPreviewOwner`  | A / packaged    | Preview-to-upload attribution is native provenance grammar; arbitrary wrapping cannot prove the same attachment.       |
| `export.codeOwner`               | A / packaged    | Native code ownership deduplicates exported source; arbitrary ancestors cannot prove code provenance.                  |
| `export.collectorAnswer`         | A / packaged    | Answer collection uses native reply grammar; another candidate cannot prove reply role independently.                  |
| `export.fallbackClass`           | A / packaged    | Fallback content classification uses native grammar; arbitrary matching classes cannot prove source identity.          |
| `export.filePreviews`            | A / packaged    | Exported preview metadata uses native attachment grammar; arbitrary previews cannot prove uploaded provenance.         |
| `export.markdown`                | A / packaged    | Markdown source preference uses native grammar; another subset has no independent completeness witness.                |
| `export.menuResponseOwner`       | A / packaged    | Menu export binds to a native reply owner; arbitrary menu ancestry cannot prove the intended reply.                    |
| `export.messageContent`          | A / packaged    | Native message source is the independent witness for content.answer; a second alias cannot prove another source.       |
| `export.presentedAncestor`       | A / packaged    | Presented-content ancestry is native serialization grammar; arbitrary wrappers cannot prove presented source identity. |
| `export.presentedContent`        | A / packaged    | Presented source preference has no independent canonical-content witness for another subset.                           |
| `export.rawCode`                 | A / packaged    | Raw exported code uses native source grammar; arbitrary text cannot prove original unrendered source.                  |
| `export.responseElement`         | A / packaged    | Native response element binds export to a role; another tag cannot prove response identity.                            |
| `export.responseOwner`           | A / packaged    | Native response ownership binds exported data to its reply; arbitrary ancestors cannot prove that identity.            |
| `export.sourcePrompt`            | A / packaged    | Exported prompt provenance follows native role grammar; another text region cannot prove sent-prompt attribution.      |
| `export.sourcePromptMarkup`      | A / packaged    | Prompt markup interpretation uses native source grammar; another wrapper cannot prove authored content.                |
| `export.thoughts`                | A / packaged    | Exported reasoning boundaries follow native source grammar; arbitrary paragraphs cannot prove reasoning role.          |
| `export.uploadedFiles`           | A / packaged    | Exported file inventory needs native attachment provenance; arbitrary file-like markup cannot prove it.                |
| `export.userImages`              | A / packaged    | Exported user-image inventory needs native upload provenance; an arbitrary image cannot prove it.                      |
| `export.userLinesFallback`       | A / packaged    | Legacy prompt-line preference uses native grammar; another subset has no independent source witness.                   |
| `export.walkMarkdown`            | A / packaged    | Markdown traversal uses native serialization grammar; arbitrary wrappers cannot prove equivalent content order.        |
| `exportEntry.logo`               | A / packaged    | Exported branding uses the native logo source; arbitrary artwork cannot prove logo identity.                           |
| `exportLayout.alignmentCanvas`   | B / online      | Canvas bounds only align Voyager export UI.                                                                            |
| `exportLayout.alignmentComposer` | B / online      | Composer bounds only align Voyager export UI.                                                                          |
| `exportLayout.broadControls`     | B / online      | Collision probe only positions the Voyager export button.                                                              |
| `exportLayout.canvasContent`     | B / online      | Canvas content box only positions Voyager export UI.                                                                   |
| `exportLayout.canvasOwner`       | B / online      | Canvas boundary only positions Voyager export UI.                                                                      |
| `exportLayout.controls`          | B / online      | Avoids native controls when placing the Voyager export button.                                                         |
| `exportLayout.fallbackRoot`      | B / online      | Fallback landmark only mounts Voyager export UI.                                                                       |
| `exportLayout.fullscreenCanvas`  | B / online      | Fullscreen probe only positions Voyager export UI.                                                                     |
| `exportLayout.inactiveCanvas`    | B / online      | Inactive Canvas probe only decides Voyager UI visibility.                                                              |
| `exportLayout.interactive`       | B / online      | Avoids host controls when placing Voyager export UI. Dormant while packaged avoidRow is false on this site.            |
| `exportLayout.overlaySidebar`    | B / online      | Sidebar bounds only position Voyager export UI.                                                                        |
| `exportLayout.turns`             | B / online      | Turn-shaped layout probe only places Voyager export UI; it supplies no turn data.                                      |
| `exportOverlay.canvas`           | B / online      | Only positions, aligns or avoids the Voyager export toolbar.                                                           |
| `exportOverlay.composer`         | B / online      | Only positions, aligns or avoids the Voyager export toolbar.                                                           |
| `exportToolbar.broadControls`    | §6 / packaged   | Dormant compatibility fragment; the live Voyager toolbar uses exportLayout profiles.                                   |
| `exportToolbar.canvasContent`    | §6 / packaged   | Dormant compatibility fragment; the live Voyager toolbar uses exportLayout profiles.                                   |
| `exportToolbar.canvasOwner`      | §6 / packaged   | Dormant compatibility fragment; the live Voyager toolbar uses exportLayout profiles.                                   |
| `exportToolbar.controls`         | §6 / packaged   | Dormant compatibility fragment; the live Voyager toolbar uses exportLayout profiles.                                   |
| `exportToolbar.inactiveCanvas`   | §6 / packaged   | Dormant compatibility fragment; the live Voyager toolbar uses exportLayout profiles.                                   |
| `fallbackRoot`                   | B / bundle copy | Fallback landmark only mounts Voyager export UI. Online counterpart: `exportLayout.fallbackRoot`.                      |
