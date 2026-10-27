import type { LocatorLiteralException } from './types';

export const FOLDER_PROTOCOLS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/folder/FolderRepositorySaves.ts',
    kind: 'protocol',
    values: {
      progress: 1,
    },
    reason:
      'The word progress appears only in a save-queue debug message. No page lookup or selector is represented.',
  },
  {
    file: 'src/pages/content/folder/FolderSidebarView.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'The button query is scoped to gv-folder-header-actions and controls readiness of Voyager’s own folder UI; it cannot discover host elements.',
  },
  {
    file: 'src/pages/content/folder/NativeConversationMenus.ts',
    kind: 'protocol',
    values: {
      '.cdk-overlay-container': 1,
      '.mat-mdc-dialog-container': 1,
      button: 1,
      '.conversation-actions-container': 1,
    },
    reason:
      'Native overlay/dialog checks and conversation-action ancestry belong to menu focus, trigger reset and delete/confirmation safety. The batch-delete message is diagnostic prose. No published discovery target is bypassed.',
  },
  {
    file: 'src/pages/content/folder/aistudioLibraryBatchDelete.ts',
    kind: 'protocol',
    values: {
      button: 5,
      '.cdk-overlay-container': 3,
      '[role="menuitem"]': 2,
      '.mat-mdc-menu-content': 1,
      '.mat-mdc-dialog-container': 1,
    },
    reason:
      'Native destructive delete/confirm/selection flow. These controls and dialog association must remain package-only and cannot be remapped by ordinary page-location updates.',
  },
  {
    file: 'src/pages/content/folder/aistudioLibrarySelection.ts',
    kind: 'protocol',
    values: {
      button: 1,
      '[role="button"]': 1,
      '.cdk-overlay-container': 1,
      '.mat-mdc-dialog-container': 1,
    },
    reason:
      'Native button/role and overlay/dialog exclusions preserve the destructive library selection/confirmation flow and outside-press rules. Button tag/type uses construct Voyager’s own selection toolbar controls.',
  },
  {
    file: 'src/pages/content/folder/aistudioLocatorReads.ts',
    kind: 'proof',
    values: {
      'a[href]': 4,
      'mat-table': 2,
      nav: 2,
    },
    reason:
      'AI Studio library/navigation repairs are corroborated against native table/row and nav landmarks plus independently parsed same-origin/account prompt anchors. Standard a[href] traversal supplies only these fixed URL/ID witnesses; repaired data cannot supply its own proof.',
  },
  {
    file: 'src/pages/content/folder/aistudioNativeProof.ts',
    kind: 'proof',
    values: {
      main: 1,
      '[role="dialog"]': 2,
    },
    reason:
      'AI Studio navigation/library candidates are corroborated against independently original nav links, fixed same-origin/account prompt URLs, and exclusion of chat/dialog/editable/Voyager owners.',
  },
  {
    file: 'src/pages/content/folder/aistudioNavigationReads.ts',
    kind: 'proof',
    values: {
      'a[href]': 1,
    },
    reason:
      'Native a[href] links are filtered by packaged AI Studio prompt URL/account/ID rules to prove navigation row ownership. Remote navigation locators supply candidates, while the fixed link/identity protocol supplies the witness.',
  },
  {
    file: 'src/pages/content/folder/conversationSortCoachmark.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'button appears solely in an error message about unavailable folder settings; it encodes no CSS or lookup.',
  },
  {
    file: 'src/pages/content/folder/floatingModeFab.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own floatingModeFab controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/floatingPanel.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own floatingPanel controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/floatingTree/ContextMenu.tsx',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own ContextMenu controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/floatingTree/controls.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own controls controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/floatingTree/conversationRow.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own conversationRow controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/floatingTree/rows.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own rows controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/folderDialogViews.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own folderDialogViews controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/folderHeader/folderHeader.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Button tag/type construction creates Voyager’s own header controls. The dynamic ACTIONS_CLASS child-button query is scoped to the gv-owned header action row and updates only that UI.',
  },
  {
    file: 'src/pages/content/folder/folderHeader/folderHeaderMenu.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own folderHeaderMenu controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/folderSettings/folderSettings.ts',
    kind: 'protocol',
    values: {
      button: 4,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own folderSettings controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/gemini/nativeRename.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Both button occurrences are warning messages from native rename failure paths, not executable locators.',
  },
  {
    file: 'src/pages/content/folder/hideArchivedNudge.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own hideArchivedNudge controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/nativeConversationIds.ts',
    kind: 'protocol',
    values: {
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
      '[data-test-id="conversation"]': 2,
    },
    reason:
      'Fixed /app and /gem anchor routes plus original conversation row ownership extract/normalize stored IDs and maintain native menu association. Identity extraction is explicitly design §6 and cannot be supplied by remote locator data.',
  },
  {
    file: 'src/pages/content/folder/nativeDeleteTracker.ts',
    kind: 'protocol',
    values: {
      button: 2,
      '[role="menuitem"]': 1,
      'gem-menu-item': 1,
      '[role="button"]': 1,
      '[role="dialog"]': 1,
      '.mat-mdc-dialog-container': 1,
    },
    reason:
      'Native destructive delete/confirm/selection flow. These controls and dialog association must remain package-only and cannot be remapped by ordinary page-location updates.',
  },
  {
    file: 'src/pages/content/folder/nativeMenuActions.ts',
    kind: 'protocol',
    values: {
      '.conversation-actions-container': 1,
      li: 1,
      button: 15,
      '.cdk-overlay-container': 5,
      '[role="menuitem"]': 2,
      '.mat-mdc-menu-panel': 2,
      '.cdk-overlay-pane': 2,
      '.mat-mdc-menu-content': 1,
      '.mat-mdc-dialog-container': 2,
    },
    reason:
      'All native menu/action/overlay/dialog/button reads implement destructive rename/delete/confirm and original trigger association. The additional button words are diagnostics, not selectors. These action and deletion protocols are package-only.',
  },
  {
    file: 'src/pages/content/folder/nativeSidebarDom.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 5,
      '.conversation-actions-container': 1,
      '[data-test-id^="history-item"]': 1,
      'a[href]': 1,
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
    },
    reason:
      'Native menu-trigger-to-row association and parsed conversation-ID-specific navigation are fixed action/identity protocols. findNativeConversationLinkById rechecks parsed ID equality. isConversationInDOM is native deletion evidence and deliberately falls back from online sidebar mounts to packaged ownership; locators cannot cause data deletion by hiding an existing row.',
  },
  {
    file: 'src/pages/content/folder/notebooksAnchorToggle.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'role=button is assigned to Voyager’s own gv-folders-anchor-toggle control; it defines its accessibility/event protocol, not host discovery.',
  },
  {
    file: 'src/pages/content/folder/selectionBoundaries.ts',
    kind: 'protocol',
    values: {
      '.cdk-overlay-container': 1,
      '.mat-mdc-dialog-container': 1,
    },
    reason:
      'Selection outside-press excludes native confirmation overlays and Voyager layers; original destructive-selection lifecycle protocol.',
  },
  {
    file: 'src/pages/content/folder/selectionToolbar.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'closest(button) excludes clicks on Voyager’s own selection toolbar controls from starting a drag; button type construction also affects only that owned UI.',
  },
  {
    file: 'src/pages/content/folder/sidebarActivityList.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own sidebarActivityList controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/folder/sidebarMountDom.ts',
    kind: 'proof',
    values: {
      '[role="dialog"]': 1,
    },
    reason:
      'Additional sidebar mount safety rejects own folder/shadow surfaces and dialogs after shared composed mount safety.',
  },
];
