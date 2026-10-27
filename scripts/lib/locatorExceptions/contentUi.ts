import type { LocatorLiteralException } from './types';

export const CONTENT_UI_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/batchDelete/geminiSelection.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 2,
      '[data-test-id="overflow-container"]': 1,
      '.cdk-overlay-container': 1,
      '.mat-mdc-dialog-container': 1,
    },
    reason:
      'Native batch-delete row selection binds original conversation identity; outside-press exclusions keep native conversation rows, confirmation menus/dialogs and Voyager overlays inside the destructive-selection flow. Both are fixed deletion/identity protocols.',
  },
  {
    file: 'src/pages/content/codeBlockCollapse/geminiSite.ts',
    kind: 'protocol',
    values: {
      '.buttons': 2,
      'code-block': 1,
    },
    reason:
      'code.buttons occurrences are profile keys indexed/passed to resolvePlacementOperation. The code-block equality is bundled-renderer dialect dispatch deciding whether to call the guarded host resolver; it does not query an unguarded host.',
  },
  {
    file: 'src/pages/content/draftSave/geminiDraftSendDetection.ts',
    kind: 'protocol',
    values: {
      '.query-text-line': 1,
    },
    reason:
      'query-text-line remains independent packaged evidence before deleting a saved draft; clicked anchor URL ownership clears a pending send on native navigation. Remote content cannot certify draft deletion.',
  },
  {
    file: 'src/pages/content/folderProject/index.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 1,
      'a[href*="/app/"]': 1,
    },
    reason:
      'Conversation-ID-specific native title association for folder-project/fork data; dynamic escaped ID lookup remains packaged under design §6 identity-specific queries.',
  },
  {
    file: 'src/pages/content/markdownPatcher/index.ts',
    kind: 'protocol',
    values: {
      'code-block': 1,
      'rich-textarea': 1,
    },
    reason:
      'code-block and rich-textarea are permanent mutation exclusions protecting native code and user-editable content from Markdown rewriting; remote locator data cannot weaken those safety boundaries.',
  },
  {
    file: 'src/pages/content/quoteReply/quoteInsertion.ts',
    kind: 'protocol',
    values: {
      'rich-textarea': 1,
    },
    reason:
      'rich-textarea ancestry reads native Quill placeholder attributes on the already accepted editable to preserve emptiness and quote insertion behavior. The editor-write/placeholder protocol stays packaged.',
  },
  {
    file: 'src/pages/content/shared/nativeMenuItemTemplate.ts',
    kind: 'protocol',
    values: {
      'gem-menu-item': 2,
      '.label-container': 1,
      '.label': 1,
      '.gds-body-m': 1,
      '.gds-label-m': 1,
      '.subtitle': 1,
    },
    reason:
      'Only invoked after template.cloneNode(true) + clearTemplateSpecificAttributes; these label paths rewrite Voyager’s sanitized native clone. This is the explicit design §6 clone-sanitizer boundary, not a native page data read.',
  },
  {
    file: 'src/pages/content/timeline/TimelineTurns.ts',
    kind: 'protocol',
    values: {
      'deep-research-immersive-panel': 2,
    },
    reason:
      'After accepted turn/content selection, assistant preview serialization strips thoughts/research and native button controls alongside Voyager UI. These packaged source/control exclusions cannot supply a replacement exported turn.',
  },
  {
    file: 'src/pages/content/timeline/timelineTurnIds.ts',
    kind: 'protocol',
    values: {
      'user-query': 1,
      'user-query-content': 1,
    },
    reason:
      'user-${index} supplies a legacy persisted turn identity/hash fallback, not a CSS template. Existing ID formats remain packaged.',
  },
  {
    file: 'src/pages/content/timestamp/messageTimestampLookup.ts',
    kind: 'protocol',
    values: {
      'user-query': 1,
      'user-query-content': 1,
    },
    reason:
      'user-${fullIndex} occurs inside the legacy user-turn timestamp hash. It is an identity serialization protocol, never a selector or page query.',
  },
];
