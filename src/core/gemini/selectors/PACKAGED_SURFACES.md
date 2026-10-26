# Gemini packaged surface data

Continuation of the [complete packaged-data ledger](PACKAGED_DATA.md).

## generated-image-packaged.json

| Exact retained keys                                                                                                                                                                                                                                                                                         | Reason                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generatedImage.container`, `generatedImage.previewSource`, `generatedImage.downloadOwner`, `generatedImage.downloadHost`, `generatedImage.downloadDataButton`, `generatedImage.downloadHostButton`, `generatedImage.button`, `generatedImage.image`, `generatedImage.dialog`, `generatedImage.dialogImage` | Container repair lacks an independent reachable proof: actual generated images are in button.image-button, which the independent probe excludes. Preview selection, original URL/source, button ownership and dialog/download protocol stay packaged (§6). Only the original download icon is remotely repairable. |

## generated-ui-packaged.json

| Exact retained keys                                                                                                                            | Reason                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generatedUi.frames`, `generatedUi.attachment`, `generatedUi.response`, `generatedUi.message`, `generatedUi.markdown`, `generatedUi.container` | No independent origin proof for a renamed generated frame. The legacy substring URL check also matches foreign origins; accepting a remote wrapper could capture another site. A packaged URL-parsed origin policy is required first. Response/attachment/source framing remains packaged (§6). |

## image-export-packaged.json

| Exact retained keys                                                                                                                                                                                                               | Reason                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imageExport.generatedHosts`, `imageExport.preferredImages`, `imageExport.sourceAnchor`, `imageExport.caption`, `imageExport.sourceLabel`, `imageExport.youtubeThumbnails`, `imageExport.youtubeCard`, `imageExport.youtubeTitle` | Generated-image/source URL/srcset, caption, attribution and YouTube card serialization/provenance (§6). No independent evidence admits another source/caption association. Only independently proved searchHosts are published. |

## input-collapse-packaged.json

| Exact retained keys                                                         | Reason                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `inputCollapse.emptyInputs`, `inputCollapse.focus`, `inputCollapse.related` | Empty/edit/focus and related-UI safety rules (§6 write/focus protocol); the wrapper has its own remote ownership proof. |

## input-packaged.json

| Exact retained keys                                                                                                                                  | Reason                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input.clearance`, `input.fab`, `vim.mountInput`, `vim.mountRoot`, `vim.crossSiteEdit`, `vim.editActions`, `vim.mountChatInput`, `vim.mountChatRoot` | No independent proof of renamed prompt/FAB clearance or Vim mount targets. Clearance and mount candidates retain their baseline values and order; editing controls retain their native interaction protocol. Composer repair uses its guarded input profile. |

## menu-packaged.json

| Exact retained keys                                                                                                                             | Reason                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu.nativePanels`, `menu.items`, `menu.sidebar`, `menu.expandedTrigger`, `menu.backdrop`, `menu.conversationTriggers`, `menu.responseTrigger` | Independent menu panels, ARIA expansion/trigger association, sidebar/backdrop and original response ownership (§6). These cannot be supplied by the same remote data being proved. |

## project-packaged.json

| Exact retained keys                                                                | Reason                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.send`, `project.modelAnchor`, `project.inputAnchor`, `project.fontSource` | No independent proof of renamed instruction placement or font-source anchors within the composer. Send action and instruction writes remain packaged protocols; project.inputs repairs the candidate input. |

## research-pack-packaged.json

| Exact retained keys                                                                                                                                         | Reason                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `researchPack.host`, `researchPack.thoughts`, `researchPack.actionLinkScope`, `researchPack.conversation`, `researchPack.user`, `researchPack.deepResearch` | Original response/thought/user/conversation and source-link scoping (§6 content/identity). Only actionBars may move under the independent original response owner. |

## sent-chips-packaged.json

| Exact retained keys                                       | Reason                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sentChips.lines`, `sentChips.anchor`, `sentChips.toggle` | No independent proof of a renamed preferred text subset or chip insertion/toggle anchor. The complete original user bubble is independently repaired through sentChips.bubbles. |

## sidebar-interaction-packaged.json

| Exact retained keys                                      | Reason                                                                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `widthButtons`, `widthIcon`, `menuItem`, `optionsButton` | No independent proof that renamed widthButtons are the intended controls. Width CSS and icon/menu action semantics remain packaged protocols; remote data repairs only independently validated hit targets. |

## sidebar-packaged.json

| Exact retained keys                                                                                                                              | Reason                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageTitle`, `sidenav`, `content`, `contentInner`, `newChat`, `actionsContainer`, `toggleButton`, `toggleHost`, `toggleLegacyHost`, `toggleIcon` | Native page title, sidebar/root/toggle/new-chat action evidence. No independent proof admits a new action or title source; sidebar discovery repairs use the separately published profiles. |

## sidebar-titles.json

| Exact retained keys                                                          | Reason                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title.export`, `title.active`, `title.activeExport`, `title.activeResearch` | Ordered saved/exported/printed title preference and active-state source. No independent proof distinguishes a different preferred string from another chat title; remote membership alone cannot authorize a changed persisted title. |

## timeline-packaged.json

| Exact retained keys                   | Reason                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeline.userText`, `guide.overlays` | Ordered user text preference lacks independent proof of another preferred subset; overlay semantics are native ARIA association. See shared-site ledger. |

## usage-packaged.json

| Exact retained keys                  | Reason                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily`, `weekly`, `reset`, `header` | Native daily/weekly/reset/header values and labels are independent usage interpretation evidence. Remote usage.root cannot certify its own numbers (§6 source/state). |

## vim-packaged.json

| Exact retained keys                                                                                            | Reason                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vim.editable`, `vim.editInputs`, `vim.sendTarget`, `vim.editForm`, `vim.host`, `vim.inputFallback`, `vim.hud` | Editable/edit/send/focus protocol and baseline HUD/input fallback. Remote candidates repair the original editor; remote data cannot redefine key handling or another HUD owner (§6). |

## Protocols outside JSON

| Retained source                                                                                                                          | Reason                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAIN-world chat/sidebar scroll literals                                                                                                  | Packaged scroll and sidebar exclusion policy already covers independently proven targets. A page-writable projection supplies no additional proof or useful repair. |
| Model selectedModel / selectedThinking / selectedNestedThinking                                                                          | Native state metadata and click ordering; aliases cannot define a new selected state.                                                                               |
| Host/matches/capabilities, account controls, IDs, destructive actions, source URLs/origins, HTML/MathML, CSS, native health, Voyager DOM | Fixed admission, identity, serialization, action and safety protocols (§6). No remote value may self-certify these boundaries.                                      |
