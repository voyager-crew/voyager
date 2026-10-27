import type { LocatorLiteralException } from './types';

export const OWNED_UI_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/components/LanguageSelect.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      '§6 Voyager-owned popup HTML output: JSX type=button defines native button behavior; it never reads a host-page target.',
  },
  {
    file: 'src/components/ui/segmented-control.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      '§6 Voyager-owned popup HTML output: JSX type=button defines native button behavior; it never reads a host-page target.',
  },
  {
    file: 'src/core/ui/collapse/toggle.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'createElement(button)/type=button construct Voyager-owned controls; automatically excludable HTML construction.',
  },
  {
    file: 'src/core/ui/confirm.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'createElement(button)/type=button construct gv-confirm-button controls, not host queries.',
  },
  {
    file: 'src/core/ui/layer.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      "Focusable button/href/input query is scoped to Voyager's ShadowRoot. Own-DOM and ARIA-focus protocol.",
  },
  {
    file: 'src/core/ui/toast/view.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason: 'createElement(button)/type=button construct Voyager toast controls.',
  },
  {
    file: 'src/pages/background/bridge/dispatcherConfig.ts',
    kind: 'protocol',
    values: {
      progress: 1,
    },
    reason:
      'progress is a TypeScript Pick method name in the BridgeClient contract; it is neither a CSS string nor a DOM lookup.',
  },
  {
    file: 'src/pages/library/Library.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own Library controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/tests/confirmDriver.ts',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      '§6 Voyager-owned confirm driver reads buttons only within the gv-confirm shadow dialog, never an AI host page. The tests directory is intentionally scanned like shipped source.',
  },
  {
    file: 'src/tests/toastDriver.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      '§6 Voyager-owned toast driver reads buttons only within a gv-toast element reached through its owned shadow layer, never an AI host page.',
  },
];
