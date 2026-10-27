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
    file: 'src/pages/content/changelog/index.ts',
    kind: 'protocol',
    values: {
      h3: 1,
      li: 1,
    },
    reason:
      'h3/li are native HTML tags in the changelog sanitizer allowlist, used only to render Voyager release notes. They are serialization grammar, not host-page title/turn locators.',
  },
  {
    file: 'src/pages/content/chartFullscreen.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own chartFullscreen controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/coachmark/index.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own controls in this module. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
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
      'a[href]': 1,
    },
    reason:
      'query-text-line remains independent packaged evidence before deleting a saved draft; clicked anchor URL ownership clears a pending send on native navigation. Remote content cannot certify draft deletion.',
  },
  {
    file: 'src/pages/content/edgeFinalVersionNotice/index.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own index controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
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
    file: 'src/pages/content/folderProject/picker.ts',
    kind: 'protocol',
    values: {
      button: 4,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own picker controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/gemsSidebar/pinToggle.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own pinToggle controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/gemsSidebar/section.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own section controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/gemsSidebar/sidebar.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own sidebar controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/highlight/HighlightEditor.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own HighlightEditor controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/highlight/HighlightMarks.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'role=button is assigned to Voyager-owned highlight marks alongside gv IDs and ARIA labels; it is own UI accessibility/event protocol.',
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
    file: 'src/pages/content/mermaid/codeBlock.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'The complete template is packaged CSS for Voyager-owned Mermaid diagram/toggle/modal UI; generic button tokens appear solely in that CSS sink, not host discovery.',
  },
  {
    file: 'src/pages/content/mermaid/renderer.ts',
    kind: 'protocol',
    values: {
      button: 1,
      form: 1,
    },
    reason:
      'button/form are prohibited HTML tags in the SVG sanitizer. They define fixed serialization/resource/interaction safety, not page-location instructions.',
  },
  {
    file: 'src/pages/content/quoteReply/highlightColorPicker.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own highlightColorPicker controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
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
    file: 'src/pages/content/quoteReply/renderedQuotes.ts',
    kind: 'proof',
    values: {
      textarea: 1,
    },
    reason:
      'QUOTE_WRAPPER_CLASS is Voyager-owned quote rendering and teardown markup under an already accepted container. Native editable witness marks mutations affecting the true input owner; remote quote lines cannot redefine editor identity.',
  },
  {
    file: 'src/pages/content/selectionToolbar/host.ts',
    kind: 'protocol',
    values: {
      button: 1,
      main: 1,
      nav: 1,
    },
    reason:
      'Main/nav landmarks bound native text-selection event ownership and exclude sidebar navigation. Button type constructs Voyager’s own selection toolbar actions; neither is a replacement turn/data read.',
  },
  {
    file: 'src/pages/content/sendBehavior/sendButton.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Native button ancestry/descendant conversion decides which actual send/update/Stop control owns a click before fixed label/icon/disabled/IME checks. The shared protocol data remains packaged; these generic tags do not discover a remote composer.',
  },
  {
    file: 'src/pages/content/shadowKeyGuard/index.ts',
    kind: 'protocol',
    values: {
      '[role="menuitem"]': 1,
      '[role="menuitemradio"]': 1,
    },
    reason:
      'Native tree/menu widget roles plus the gv-owned floating tree row define keyboard event isolation across shadow surfaces. This is focus/keyboard safety, not page content discovery.',
  },
  {
    file: 'src/pages/content/shared/nativeMenuItemTemplate.ts',
    kind: 'protocol',
    values: {
      button: 1,
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
    file: 'src/pages/content/sidebarCollapseNudge.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own sidebarCollapseNudge controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/timeline/GeminiTimelineTurnSource.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason:
      'The native main/body landmark scopes the timeline observer lifetime. Actual user/assistant discovery uses the accepted selector view, so this does not replace a published turn locator.',
  },
  {
    file: 'src/pages/content/timeline/TimelineTurns.ts',
    kind: 'protocol',
    values: {
      'deep-research-immersive-panel': 2,
      button: 1,
      '[role="button"]': 1,
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
  {
    file: 'src/pages/content/watermarkNativeNotice/index.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own index controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
];
