# Folder Manager

This folder contains the implementation of the conversation folder management feature for Voyager.

## Overview

The folder manager allows users to:

- Create and manage folders and subfolders (up to 3 levels)
- Drag and drop conversations from the sidebar into folders
- Move conversations between folders
- Display Gem-specific icons for different conversation types
- Navigate to conversations without page reload (SPA-style)
- Import/export folder JSON and sync folders across devices

## Change the owner of the behavior

Gemini's folder data is a session the page holds for its lifetime
([`session/geminiFolderSession.ts`](session/geminiFolderSession.ts), opened by
[`geminiFolderStartup.ts`](../geminiFolderStartup.ts), which also admits the folders plugin): the
store, its commands and account gate, the popup's cloud-sync and AI-structure answers and the
legacy sync-mode migration, which run with folders off. It binds an account only once Gemini's
account control names it, and follows the `/u/<n>/` route only while the plugin's view is attached.
Folder-as-Project files chats through it (`ensureDataLoaded`, `getFolders`,
`addConversationToFolderFromNative`). The packaged `voyager.gemini-folders` plugin shows it: its
view ([`verbs/folders/gemini/view.ts`](../../../features/plugins/verbs/folders/gemini/view.ts))
attaches to the session and composes the Gemini owners below with native menus and the floating
panel. The Folders card switch (`geminiFolderEnabled`) turns the plugin on and off. Start changes
at the owner below.

| Responsibility                   | Entry point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persisted schema                 | [`core/types/folder.ts`](../../../core/types/folder.ts); local [`types.ts`](types.ts) re-exports it and defines drag data.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pure tree operations             | [`features/folder/model/folderData.ts`](../../../features/folder/model/folderData.ts): moves, removal, ordering, integrity repair, `validateFolderData` and `cloneFolderData`. Adding or moving a conversation goes through [`placeConversations.ts`](../../../features/folder/model/placeConversations.ts) on both hosts, where callers build records and own side effects. Dropping at a position (reorder, including across folders) goes through `reorderConversations`. Shared constants live in [`features/folder/constants.ts`](../../../features/folder/constants.ts). |
| Data and commands                | [`FolderStore.ts`](FolderStore.ts): folder mutations over `FolderStoreState`; Gemini's activity, Gem tags, titles and record edits in `gemini/`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Persistence                      | [`FolderRepository.ts`](FolderRepository.ts): load, serialized saves, draft replacement, recovery, storage echoes, account switching and scope retry, configured per platform by [`platformFolderConfig.ts`](platformFolderConfig.ts) (keys, backup namespace, root bucket, legacy migration hook, normalize/prune/recovery/retry policy). Gemini (`FolderStore`) and AI Studio (`storage/AIStudioFolderStorageAdapter.ts`, chrome.storage-only adapter) both use it.                                                                                                          |
| Account write lifetime           | [`FolderDataSession.ts`](FolderDataSession.ts): captured snapshots, queued saves, recovery namespaces and unload cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Sidebar rendering                | [`FolderSidebarView.ts`](FolderSidebarView.ts): header, search, Activity and preferences; the tree is the shared `floatingTree` mounted by [`sidebarTree.ts`](sidebarTree.ts), with drops in [`sidebarDrops.ts`](sidebarDrops.ts) and search/account filters over the cycle-cut layout in [`sidebarFilter.ts`](sidebarFilter.ts).                                                                                                                                                                                                                                              |
| Selection and drag/drop          | [`FolderSelection.ts`](FolderSelection.ts): shared native/folder selection, drag state and batch actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Drag payloads                    | [`dragPayload.ts`](dragPayload.ts): the one validated parser for Voyager drag data; AI Studio opts into its URL fallback, Gemini stays JSON-only.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Sidebar mount and recovery       | [`FolderSidebarRuntime.ts`](FolderSidebarRuntime.ts): remounts, positioning, anchor preference and floating fallback; sidebar/anchor queries in [`sidebarMountDom.ts`](sidebarMountDom.ts), the Notebooks toggle in [`notebooksAnchorToggle.ts`](notebooksAnchorToggle.ts), recovery listeners and poll in [`sidebarRecoveryWatchers.ts`](sidebarRecoveryWatchers.ts).                                                                                                                                                                                                         |
| Conversation navigation          | [`FolderNavigation.ts`](FolderNavigation.ts): native links, SPA fallback, route highlighting and new-chat handoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Import/export and cloud commands | [`FolderTransferController.ts`](FolderTransferController.ts): the public entry, concurrent-operation guards and account-bound completion; the import dialog in [`folderImportDialog.ts`](folderImportDialog.ts), Drive upload/merge and tooltips in [`folderCloudSync.ts`](folderCloudSync.ts), the shared host contract in [`folderTransferHost.ts`](folderTransferHost.ts). JSON parsing/validation remains in [`FolderImportExportService.ts`](../../../features/folder/services/FolderImportExportService.ts).                                                             |
| Temporary editors and dialogs    | [`folderDialogs.ts`](folderDialogs.ts): the view registry, active create/color/menu state and close-on-remount rules; inline name editors in [`folderInlineEditors.ts`](folderInlineEditors.ts), color/move/instructions/confirmation views in [`folderDialogViews.ts`](folderDialogViews.ts).                                                                                                                                                                                                                                                                                 |
| Notifications and tooltips       | [`FolderFeedback.ts`](FolderFeedback.ts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Header popovers                  | [`headerMenus.ts`](headerMenus.ts): action/settings controls, delayed listeners and cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Native DOM reads                 | [`nativeSidebarDom.ts`](nativeSidebarDom.ts): row lookup, presence checks and populated rows from explicit sidebar/account context; ids and URLs in [`nativeConversationIds.ts`](nativeConversationIds.ts), titles in [`nativeConversationTitles.ts`](nativeConversationTitles.ts). Which ids a stored reference answers to lives in [`features/folder/model/folderConversationIdentity.ts`](../../../features/folder/model/folderConversationIdentity.ts).                                                                                                                    |
| Native mutation scheduling       | [`NativeSidebarObserver.ts`](NativeSidebarObserver.ts): observer, frame batch, idle queue and title debounce.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Native menus and deletion        | [`NativeConversationMenus.ts`](NativeConversationMenus.ts): menu injection, confirmation identity and settlement checks; callbacks change data through the store.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Browser storage                  | [`storage/FolderStorageAdapter.ts`](storage/FolderStorageAdapter.ts): Safari durable storage and Chromium mirror behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Other hosts and views            | [`storage/AIStudioFolderStorageAdapter.ts`](storage/AIStudioFolderStorageAdapter.ts) (see [AI Studio](#ai-studio)), [`floatingPanel.ts`](floatingPanel.ts); shared schema/session, separate host integration.                                                                                                                                                                                                                                                                                                                                                                  |
| Gem metadata and startup         | [`gemConfig.ts`](gemConfig.ts), [`geminiFolderStartup.ts`](../geminiFolderStartup.ts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Test data invariants and scheduling at their owner. Keep account transitions and view wiring in
integration tests ([`geminiFolderManager.ts`](__tests__/geminiFolderManager.ts) composes the session
and the view as the page does). UI tests can compose real owners with memory storage using
[`folderViewHarness.ts`](__tests__/folderViewHarness.ts). Do not pass the entire view into a
module or add production wrappers solely to preserve a private test interface.

Account changes, sidebar remounts and destruction have different lifetimes:

- Async writes retain their original session and snapshot. Import/sync work also captures an
  activation so leaving and returning to the same account still rejects stale completion. Account
  changes clear transient editors, selection, navigation and title work before displaying new data.
- Sidebar remounts disconnect the native observer and menu panels while retaining document-level
  deletion tracking. Start that tracking before waiting for the sidebar, including floating mode.
  Pending deletion checks validate their captured storage key and route against live context.
- Disabling or destroying stops native owners and recovery work. Permanent message/settings
  listeners survive remounts and are removed only on destruction.
- Native and folder drag gestures share one selection owner. Reset clears selection; unmount also
  removes mounted toolbar listeners. Floating recovery remains distinct from explicit floating mode.

Extract only a complete responsibility with its state, setup, cleanup and behavior tests;
file length alone is not a reason to add another layer.

### AI Studio

AI Studio's folders (the session the page holds, the plugin's view, and where each responsibility
lives) are described in [`verbs/folders/aistudio/README.md`](../../../features/plugins/verbs/folders/aistudio/README.md).

To add support for a new Gem, see [Adding Gem Support](../../../../.github/contributing/en/adding-gem-support.md).

## Contributing

If you're adding support for a new official Google Gem, please submit a pull request with:

1. The new entry in `gemConfig.ts`
2. A brief description of the Gem in your PR

## Technical Details

### Gem Detection

Saved conversations are stored by their `/app/{hex-id}` route: the sidebar's
`jslog` only supplies the `c_<hex>` id and no longer says whether a chat
belongs to a Gem. A conversation is marked as a Gem one after it is opened
from a folder: if Gemini lands on `/gem/{gem-id}/...`,
`FolderNavigation.checkGem` records that `gemId`, and the folder shows the
Gem's icon from then on.

### URL Generation

- Saved conversations: `/app/{hex-id}`, with the current `/u/{account-number}/`
  prefix kept unless hard account isolation is on
- With hard isolation, the `/u/{account-number}/` prefix is rebuilt from the
  current account at navigation time

### AI Studio History Drag Sources

AI Studio exposes saved prompts in two shapes:

- `/library` table rows
- V2 left-nav History hover popovers rendered as body-level overlays

Both paths must populate Voyager's JSON drag payload before a prompt is dropped into a folder.
The payload includes the prompt id, title, and URL; if a browser native URL drag reaches the
folder without that JSON payload, the folder can only recover the id and must fall back to the
localized untitled label.

### Icon Mapping

`getGemIcon` maps a recorded `gemId` to its icon when a conversation renders
in a folder; unknown Gems use `DEFAULT_GEM_ICON`.
