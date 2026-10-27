import type { LocatorLiteralException } from './types';

export const EXPORT_FORMATS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/export/services/DOMContentExtractor.ts',
    kind: 'protocol',
    values: {
      h3: 2,
    },
    reason:
      'Standard HTML serialization detects prose blocks beside tables to preserve structure in exported output; it does not locate a site answer. Additional h3 query is only under gv-canvas-export-section, a Voyager-created export fragment heading.',
  },
  {
    file: 'src/features/export/services/exportDomPolicy.ts',
    kind: 'protocol',
    values: {
      'generated-image': 1,
      button: 1,
    },
    reason:
      'Immutable native clone/export sanitizer: source-bearing native image frames survive hide-from-message-actions while control/thought/action/script nodes are excluded. Design §6 explicitly cites exportDomPolicy.ts serialization; this does not choose the remote image winner.',
  },
  {
    file: 'src/features/export/services/exportRichText.ts',
    kind: 'protocol',
    values: {
      li: 1,
    },
    reason: 'Direct LI children are HTML list-serialization grammar on an already selected list.',
  },
  {
    file: 'src/features/export/services/katexExportStyles.ts',
    kind: 'protocol',
    values: {
      'button[data-test-id="new-chat-button"]': 1,
      'button[aria-label="Open sidebar"]': 1,
      'button[aria-label="Close sidebar"]': 1,
      'button[data-test-id="side-nav-menu-button"]': 1,
      button: 1,
      'button.input-area-switch': 1,
      'button[aria-haspopup="menu"].mat-mdc-menu-trigger': 1,
      'button[aria-label*="temporary chat" i]': 1,
      'button[aria-label*="临时聊天"]': 1,
      'button[aria-label*="暫時聊天"]': 1,
      'button[aria-haspopup="menu"][data-composer-navigation-target="reasoning"]': 1,
    },
    reason:
      'Export CSS sinks for KaTeX and lists stay packaged under design §6; these are complete styles, not remote DOM reads.',
  },
  {
    file: 'src/features/export/services/listExportStyles.ts',
    kind: 'protocol',
    values: {
      li: 1,
    },
    reason:
      'Export CSS sinks for KaTeX and lists stay packaged under design §6; these are complete styles, not remote DOM reads.',
  },
  {
    file: 'src/features/export/services/pdfPrintTitles.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 3,
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
    },
    reason:
      'Dynamic conversation-ID-specific lookup retains native identity association and escaping. These are packaged identity/navigation paths, not general-purpose remote sidebar discovery. Original [data-test-id=conversation] closest establishes conversation identity before separately guarded title.export text reads.',
  },
  {
    file: 'src/features/export/ui/ExportDialog.ts',
    kind: 'protocol',
    values: {
      button: 4,
    },
    reason:
      'All button hits are createElement/type attributes constructing Voyager export dialog controls.',
  },
];
