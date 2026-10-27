import type { LocatorLiteralException } from './types';

export const FOLDER_PROTOCOLS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/folder/NativeConversationMenus.ts',
    kind: 'protocol',
    values: {
      'gem-menu': 1,
      '.cdk-overlay-container': 1,
      '.mat-mdc-dialog-container': 1,
      '.conversation-actions-container': 1,
    },
    reason:
      'Native GEM-MENU tag, overlay/dialog checks and conversation-action ancestry belong to fixed menu-content, focus, trigger reset and delete/confirmation safety. Menu discovery still reads its published contract; the batch-delete message is diagnostic prose.',
  },
  {
    file: 'src/pages/content/folder/aistudioLibraryBatchDelete.ts',
    kind: 'protocol',
    values: {
      '.cdk-overlay-container': 3,
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
      'mat-table': 2,
    },
    reason:
      'AI Studio library/navigation repairs are corroborated against native table/row and nav landmarks plus independently parsed same-origin/account prompt anchors. Standard a[href] traversal supplies only these fixed URL/ID witnesses; repaired data cannot supply its own proof.',
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
      'gem-menu-item': 1,
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
      '.cdk-overlay-container': 5,
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
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
    },
    reason:
      'Native menu-trigger-to-row association and parsed conversation-ID-specific navigation are fixed action/identity protocols. findNativeConversationLinkById rechecks parsed ID equality. isConversationInDOM is native deletion evidence and deliberately falls back from online sidebar mounts to packaged ownership; locators cannot cause data deletion by hiding an existing row.',
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
];
