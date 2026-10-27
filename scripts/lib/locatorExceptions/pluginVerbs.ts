import type { LocatorLiteralException } from './types';

export const PLUGIN_VERBS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/plugins/verbs/codeBlockDiagramTargets.ts',
    kind: 'protocol',
    values: {
      'code-block': 1,
    },
    reason:
      'code-block appears only in the usesGeminiCodeFixes equality routing packaged configuration into resolveGeminiCodeHosts; no raw host read.',
  },
  {
    file: 'src/features/plugins/verbs/siteCheck/skeleton.ts',
    kind: 'protocol',
    values: {
      '[role="menuitem"][data-reasoning-slider="true"]': 1,
    },
    reason:
      'Site Check structural skeleton serializes a sanitized ARIA role into diagnostic output; it does not query the page.',
  },
  {
    file: 'src/features/plugins/verbs/userLatex/index.ts',
    kind: 'proof',
    values: {
      'p.query-text-line': 1,
      '.query-text-line': 1,
      'user-query': 2,
    },
    reason:
      'Renderer exclusion of editables on every ancestor is an immutable editor-write safety boundary. Remote userLatex.lines can only be accepted against native user-query paragraph evidence; the native host identity is captured and rechecked after KaTeX yields to prevent movement into another turn. Additional textarea/button/ARIA-hidden are immutable rendering refusals. p.query-text-line appears only in equality routing the packaged configuration into resolveGeminiUserLatexLines; actual remote line enumeration remains guarded.',
  },
];
