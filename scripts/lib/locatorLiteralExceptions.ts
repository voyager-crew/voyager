/** Exact reviewed exceptions: native proof or design §6 protocol only. No directory wildcards. */
export const LOCATOR_LITERAL_EXCEPTIONS: readonly {
  readonly file: string;
  readonly values: readonly string[];
  readonly reason: string;
}[] = [
  {
    file: 'src/core/gemini/code/hosts.ts',
    values: ['code-block'],
    reason: 'Independent native code host and complete source/header prove repaired hosts.',
  },
  {
    file: 'src/core/gemini/content/conversation.ts',
    values: ['deep-research-immersive-panel'],
    reason: '§6 transcript inclusion excludes immersive research sources.',
  },
  {
    file: 'src/core/gemini/math/userLatex.ts',
    values: ['user-query'],
    reason: 'Independent native user-host paragraphs prove complete remote LaTeX lines.',
  },
  {
    file: 'src/core/gemini/sidebar/actions.ts',
    values: ['[data-test-id="conversation"]'],
    reason: 'Independent native row identity proves a repaired sibling action owner.',
  },
  {
    file: 'src/core/gemini/sidebar/proof.ts',
    values: ['[data-test-id="conversation"]'],
    reason: 'Independent native row attribute proves a repaired conversation row.',
  },

  {
    file: 'src/core/selectors/composerSemantics.ts',
    values: [':not(*)'],
    reason: '§6 explicit no-match sentinel prevents unsupported composer operations.',
  },
  {
    file: 'src/core/selectors/semanticSnapshot.ts',
    values: [':not(*)'],
    reason: '§6 explicit no-match sentinel prevents unsupported semantic operations.',
  },
  {
    file: 'src/core/selectors/siteSemantics.ts',
    values: [':not(*)'],
    reason: '§6 explicit no-match sentinel prevents unsupported semantic operations.',
  },
  {
    file: 'src/core/services/AccountIsolationService.ts',
    values: [
      '#chat-history',
      'infinite-scroller.chat-history',
      'chat-window-content',
      'user-query',
      'model-response',
      'message-content',
      'deep-research-immersive-panel',
    ],
    reason:
      '§6 account-content exclusions prevent conversation text from becoming an account identity.',
  },
  {
    file: 'src/core/services/KeyboardShortcutService.ts',
    values: ['textarea'],
    reason: '§6 native editable tag protocol decides keyboard-event ownership.',
  },
  {
    file: 'src/core/services/composer/chatgptRootProof.ts',
    values: ['form'],
    reason: 'Independent native form association proves repaired composerRoot.',
  },
  {
    file: 'src/core/services/composer/index.ts',
    values: ['rich-textarea'],
    reason: '§6 Quill writing and native input-event protocol retain rich-textarea ownership.',
  },
  {
    file: 'src/core/services/composer/sendKeys/sendKeyDom.ts',
    values: ['textarea'],
    reason: '§6 editable-kind discriminant governs keyboard events, not page discovery.',
  },
  {
    file: 'src/core/services/composer/siteComposerOperation.ts',
    values: ['form'],
    reason: 'Independent native form association proves composer operations.',
  },
  {
    file: 'src/core/services/composer/siteInputData.ts',
    values: [':not(*)'],
    reason: '§6 explicit no-match sentinel prevents unsupported input operations.',
  },
  {
    file: 'src/features/export/services/DOMContentExtractor.ts',
    values: ['h3'],
    reason:
      '§6 HTML heading serialization reads standard h3 structure, not a site-specific title locator.',
  },
  {
    file: 'src/features/export/services/pdfPrintTitles.ts',
    values: ['[data-test-id="conversation"]'],
    reason: '§6 parsed conversation identity scopes PDF title reads to their original row.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptComposerTargets.ts',
    values: ['form'],
    reason: 'Independent native form association proves ChatGPT composer ownership.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptModelSelect/pickerDom.ts',
    values: ['form', '[role="status"]'],
    reason: 'Independent native form/status witnesses reject non-picker and loading controls.',
  },
  {
    file: 'src/features/plugins/local/authoring/pluginExamples.ts',
    values: ['main'],
    reason: '§6 generated authoring example uses a generic HTML landmark, not a live page read.',
  },
  {
    file: 'src/features/plugins/runtime/semanticElements.ts',
    values: ['code-block'],
    reason: '§6 bundled Gemini code dialect dispatch selects its guarded resolver.',
  },
  {
    file: 'src/features/plugins/sends/trackUserSends.ts',
    values: ['form'],
    reason: 'Independent native form association proves send-event ownership.',
  },
  {
    file: 'src/features/plugins/verbs/codeBlockDiagramTargets.ts',
    values: ['code-block'],
    reason: '§6 bundled Gemini code dialect dispatch selects its guarded host resolver.',
  },
  {
    file: 'src/features/plugins/verbs/userLatex/index.ts',
    values: ['textarea', 'p.query-text-line', 'user-query'],
    reason:
      '§6 renderer dispatch, mutation exclusions and native user-message source ownership stay packaged.',
  },
  {
    file: 'src/features/timeline/adapters/catalog/sendTimestampsHarness.ts',
    values: ['main'],
    reason: '§6 send-observer lifetime retains its packaged main/body root.',
  },
  {
    file: 'src/pages/content/batchDelete/geminiSelection.ts',
    values: ['[data-test-id="conversation"]'],
    reason: '§6 destructive batch-delete selection uses original conversation identity.',
  },
  {
    file: 'src/pages/content/canvasExport/menuTargets.ts',
    values: ['deep-research-immersive-panel'],
    reason:
      '§6 Canvas export excludes the research operation source independently of menu repairs.',
  },
  {
    file: 'src/pages/content/changelog/index.ts',
    values: ['h3', 'li'],
    reason: '§6 HTML sanitizer tag allowlist does not locate host elements.',
  },
  {
    file: 'src/pages/content/chatWidth/pluginHandler.ts',
    values: ['main'],
    reason: '§6 CSS application keeps the packaged main landmark.',
  },
  {
    file: 'src/pages/content/codeBlockCollapse/geminiSite.ts',
    values: ['code-block'],
    reason:
      '§6 renderer dispatch recognizes the bundled Gemini code protocol before selecting its guarded host reader.',
  },
  {
    file: 'src/pages/content/deepResearch/dom.ts',
    values: ['user-query'],
    reason:
      'Independent native user-host exclusion prevents a preview from proving a research panel.',
  },
  {
    file: 'src/pages/content/defaultModel/modelPickerSafety.ts',
    values: ['[value="thinking_level"]'],
    reason:
      'Independent native thinking-control witness cannot be supplied by the repaired picker.',
  },
  {
    file: 'src/pages/content/draftSave/geminiDraftSendDetection.ts',
    values: ['.query-text-line'],
    reason: '§6 draft deletion needs packaged sent-text evidence independent of online content.',
  },
  {
    file: 'src/pages/content/echarts/view.ts',
    values: ['.buttons'],
    reason:
      '§6 native copy-control movement and restoration must retain the packaged control identity.',
  },
  {
    file: 'src/pages/content/editInputWidth/pluginHandler.ts',
    values: ['main'],
    reason: '§6 CSS application keeps the packaged main landmark.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/conversationTitle.ts',
    values: ['[data-test-id="conversation"]'],
    reason: '§6 parsed conversation identity scopes title reads to their original row.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/genericDom.ts',
    values: ['deep-research-immersive-panel'],
    reason: '§6 unknown-host compatibility keeps its own research-source exclusion.',
  },
  {
    file: 'src/pages/content/export/conversationDom.ts',
    values: ['deep-research-immersive-panel'],
    reason:
      '§6 transcript inclusion excludes immersive research sources independently of repaired turns.',
  },
  {
    file: 'src/pages/content/export/menuIdentity.ts',
    values: ['[data-test-id="conversation"]'],
    reason: '§6 menu action association retains the original conversation identity.',
  },
  {
    file: 'src/pages/content/export/responseActionTargets.ts',
    values: [
      'message-actions',
      '.message-actions',
      '.actions-container-v2',
      '.buttons-container-v2',
      '[data-message-author-role="assistant"]',
      '[data-message-author-role="model"]',
      'article[data-author="assistant"]',
      'article[data-turn="assistant"]',
      'article[data-turn="model"]',
      '.model-response',
      'model-response',
      '.response-container',
      '.presented-response-container',
    ],
    reason:
      'Independent native response/action ownership proves clone sources and complete repaired bars.',
  },
  {
    file: 'src/pages/content/export/sidebarConversationTarget.ts',
    values: ['[data-test-id="conversation"]'],
    reason: '§6 conversation href/jslog identity and menu-trigger association stay packaged.',
  },
  {
    file: 'src/pages/content/folder/NativeConversationMenus.ts',
    values: ['.conversation-actions-container'],
    reason: '§6 native conversation menu association retains its action owner.',
  },
  {
    file: 'src/pages/content/folder/aistudioLocatorReads.ts',
    values: ['nav'],
    reason: 'Independent native navigation landmark proves prompt ownership.',
  },
  {
    file: 'src/pages/content/folder/nativeConversationIds.ts',
    values: ['[data-test-id="conversation"]'],
    reason: '§6 conversation ID extraction and migration equality remain packaged.',
  },
  {
    file: 'src/pages/content/folder/nativeMenuActions.ts',
    values: ['.conversation-actions-container', 'li', '.cdk-overlay-pane', '.mat-mdc-menu-panel'],
    reason: '§6 destructive rename/delete/menu interaction protocol remains packaged.',
  },
  {
    file: 'src/pages/content/folder/nativeSidebarDom.ts',
    values: [
      '[data-test-id="conversation"]',
      '.conversation-actions-container',
      '[data-test-id^="history-item"]',
    ],
    reason:
      '§6 row/action association and parsed-ID protocol remain packaged alongside repaired discovery.',
  },
  {
    file: 'src/pages/content/markdownPatcher/index.ts',
    values: ['code-block', 'rich-textarea'],
    reason: '§6 mutation exclusions protect code and editable content from text rewriting.',
  },
  {
    file: 'src/pages/content/mermaid/renderer.ts',
    values: ['form'],
    reason: '§6 SVG sanitizer excludes interactive/resource-loading HTML tags.',
  },
  {
    file: 'src/pages/content/nativeHealth/pageEvidence.ts',
    values: ['textarea', 'main'],
    reason:
      'Independent native health evidence and exclusions must not depend on repaired locators.',
  },
  {
    file: 'src/pages/content/prompt/sentChipTargets.ts',
    values: ['user-query'],
    reason: 'Independent native user host and complete bundled text prove remote chip content.',
  },
  {
    file: 'src/pages/content/prompt/slashMarkers.ts',
    values: ['textarea'],
    reason: '§6 Voyager input-kind marker is a serialization discriminant, not a page locator.',
  },
  {
    file: 'src/pages/content/quoteReply/quoteInsertion.ts',
    values: ['rich-textarea'],
    reason: '§6 Quill write and input-event protocol retains native rich-textarea ownership.',
  },
  {
    file: 'src/pages/content/responseNotification/pageSnapshot.ts',
    values: ['[data-message-author-role="user"]', 'user-query'],
    reason:
      'Independent native user-role evidence prevents notifications from accepting assistant text as a user turn.',
  },
  {
    file: 'src/pages/content/selectionToolbar/host.ts',
    values: ['main', 'nav'],
    reason: '§6 selection event scope and native navigation exclusion remain packaged.',
  },
  {
    file: 'src/pages/content/sidebarWidth/buttonTargets.ts',
    values: ['bard-sidenav button'],
    reason:
      'Independent native sidebar-button/icon proof authorizes the forwarded action, separately from remote geometry.',
  },
  {
    file: 'src/pages/content/timeline/GeminiTimelineTurnSource.ts',
    values: ['main'],
    reason:
      '§6 timeline observer lifetime keeps its packaged main/body scope independently of online turn names.',
  },
  {
    file: 'src/pages/content/timeline/TimelineTurns.ts',
    values: ['deep-research-immersive-panel'],
    reason:
      '§6 transcript inclusion excludes immersive research sources independently of repaired turns.',
  },
  {
    file: 'src/pages/content/wavedrom/view.ts',
    values: ['.buttons'],
    reason:
      '§6 native copy-control movement and restoration must retain the packaged control identity.',
  },
];
