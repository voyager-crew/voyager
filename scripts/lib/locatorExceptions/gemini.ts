import type { LocatorLiteralException } from './types';

export const GEMINI_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/core/gemini/code/hosts.ts',
    kind: 'proof',
    values: {
      'model-response': 2,
      'message-content': 1,
      '.model-response': 1,
      'rich-textarea': 1,
      'code-block': 1,
    },
    reason:
      'isNativeCodeOwner rejects transcript roots, editors, dialogs, controls and Voyager islands before a remote code.host can count; these strings never select an exported code winner. Additional code-block closest() is only inside nativeHosts(), the independent complete-source/header expected-host witness. Actual remote winners must equal that native reference.',
  },
  {
    file: 'src/core/gemini/domBoundary.ts',
    kind: 'proof',
    values: {
      'bard-sidenav': 1,
      'side-nav': 1,
      'input-area-v2': 1,
      'input-container': 1,
      '.text-input-field': 1,
      '.input-area': 1,
      'immersive-panel': 1,
      'inline-preview': 1,
      '.mat-mdc-dialog-container': 1,
      '[data-chat-scrollport]': 1,
      'chat-app': 2,
      '#app-root': 1,
    },
    reason:
      'Independent packaged app-root/main and disjoint native sidebar/chat/composer/Canvas witnesses distinguish a shared outer landmark from a nested preview. These literals never select a remote winner: native peers must exclude Voyager and foreign ownership, and an overlay cannot certify its own copied app or main.',
  },
  {
    file: 'src/core/gemini/composer/ownedInput.ts',
    kind: 'proof',
    values: {
      '.text-input-field': 1,
      '.input-area': 1,
      'input-area-v2': 1,
      'input-container': 1,
      '.edit-container': 1,
      '.user-query-container.edit-mode': 1,
      '.user-query-container': 1,
      '[data-message-author-role]': 1,
    },
    reason:
      'findOwnedGeminiMainInputs independently enumerates native editables and rejects edit/dialog/transcript/Voyager owners; it corroborates a repaired input rather than consuming its locator. native.ts reuses these owners as its independent main-composer owner/editability witness, so remote locators cannot redefine main ownership or the native editable protocol.',
  },
  {
    file: 'src/core/gemini/content/conversation.ts',
    kind: 'protocol',
    values: {
      'deep-research-immersive-panel': 1,
    },
    reason:
      'deep-research-immersive-panel is a fixed content exclusion on the packaged conversation fallback, preserving native transcript serialization. Remote roots separately require complete turn ownership.',
  },
  {
    file: 'src/core/gemini/content/reads.ts',
    kind: 'proof',
    values: {
      'message-actions': 2,
      '.message-actions': 1,
      'code-block': 1,
      'generated-image': 1,
    },
    reason:
      'readGeminiContentLeaves excludes thought/action text before complete-leaf identity comparison; this is the independent reference, not answer selection. belongsToHost rejects a candidate crossing a nested original turn/conversation owner; it cannot contribute another turn to the remote result. preservesGeminiContentFrames forbids starting inside native prose/code/math/image frames, preserving serialization and full content independently of remote spelling. Native context-image witness excludes action/icon descendants before requiring full-size source metadata and exact image identity/order. Additional button/attachment-preview exclusions preserve every authored native paragraph in the independent complete reference.',
  },
  {
    file: 'src/core/gemini/selectors/bundle.ts',
    kind: 'protocol',
    values: {
      'generated-image': 1,
    },
    reason:
      'generated-image is only a readGroup validation-context label. Actual CSS values come from the site-owned JSON fragment.',
  },
  {
    file: 'src/core/gemini/selectors/extendedKeys.ts',
    kind: 'protocol',
    values: {
      '.buttons': 1,
    },
    reason:
      'This is a namespaced profile key (code.buttons/sidebarWidth.buttons), not a CSS read; tokenizer should not interpret its dot as a class selector.',
  },
  {
    file: 'src/core/gemini/selectors/sidebarInteractionKeys.ts',
    kind: 'protocol',
    values: {
      '.buttons': 1,
    },
    reason:
      'This is a namespaced profile key (code.buttons/sidebarWidth.buttons), not a CSS read; tokenizer should not interpret its dot as a class selector.',
  },
  {
    file: 'src/core/gemini/selectors/types.ts',
    kind: 'protocol',
    values: {
      '.buttons': 1,
    },
    reason:
      'This is a namespaced profile key (code.buttons/sidebarWidth.buttons), not a CSS read; tokenizer should not interpret its dot as a class selector.',
  },
  {
    file: 'src/core/gemini/sidebar/actions.ts',
    kind: 'proof',
    values: {
      'model-response': 1,
      'user-query': 1,
      '[data-test-id="conversation"]': 1,
    },
    reason:
      'nativeControl rejects transcript/editable/dialog/menu ownership before independently proving the Gemini sidebar toggle action. Original conversation-row and unique haspopup/controls queries corroborate exact row/menu identity via ARIA association before a repaired actionsContainer counts.',
  },
  {
    file: 'src/core/gemini/sidebar/proof.ts',
    kind: 'proof',
    values: {
      'model-response': 1,
      'user-query': 1,
      '[data-message-author-role]': 1,
      'bard-sidenav': 2,
      'side-nav': 2,
      'chat-app': 1,
      '#app-root': 1,
      '[data-test-id="conversation"]': 3,
      'a[data-test-id="conversation"][href]': 1,
    },
    reason:
      'Original sidebar/app/content landmarks independently corroborate remote sidebar candidates. Native sidebar ownership, rather than a shared outer main or nested conversation navigation list, bounds content and the innermost scrolling ancestor. A candidate overflow/host cannot contain the native chat region. Native conversation links, button roles and state-marker association prove the proposed owner without selecting exported mount winners.',
  },
  {
    file: 'src/core/gemini/sidebar/titleProof.ts',
    kind: 'proof',
    values: {
      '[data-test-id="conversation-title"]': 1,
      '.title-text': 1,
    },
    reason:
      'nativeSidebarTitle independently matches same-origin/account conversation identity and native title sources; remote titles are accepted only when they agree with this title witness. a[href] enumerates the independent same-origin/account/parsed conversation-ID title witness.',
  },
  {
    file: 'src/core/gemini/turnOwners.ts',
    kind: 'proof',
    values: {
      '[data-chat-scrollport]': 1,
      'model-response': 1,
      'user-query': 1,
      'section[data-test-id="model-response"]': 1,
      'section[data-test-id="user-query"]': 1,
    },
    reason:
      'Packaged exchange and turn owners of both Gemini frontends (Angular and the React rewrite, #1113). Turn, content, composer and boundary proofs read them to reject a candidate that crosses another turn or exchange; they never select a remote winner, so a remote repair for either UI meets the same ownership bar. userLatex.ts enumerates the user hosts only in nativeLines(), the independent complete-paragraph reference that excludes controls, code, hidden metadata and user attachment previews; remote LaTeX lines must equal that complete native list and are never selected by it.',
  },
  {
    file: 'src/core/gemini/turnIntegrity.ts',
    kind: 'protocol',
    values: {
      'deep-research-immersive-panel': 1,
      'message-actions': 1,
      '.message-actions': 1,
    },
    reason:
      'Native transcript serialization excludes research/thought/action owners and Voyager timestamps; remote turn collection still comes through guarded turn profiles.',
  },
];
