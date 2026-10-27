import type { LocatorLiteralException } from './types';

export const PLUGIN_RUNTIME_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/plugins/builtin/chatgptActionTargets.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role]': 1,
    },
    reason:
      'ChatGPT action candidates must be original controls outside turns/dialogs and same-origin native nav/home links; fixed landmarks corroborate rather than choose the remote action. Additional button/role-button checks corroborate native actionable type before label/state proof.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptComposerTargets.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role]': 1,
      '[data-chatgpt-selection-message-id]': 1,
    },
    reason:
      'Repaired composer cannot be inside original dialog, turn or selection-message ownership; the selector is only a rejection boundary. Additional closest(form) preserves native unique submit/form association.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/challengeGuard.ts',
    kind: 'protocol',
    values: {
      '#prompt-textarea': 1,
    },
    reason:
      'Local Bridge independent challenge/health evidence deliberately recognizes the native ChatGPT shell when site data is broken; design §6 independent native health applies. Additional #prompt-textarea is part of the independent native healthy-shell witness.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptReplyContent.ts',
    kind: 'proof',
    values: {
      '[data-chatgpt-selection-message-id]': 1,
    },
    reason:
      'Readiness failure notices use packaged native assistant identity owners, then resolveChatgptReplyContent performs the guarded complete-content read before classifying an element.',
  },
  {
    file: 'src/features/plugins/manifest/validate.ts',
    kind: 'protocol',
    values: {
      '.label': 1,
    },
    reason: 'Validator diagnostic path ending .label/.title; not CSS or DOM query data.',
  },
  {
    file: 'src/features/plugins/runtime/semanticElements.ts',
    kind: 'protocol',
    values: {
      'code-block': 1,
    },
    reason:
      'code-block is compared only to route the packaged Gemini configuration into resolveGeminiCodeHosts. Actual remote winners always come from that guard; fixed admission routing, not raw selection.',
  },
];
