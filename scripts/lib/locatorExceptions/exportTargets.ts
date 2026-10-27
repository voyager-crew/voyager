import type { LocatorLiteralException } from './types';

export const EXPORT_TARGETS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/export/adapter/chatgptCodeLanguage.ts',
    kind: 'proof',
    values: {
      form: 1,
      textarea: 1,
      '[role="dialog"]': 1,
    },
    reason:
      'Remote ChatGPT code-language label cannot be inside code/edit/dialog ownership; accepted language must independently match the native fence metadata.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptExportLocators.ts',
    kind: 'proof',
    values: {
      form: 3,
      '[role="dialog"]': 3,
      main: 2,
      nav: 1,
      aside: 1,
    },
    reason:
      'ChatGPT export thread/body proofs reject page roots and form/dialog/nav content, require native main/role owners and preserve every original message before a remote body is used.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptHistoryLocators.ts',
    kind: 'proof',
    values: {
      form: 2,
      textarea: 1,
      '[role="dialog"]': 2,
      main: 1,
      nav: 1,
      aside: 1,
      '[role="status"]': 1,
      '[aria-busy="true"]': 1,
    },
    reason:
      'ChatGPT history list/pending proofs require original turn IDs and main ownership; pending controls must be native status/busy nodes outside turns so remote data cannot finish crawling early.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptLegacyDom.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Native Stop button aliases are the fixed send/Stop/generation protocol, used alongside the guarded streaming reader. They prevent exporting an in-flight response and cannot be weakened by online locator replacements.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptThread.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Native Stop button aliases retain the fixed generation protocol. closest(button) excludes interactive upload/control chrome from an already identified message; this is source serialization policy, not a replacement turn/composer discovery read.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/conversationTitle.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 3,
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
    },
    reason:
      'Dynamic conversation-ID-specific lookup retains native identity association and escaping. These are packaged identity/navigation paths, not general-purpose remote sidebar discovery.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/geminiContentView.ts',
    kind: 'proof',
    values: {
      'user-query': 1,
      '.user-query-container': 1,
      'model-response': 1,
      '.model-response': 1,
      'response-container': 1,
      '.response-container': 1,
    },
    reason:
      'checkedGeminiContentView only reads these native counterpart lists when no turn profiles are repaired. If any turn profile is remote, it first acceptsGeminiTurnView and uses view.profiles. The results feed paired complete-content acceptance, never substitute the exported turn list.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/geminiImageRead.ts',
    kind: 'proof',
    values: {
      button: 1,
      'user-query': 2,
      'generated-image': 1,
      'message-actions': 1,
      '.message-actions': 1,
      h3: 1,
      li: 1,
      textarea: 1,
      'model-response': 1,
      '.model-response': 1,
    },
    reason:
      'Gemini search-image proof excludes native uploads/generated/video/actions and content frames, keeps original turn ownership, and requires independent full-size source metadata plus complete image leaves.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/genericDom.ts',
    kind: 'protocol',
    values: {
      'deep-research-immersive-panel': 1,
    },
    reason:
      'Unknown-host compatibility excludes immersive research sources from the transcript. This packaged serialization exclusion neither consults nor substitutes any site’s online turn/data locator.',
  },
  {
    file: 'src/pages/content/export/adapter/platform/imageContent.ts',
    kind: 'protocol',
    values: {
      button: 1,
      'generated-image': 1,
    },
    reason:
      'isChromeWrappedImage distinguishes native generated/search image source wrappers from button UI chrome while serializing an already selected image host. Standard button ancestry and native single-image/generated-image source grammar remain packaged source/HTML protocol; image host and attribution locator reads use the supplied profile.',
  },
  {
    file: 'src/pages/content/export/conversationCollector.ts',
    kind: 'protocol',
    values: {
      button: 2,
      '[role="button"]': 1,
    },
    reason:
      'On a detached clone of an already accepted response, role/button checks strip native reasoning-toggle UI by its fixed labels. They are serialization/control exclusions and cannot select a different exported response.',
  },
  {
    file: 'src/pages/content/export/conversationDom.ts',
    kind: 'protocol',
    values: {
      'deep-research-immersive-panel': 1,
      '.markdown': 1,
    },
    reason:
      'deep-research-immersive-panel is the fixed transcript/source exclusion. export.markdown is a profile key indexing packaged data; it is not a raw .markdown lookup.',
  },
  {
    file: 'src/pages/content/export/conversationMenuExportObserver.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation-title"]': 1,
      '[data-test-id="top-bar-actions"]': 1,
      '[data-test-id="side-nav"]': 1,
      '[data-test-id="overflow-container"]': 1,
      '[data-test-id="all-conversations"]': 1,
      '[data-test-id="conversation"]': 1,
      '[data-test-id="bard-mode-menu-button"]': 1,
      '[data-test-id="model-selector"]': 1,
      '[data-test-id="gems-side-nav-entry-button"]': 1,
      '[data-test-id="your-gems-list"]': 1,
    },
    reason:
      'Fixed native menu-trigger test IDs bind interaction observation to the real menu action protocol; the published menu panel/content winner is guarded separately.',
  },
  {
    file: 'src/pages/content/export/exportSelectionSession.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own exportSelectionSession controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/export/generatedUiScreenshots.ts',
    kind: 'protocol',
    values: {
      '.markdown': 1,
    },
    reason:
      'generatedUi.markdown is a namespaced key used to index packaged generated-UI data, not an embedded .markdown selector.',
  },
  {
    file: 'src/pages/content/export/logoExportButton.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'The button tag/type constructs Voyager’s own export control; the remaining button word occurs in diagnostic prose. Neither selects native host content.',
  },
  {
    file: 'src/pages/content/export/menuIdentity.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 1,
    },
    reason:
      'Original conversation row ancestry binds a native menu trigger to its identity owner for observation, teardown and operation cancellation. This fixed action/identity association cannot be redirected by a remote menu locator.',
  },
  {
    file: 'src/pages/content/export/persistentExportToolbar.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own persistentExportToolbar controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/export/responseActionImageButton.ts',
    kind: 'protocol',
    values: {
      button: 2,
      '[role="button"]': 1,
      '[data-test-id="conversation-title"]': 2,
      '[data-test-id="top-bar-actions"]': 2,
      '[data-test-id="side-nav"]': 2,
      '[data-test-id="overflow-container"]': 2,
      '[data-test-id="all-conversations"]': 2,
      '[data-test-id="conversation"]': 2,
      '[data-test-id="bard-mode-menu-button"]': 2,
      '[data-test-id="model-selector"]': 2,
      '[data-test-id="gems-side-nav-entry-button"]': 2,
      '[data-test-id="your-gems-list"]': 2,
    },
    reason:
      'button/gem-icon-button/ARIA-role checks operate on the already accepted clone source or Voyager’s sanitized clone to set click behavior and enable it. COPY_IMAGE_BUTTON_TEST_ID names Voyager’s own image-copy button for reuse/cleanup; it never discovers an exported answer.',
  },
  {
    file: 'src/pages/content/export/responseActionTargets.ts',
    kind: 'proof',
    values: {
      button: 1,
      '[role="button"]': 1,
      'message-actions': 1,
      '.message-actions': 1,
      '.actions-container-v2': 1,
      '.buttons-container-v2': 1,
      '[data-message-author-role="assistant"]': 1,
      '[data-message-author-role="model"]': 1,
      'article[data-author="assistant"]': 1,
      'article[data-turn="assistant"]': 1,
      'article[data-turn="model"]': 1,
      '.model-response': 1,
      'model-response': 1,
      '.response-container': 1,
      '.presented-response-container': 1,
      '[data-test-id="conversation-title"]': 5,
      '[data-test-id="top-bar-actions"]': 5,
      '[data-test-id="side-nav"]': 5,
      '[data-test-id="overflow-container"]': 5,
      '[data-test-id="all-conversations"]': 5,
      '[data-test-id="conversation"]': 5,
      '[data-test-id="bard-mode-menu-button"]': 5,
      '[data-test-id="model-selector"]': 5,
      '[data-test-id="gems-side-nav-entry-button"]': 5,
      '[data-test-id="your-gems-list"]': 5,
      'message-content': 1,
      '.markdown': 1,
      '.markdown-main-panel': 1,
    },
    reason:
      'Original copy/More test IDs and native actionable button/role wrappers independently identify the clone anchor and original assistant owner. A repaired action bar must contain exactly these complete anchors, reject answer/thought descendants and preserve ownership. Dynamic test-id templates interpolate only fixed native action IDs; they do not admit online identities.',
  },
  {
    file: 'src/pages/content/export/selectionIds.ts',
    kind: 'protocol',
    values: {
      'user-query': 1,
      'user-query-content': 1,
    },
    reason:
      'user-${index} is a persisted/legacy turn-ID fallback used in a hash, not CSS or tag construction. Identity serialization stays packaged.',
  },
  {
    file: 'src/pages/content/export/sidebarConversationNavigation.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 1,
      'a[href]': 1,
    },
    reason:
      'Dynamic conversation-ID-specific lookup retains native identity association and escaping. These are packaged identity/navigation paths, not general-purpose remote sidebar discovery.',
  },
  {
    file: 'src/pages/content/export/sidebarConversationTarget.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 1,
      'a[href]': 2,
    },
    reason:
      'Original conversation row association plus standard native anchor traversal supplies href/jslog identity for menu/navigation targeting. Those identity and action-association rules stay packaged independently of repaired sidebar discovery.',
  },
  {
    file: 'src/pages/content/export/sites/catalogReader.ts',
    kind: 'protocol',
    values: {
      '[role="button"]': 1,
    },
    reason:
      'The role=button removal runs on the detached exported content clone to strip controls after message selection. It is HTML/ARIA serialization policy, not a raw live page locator read.',
  },
];
