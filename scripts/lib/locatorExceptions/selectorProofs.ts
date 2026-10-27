import type { LocatorLiteralException } from './types';

export const SELECTOR_PROOFS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/core/selectors/chatgptSemantics.ts',
    kind: 'proof',
    values: {
      '[role="dialog"]': 1,
      form: 1,
      '[data-message-author-role="user"]': 1,
      '[data-message-author-role="assistant"]': 1,
      '[data-message-author-role="model"]': 1,
    },
    reason:
      'provesTurns compares candidate lists with complete native role/identity owners; foreign editable/dialog owners fail. Dynamic role values are packaged user/assistant protocol.',
  },
  {
    file: 'src/core/selectors/chatgptSignals.ts',
    kind: 'proof',
    values: {
      '[aria-busy="true"]': 2,
      '[role="progressbar"]': 2,
      progress: 2,
    },
    reason:
      'ARIA-busy/progressbar/progress provide independent native streaming evidence under original turn IDs. Remote aliases may add refusal only, retaining the entire native floor.',
  },
  {
    file: 'src/core/selectors/composerSemantics.ts',
    kind: 'protocol',
    values: {
      ':not(*)': 3,
    },
    reason:
      ':not(*) is the internal no-match sentinel when a profile is absent; it does not encode a repairable page landmark.',
  },
  {
    file: 'src/core/selectors/contentIntegrity.ts',
    kind: 'proof',
    values: {
      button: 2,
      '[role="button"]': 1,
      li: 1,
      h3: 1,
    },
    reason:
      'preservesCompleteContent rejects cutting native prose/code/math frames out of the owner before comparing all content leaves. Additional controls/editables/Voyager rejection and text-walker button policy establish an independent complete content reference; image-bearing native buttons retain serialization.',
  },
  {
    file: 'src/core/selectors/contracts/gemini.ts',
    kind: 'protocol',
    values: {
      'generated-image': 1,
    },
    reason: 'generated-image.json is a publication filename, not CSS.',
  },
  {
    file: 'src/core/selectors/placement.ts',
    kind: 'proof',
    values: {
      button: 2,
      'a[href]': 1,
      '[role="button"]': 1,
      '[role="menuitem"]': 2,
      '[role="menuitemradio"]': 2,
      'gem-menu-item': 1,
      textarea: 1,
    },
    reason:
      'Mount safety rejects composed editable ancestors. This is the fixed acceptance rule, not a page location. menu-row spelling/role comparison defines only the narrow packaged native decoration exception, after independent picker ownership proof.',
  },
  {
    file: 'src/core/selectors/semanticSnapshot.ts',
    kind: 'protocol',
    values: {
      ':not(*)': 1,
    },
    reason: ':not(*) is the internal no-match sentinel, not a host landmark.',
  },
  {
    file: 'src/core/selectors/siteSemantics.ts',
    kind: 'proof',
    values: {
      form: 2,
      '[role="dialog"]': 1,
      nav: 1,
      aside: 1,
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
      ':not(*)': 1,
      textarea: 1,
      button: 1,
    },
    reason:
      'Generic semantic proof forbids foreign edit/dialog/nav content and confirms structural ownership of complete native turns; remote winners are selected separately. Hidden/inert/ARIA-hidden are proof refusals; button.gv-code-block-toggle is own source-preserving decoration skipped during reference comparison; :not(*) is the no-match sentinel.',
  },
];
