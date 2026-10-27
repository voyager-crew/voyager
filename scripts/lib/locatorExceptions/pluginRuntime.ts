import type { LocatorLiteralException } from './types';

export const PLUGIN_RUNTIME_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/plugins/builtin/chatgptActionTargets.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role]': 1,
      '[role="dialog"]': 1,
      nav: 1,
      aside: 1,
      button: 1,
      '[role="button"]': 1,
    },
    reason:
      'ChatGPT action candidates must be original controls outside turns/dialogs and same-origin native nav/home links; fixed landmarks corroborate rather than choose the remote action. Additional button/role-button checks corroborate native actionable type before label/state proof.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptComposerTargets.ts',
    kind: 'proof',
    values: {
      '[role="dialog"]': 1,
      '[data-message-author-role]': 1,
      '[data-chatgpt-selection-message-id]': 1,
      form: 1,
    },
    reason:
      'Repaired composer cannot be inside original dialog, turn or selection-message ownership; the selector is only a rejection boundary. Additional closest(form) preserves native unique submit/form association.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/challengeGuard.ts',
    kind: 'protocol',
    values: {
      form: 2,
      '#prompt-textarea': 1,
      main: 1,
      nav: 1,
    },
    reason:
      'Local Bridge independent challenge/health evidence deliberately recognizes the native ChatGPT shell when site data is broken; design §6 independent native health applies. Additional #prompt-textarea is part of the independent native healthy-shell witness.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/ops/approvalCard.ts',
    kind: 'protocol',
    values: {
      form: 1,
      button: 2,
    },
    reason:
      'Approval card form buttons are fixed native user-action protocol, distinguished by keyboard-hint meanings; they must not be remapped by locator data. Additional button error sentence is diagnostic prose, not a CSS read.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/ops/attachmentEvidence.ts',
    kind: 'proof',
    values: {
      textarea: 1,
      progress: 1,
    },
    reason:
      'Attachment proof rejects edit controls and script/style/template nodes as file cards; candidates come from separately guarded data. Additional progress is only a diagnostic signal name; actual lookup uses packaged attachmentProgress data.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/ops/pageReaders.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Button enumeration is bounded to the guarded composer form and checks native isStopControlTarget; Stop semantics stay packaged.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/ops/projectPage.ts',
    kind: 'protocol',
    values: {
      'a[href]': 1,
    },
    reason:
      'a[href] is scoped within an existing project row and parsed projectPageIdOf(path) must equal its projectId. Original identity association, not sidebar discovery.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/ops/projectSources.ts',
    kind: 'protocol',
    values: {
      '[role="menuitem"]': 1,
      '[role="dialog"]': 1,
    },
    reason:
      'Destructive project-source removal diagnostics report native confirmation-dialog presence; remote locators must not redefine destructive confirmation.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptModelSelect/pickerDom.ts',
    kind: 'proof',
    values: {
      button: 1,
      '[role="button"]': 1,
      form: 1,
      '[aria-hidden="true"]': 1,
      '[role="status"]': 1,
      '[role="menuitemradio"]': 1,
    },
    reason:
      'Trigger candidates require unique native menu-button type, form ownership, known model label and agreement with original identity. Hidden captions are stripped from a clone; status/menuitemradio are fixed native ARIA model metadata/checked-state protocol under §6.',
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
    file: 'src/features/plugins/builtin/chatgptResponseNotification/page.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Button scans/closest/type identify original labelled or inline-SVG Stop controls inside guarded composer roots. Fixed Stop/completion event semantics.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptTemporaryHandoff/composerPick.ts',
    kind: 'protocol',
    values: {
      '[hidden]': 2,
      '[aria-hidden="true"]': 2,
    },
    reason:
      'Hidden/inert/disabled selectors refuse unavailable candidates; composer location comes through the guarded path.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptTemporaryHandoff/index.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'button literals construct/configure a Voyager-owned handoff button.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptTemporaryHandoff/ui.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Constructors create Voyager dialog controls; the focusables selector is bounded to that own dialog. Own-DOM/ARIA-focus protocol.',
  },
  {
    file: 'src/features/plugins/builtin/geminiExportManifest.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Manifest description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/builtin/geminiForkManifest.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Manifest description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/builtin/geminiQuoteReplyManifest.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Manifest description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/builtin/geminiResearchPackManifest.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Manifest description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/local/authoring/pluginExamples.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason:
      'main is a fallback target written into a user-facing example manifest when no semantic anchor exists. Preferred targets use semantic keys; this never queries the current host.',
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
  {
    file: 'src/features/plugins/sends/trackUserSends.ts',
    kind: 'protocol',
    values: {
      form: 2,
      button: 2,
    },
    reason:
      'Native form association for send events remains packaged; when the composer is remote this code uses provedRoot instead, preserving its accepted owner. Additional native button closest/fallback filters real send events. Remote mode instead uses guarded sendButton/provedRoot; unrelated clicks do not invoke proofs.',
  },
  {
    file: 'src/features/plugins/sites/sections/pageHooksData.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'button is an allowed schema property name, not a CSS value.',
  },
  {
    file: 'src/features/plugins/sites/semanticKeys.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Semantic-key explanatory prose, not CSS.',
  },
];
