import type { LocatorLiteralException } from './types';

export const FEATURE_UI_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/folder/services/FolderImportExportService.ts',
    kind: 'protocol',
    values: {
      progress: 1,
    },
    reason: 'progress occurs only in an import-lock error sentence, not CSS.',
  },
  {
    file: 'src/features/savedLibrary/SavedLibraryItemCard.tsx',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason: 'JSX type=button attributes construct extension-owned Library UI.',
  },
  {
    file: 'src/features/timeline/TimelineAnnotationLayer.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'createElement(button)/type=button create Voyager annotation ticks.',
  },
  {
    file: 'src/features/timeline/TimelineMarkerInteractions.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Button construction/closest(button) are confined to Voyager timeline context menu and its listener. Own-DOM event delegation.',
  },
  {
    file: 'src/features/timeline/TimelinePreviewPanel.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'button is an own preview anchor role or a created Voyager toggle, not native lookup.',
  },
  {
    file: 'src/features/timeline/adapters/catalog/sendTimestampsHarness.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason:
      'main is queried in a synthetic document created immediately by a Vitest-only harness. Fixture-owned HTML, never a production host locator. File remains scanned because it is outside __tests__.',
  },
  {
    file: 'src/features/timeline/userTextProof.ts',
    kind: 'proof',
    values: {
      form: 1,
      '[role="dialog"]': 1,
      textarea: 1,
    },
    reason:
      'Timeline remote text owner rejects editors/dialogs/controls before checking the independently accepted user-turn collection.',
  },
  {
    file: 'src/features/timeline/userTurnText.ts',
    kind: 'protocol',
    values: {
      button: 1,
      '[role="button"]': 1,
      'model-response': 1,
      '[data-message-author-role="assistant"]': 1,
    },
    reason:
      'Full prompt serialization strips action/script/template/assistant content; remote text still requires complete authored-text equality.',
  },
];
