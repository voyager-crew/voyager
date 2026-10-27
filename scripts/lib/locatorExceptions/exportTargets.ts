import type { LocatorLiteralException } from './types';

export const EXPORT_TARGETS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
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
      'user-query': 2,
      'generated-image': 1,
      'message-actions': 1,
      '.message-actions': 1,
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
      'generated-image': 1,
    },
    reason:
      'isChromeWrappedImage distinguishes native generated/search image source wrappers from button UI chrome while serializing an already selected image host. Standard button ancestry and native single-image/generated-image source grammar remain packaged source/HTML protocol; image host and attribution locator reads use the supplied profile.',
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
    file: 'src/pages/content/export/generatedUiScreenshots.ts',
    kind: 'protocol',
    values: {
      '.markdown': 1,
    },
    reason:
      'generatedUi.markdown is a namespaced key used to index packaged generated-UI data, not an embedded .markdown selector.',
  },
  {
    file: 'src/pages/content/export/menuTargets.ts',
    kind: 'protocol',
    values: {
      'gem-menu': 2,
    },
    reason:
      'Native GEM-MENU tag comparisons preserve its self-contained content and clone-insertion protocol after menu.panels accepts the panel; panel discovery still uses the published contract.',
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
    file: 'src/pages/content/export/responseActionImageButton.ts',
    kind: 'protocol',
    values: {
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
    },
    reason:
      'Dynamic conversation-ID-specific lookup retains native identity association and escaping. These are packaged identity/navigation paths, not general-purpose remote sidebar discovery.',
  },
  {
    file: 'src/pages/content/export/sidebarConversationTarget.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 1,
    },
    reason:
      'Original conversation row association plus standard native anchor traversal supplies href/jslog identity for menu/navigation targeting. Those identity and action-association rules stay packaged independently of repaired sidebar discovery.',
  },
];
