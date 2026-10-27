import type { LocatorLiteralException } from './types';

export const PLUGIN_VERBS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/plugins/verbs/codeBlockDiagram.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'createElement/button.type build Voyager shadow-toolbar controls; native host/source reads use createDiagramRead.',
  },
  {
    file: 'src/features/plugins/verbs/codeBlockDiagramParams.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Parameter description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/verbs/codeBlockDiagramStyles.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'button selectors/full CSS belong only to Voyager diagram ShadowRoot, a §6 own-DOM/CSS sink.',
  },
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
    file: 'src/features/plugins/verbs/codeCollapse/codeCollapseAll.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason: 'createElement(button)/type=button create Voyager-owned toolbar controls.',
  },
  {
    file: 'src/features/plugins/verbs/codeCollapse/contract.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Parameter description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/verbs/codeCollapse/index.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'CSS for Voyager-owned collapse toolbar buttons, a design §6 CSS sink.',
  },
  {
    file: 'src/features/plugins/verbs/copyButton/button.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'button literals construct/configure and style own ShadowRoot copy controls. Own-DOM/CSS protocol.',
  },
  {
    file: 'src/features/plugins/verbs/copyButton/contract.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason: 'Contract description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/verbs/copyButton/text.ts',
    kind: 'protocol',
    values: {
      button: 1,
      '[role="button"]': 1,
    },
    reason:
      'CONTROL applies only alongside Voyager gv- ownership/shadow-root evidence to strip own UI from copied text; it cannot select native content.',
  },
  {
    file: 'src/features/plugins/verbs/draftSave/contract.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason: 'Manifest documentation prose describing draft behavior; never queried as CSS.',
  },
  {
    file: 'src/features/plugins/verbs/folders/folderGuide.ts',
    kind: 'protocol',
    values: {
      '[aria-hidden="true"]': 1,
    },
    reason:
      'ARIA-hidden/data-state=closed only refuse invisible overlays after site data supplies the collection. Native visibility protocol, not overlay discovery.',
  },
  {
    file: 'src/features/plugins/verbs/folders/folderPicker.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason: 'All hits construct Voyager picker buttons/type attributes.',
  },
  {
    file: 'src/features/plugins/verbs/folders/moveMenuEntry.ts',
    kind: 'protocol',
    values: {
      '[aria-hidden="true"]': 1,
    },
    reason:
      "ARIA-hidden icon-holder query operates only on buildMenuEntry's sanitized clone for the Voyager move entry. §6 clone-sanitizer/own-DOM boundary.",
  },
  {
    file: 'src/features/plugins/verbs/folders/rowMenu.ts',
    kind: 'protocol',
    values: {
      '[aria-hidden="true"]': 1,
    },
    reason:
      'dropShortcuts removes kbd/hidden holders only from sanitized cloned menu entries. Native clone sanitization, not host lookup.',
  },
  {
    file: 'src/features/plugins/verbs/folders/siteData.ts',
    kind: 'protocol',
    values: {
      ':not(*)': 1,
    },
    reason:
      'Generic :not(...) composition around site-provided keepShown selectors for packaged hide-filed CSS; static part contains no page landmark.',
  },
  {
    file: 'src/features/plugins/verbs/quoteReply/index.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason: 'button literals construct/configure the Voyager floating quote action.',
  },
  {
    file: 'src/features/plugins/verbs/quoteReply/text.ts',
    kind: 'protocol',
    values: {
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
    },
    reason:
      'script/style/hidden/aria-hidden are fixed selected-text serialization exclusions before quote insertion.',
  },
  {
    file: 'src/features/plugins/verbs/sendShortcut/contract.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'Keyboard behavior description prose, not CSS.',
  },
  {
    file: 'src/features/plugins/verbs/sendShortcut/index.ts',
    kind: 'protocol',
    values: {
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
    },
    reason:
      'Hidden/inert/disabled refusal conditions are fixed Send/Stop/IME/disabled event policy under §6.',
  },
  {
    file: 'src/features/plugins/verbs/siteCheck/index.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason: 'createElement(button)/type=button create the Voyager launcher.',
  },
  {
    file: 'src/features/plugins/verbs/siteCheck/panel.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'el(doc,button)/type=button create Voyager panel controls, not native lookups.',
  },
  {
    file: 'src/features/plugins/verbs/siteCheck/picker.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason: 'createElement(button)/type=button create Voyager picker cancel UI.',
  },
  {
    file: 'src/features/plugins/verbs/siteCheck/skeleton.ts',
    kind: 'protocol',
    values: {
      '[role="button"]': 1,
      '[role="menuitemradio"]': 1,
      '[role="menuitem"]': 1,
      '[role="dialog"]': 1,
      '[role="listitem"]': 1,
      '[role="progressbar"]': 1,
      '[role="menuitem"][data-reasoning-slider="true"]': 1,
      '[role="status"]': 1,
    },
    reason:
      'Site Check structural skeleton serializes a sanitized ARIA role into diagnostic output; it does not query the page.',
  },
  {
    file: 'src/features/plugins/verbs/siteCheck/styles.ts',
    kind: 'protocol',
    values: {
      button: 1,
      '[hidden]': 2,
      h3: 1,
      li: 1,
    },
    reason:
      'Voyager Site Check shadow-panel stylesheet; own DOM and packaged CSS sink. Additional button/hidden/full picker CSS is only for Voyager shadow UI, a §6 CSS sink.',
  },
  {
    file: 'src/features/plugins/verbs/tableCopy/toolbar.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'button literals construct/configure and style Voyager table-copy shadow toolbar; own-DOM/CSS protocol.',
  },
  {
    file: 'src/features/plugins/verbs/userLatex/index.ts',
    kind: 'proof',
    values: {
      textarea: 2,
      button: 1,
      '[aria-hidden="true"]': 1,
      'p.query-text-line': 1,
      '.query-text-line': 1,
      'user-query': 2,
    },
    reason:
      'Renderer exclusion of editables on every ancestor is an immutable editor-write safety boundary. Remote userLatex.lines can only be accepted against native user-query paragraph evidence; the native host identity is captured and rechecked after KaTeX yields to prevent movement into another turn. Additional textarea/button/ARIA-hidden are immutable rendering refusals. p.query-text-line appears only in equality routing the packaged configuration into resolveGeminiUserLatexLines; actual remote line enumeration remains guarded.',
  },
];
