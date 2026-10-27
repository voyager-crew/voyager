import type { LocatorLiteralException } from './types';

export const EXPORT_FORMATS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/export/services/exportDomPolicy.ts',
    kind: 'protocol',
    values: {
      'generated-image': 1,
    },
    reason:
      'Immutable native clone/export sanitizer: source-bearing native image frames survive hide-from-message-actions while control/thought/action/script nodes are excluded. Design §6 explicitly cites exportDomPolicy.ts serialization; this does not choose the remote image winner.',
  },
  {
    file: 'src/features/export/services/katexExportStyles.ts',
    kind: 'protocol',
    values: {
      'button[data-test-id="new-chat-button"]': 1,
      'button[aria-label="Open sidebar"]': 1,
      'button[aria-label="Close sidebar"]': 1,
      'button[data-test-id="side-nav-menu-button"]': 1,
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
    file: 'src/features/export/services/pdfPrintTitles.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 3,
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
    },
    reason:
      'Two escaped current-conversation-ID jslog/href lookups select only the already known route identity, and the third original closest binds a found descendant to that native row before reading title text. This design §6 dynamic identity association stays packaged, while title.export/sidebar descendant reads retain their separate guarded contracts.',
  },
];
