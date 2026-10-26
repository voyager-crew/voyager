# Gemini packaged page-data ledger

Part of the [Gemini data README](README.md#packaged-only-boundaries) and the [shared ledger](../../selectors/PACKAGED_DATA.md). Every unpublished JSON fragment is listed, including unsuffixed files. **No independent proof** records a real limitation: a renamable class can break and needs a packaged proof before its replacement can be accepted. Original design §6 protocols remain packaged.

## activity-packaged.json

| Exact retained keys               | Reason                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `activity.send`, `activity.owner` | Send/action ownership and timestamp recording protocol (§6). The candidate input is independently repaired through activity.inputs. |

## canvas-entry.json

| Exact retained keys | Reason                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `canvasEntry.menus` | Native menu role plus Gemini owner/association defines the action entry. No independent proof admits a differently owned menu without changing the interaction protocol. |

## canvas-packaged.json

| Exact retained keys                                                                                                                                                                                                               | Reason                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas.documentEditors`, `canvas.proseMirror`, `canvas.documentTitles`, `canvas.documentTitleInputs`, `canvas.codeEditor`, `canvas.codeLines`, `canvas.codeLine`, `canvas.codeTitle`, `canvas.codeLanguage`, `canvas.indicators` | Canvas document repair has no independent proof: inline title-container and panel toolbar titles do not identify the original document editor. Code lines/language/title and document serialization remain the source protocol; the code-panel owner alone is remotely repairable. |

## code-packaged.json

| Exact retained keys                                                              | Reason                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code.content`, `code.decoration`, `code.buttons`, `code.language`, `code.shell` | Source, language, toolbar and clip relationships within the already proved code host. These define copying/serialization and control placement (§6); code.host is the single remote owner. |

## composer-draft-packaged.json

| Exact retained keys                                                                                                                                                  | Reason                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `composer.draftEditExclusion`, `composer.draftPlaceholderHost`, `composer.notificationInteraction`, `composer.notificationTyping`, `composer.notificationGenerating` | Inline-edit exclusions, placeholder source and interaction/typing/generation refusal predicates. Remote data cannot remove the draft/send safety floor (§6). |

## composer-packaged.json

| Exact retained keys                                                                  | Reason                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composer.uploadPreview`, `composer.uploadPreviewFallback`, `composer.semanticInput` | Upload evidence and native semantic input witness. The native editable probe already identifies the admissible editor; aliases must not redefine independent health or upload readiness (§6). |

## composer-send-packaged.json

| Exact retained keys     | Reason                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `composer.keyEditables` | Standard editable/event protocol, never remotely mutable (§6). |

## content-packaged.json

| Exact retained keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Reason                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export.presentedAncestor`, `export.presentedContent`, `export.responseElement`, `export.userImages`, `export.uploadedFiles`, `export.filePreviews`, `content.timelinePreview`, `content.highlightRoot`, `export.messageContent`, `export.thoughts`, `export.rawCode`, `export.codeOwner`, `export.responseOwner`, `export.walkMarkdown`, `export.markdown`, `export.assistantFallback`, `export.fallbackClass`, `export.sourcePrompt`, `export.sourcePromptMarkup`, `export.collectorAnswer`, `export.menuResponseOwner`, `export.userLinesFallback`, `export.attachmentPreviewOwner` | Source serialization, content preference, attachment provenance and fallback grammar. Complete answer/user body repair enters through content.answer/content.userLines; no independent proof can select another preferred subset or classify arbitrary file/image markup. Source/role and exclusion protocols remain packaged (§6). |

## conversation.json

| Exact retained keys  | Reason                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation.roots` | Ordered original conversation landmarks. Current independent ownership evidence finds these same roots; no independent proof establishes another root as the active conversation rather than a preview. |

## deep-research-packaged.json

| Exact retained keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reason                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepResearch.items`, `deepResearch.reportCandidates`, `deepResearch.panel`, `deepResearch.thinkingPanels`, `deepResearch.thought`, `deepResearch.thoughtHeader`, `deepResearch.thoughtContent`, `deepResearch.browseList`, `deepResearch.browseLinks`, `deepResearch.browseDomain`, `deepResearch.browseTitle`, `deepResearch.documentTitle`, `deepResearch.reportHeadings`, `deepResearch.menuPanel`, `deepResearch.menuContent`, `deepResearch.menuShare`, `deepResearch.menuExport` | No independent proof for renamed report/item boundaries on actual markup; longest text or headings alone cannot distinguish a report from an ordinary answer. Thought-before-browse ordering, source URLs, title parsing and share/export actions are fixed source/interaction protocols (§6). |

## export-entry-packaged.json

| Exact retained keys                                                                                                                                                                                                  | Reason                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportEntry.logo`, `exportToolbar.broadControls`, `exportToolbar.canvasOwner`, `exportToolbar.canvasContent`, `exportToolbar.inactiveCanvas`, `canvasEntry.downloadItem`, `canvasEntry.owner`, `canvasEntry.editor` | Logo identity and Canvas download/owner/editor action protocol (§6); other probes preserve toolbar collision and inactive/occluded Canvas placement. None can independently identify a new export action. |

## export-layout-packaged.json

| Exact retained keys                                                                                                                                                                                             | Reason                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controls`, `broadControls`, `canvasOwner`, `canvasContent`, `fullscreenCanvas`, `inactiveCanvas`, `turns`, `interactive`, `avoidRow`, `overlaySidebar`, `fallbackRoot`, `alignmentCanvas`, `alignmentComposer` | No independent proof of renamed toolbar collision/alignment targets. See the shared-site ledger; the effective conversation/header mounts are separate. |

## export-toolbar.json

| Exact retained keys      | Reason                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportToolbar.controls` | Upgrade/Pro avoidance and existing top-bar control placement policy. No independent proof identifies a new header control cluster while retaining upgrade avoidance; remote data cannot simply declare that role. |

## fork-packaged.json

| Exact retained keys                                                                     | Reason                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fork.userHost`, `fork.copyButton`, `fork.copyIcon`, `fork.sentTextLines`, `fork.input` | Native user owner, copy-button/icon action association and source-text interpretation (§6 identity/copy protocol). Content repairs use the shared guarded body. fork.input preserves the narrower bundled prefill read; remote repairs use the guarded composer.candidates. |

## formula-packaged.json

| Exact retained keys                                                                               | Reason                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formula.container`, `formula.display`, `formula.inline`, `formula.presentation`, `formula.quote` | Formula source/display/quote serialization. Native data-math/MathML/KaTeX already supplies the content proof; an alias without a source has no independently verifiable formula (§6). |

## gems-packaged.json

| Exact retained keys                                                                                                                                                   | Reason                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `link`, `nativeLink`, `nativeRow`, `titleEvidence`, `descriptionEvidence`, `iconEvidence`, `currentName`, `currentIcon`, `moreEntry`, `topNav`, `navHost`, `excluded` | Independent Gem href/ID, native row/title/description/icon evidence and editor/dialog exclusions. Remote Gems lists cannot certify their own identity or delete saved pins; no independent proof admits a different current-name/icon source (§6). |

Remaining image, input, sidebar and protocol data is listed in the [second half of this ledger](PACKAGED_SURFACES.md).
