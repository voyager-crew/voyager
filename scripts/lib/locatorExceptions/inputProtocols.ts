import type { LocatorLiteralException } from './types';

export const INPUT_PROTOCOLS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/chatInput/vimInputTargets.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'After the packaged Vim sendTarget matches, closest(button) converts the existing target into its native actionable button. This is the send/event ownership protocol, not an independent composer discovery locator.',
  },
  {
    file: 'src/pages/content/prompt/PromptTemplateFill.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own PromptTemplateFill controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/SentPromptChips.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own controls in this module. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/promptListView.ts',
    kind: 'protocol',
    values: {
      button: 9,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own promptListView controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/promptPanelChrome.ts',
    kind: 'protocol',
    values: {
      button: 7,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own promptPanelChrome controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/promptPreview.ts',
    kind: 'protocol',
    values: {
      'a[href]': 1,
    },
    reason:
      'a[href] traversal applies target/rel policy to links in Voyager’s rendered prompt preview. It serializes/controls an owned preview, not a host-page locator.',
  },
  {
    file: 'src/pages/content/prompt/promptReorder.ts',
    kind: 'protocol',
    values: {
      button: 1,
      textarea: 1,
    },
    reason:
      'Voyager prompt-reorder control exclusion keeps native clicks in buttons/links/editables from starting drag; own UI interaction policy.',
  },
  {
    file: 'src/pages/content/prompt/promptThemeToggle.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own promptThemeToggle controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/savedLibraryView.ts',
    kind: 'protocol',
    values: {
      button: 16,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own savedLibraryView controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/sentChipTargets.ts',
    kind: 'proof',
    values: {
      'model-response': 2,
      textarea: 1,
      button: 1,
      'user-query': 1,
      '[role="dialog"]': 1,
    },
    reason:
      'Sent-chip remote text/bubbles reject assistant/editor/action/dialog/Voyager ownership and must equal complete native text/bubble evidence before chip side effects.',
  },
  {
    file: 'src/pages/content/prompt/slashMarkers.ts',
    kind: 'protocol',
    values: {
      button: 1,
      textarea: 2,
    },
    reason:
      'Textarea cleanup/expansion is scoped by Voyager’s own TEXTAREA_HAS_TOKEN_CLASS. role=button is assigned to Voyager prompt chips, and the textarea word stored in gvInputKind is a serialization discriminant.',
  },
  {
    file: 'src/pages/content/prompt/slashPlacements.ts',
    kind: 'protocol',
    values: {
      textarea: 1,
    },
    reason:
      'Textarea lookup includes a Voyager-owned token-marker class for cleanup/expansion; no host composer location is encoded.',
  },
  {
    file: 'src/pages/content/prompt/slashPrompt.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own slashPrompt controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/prompt/slashTokenEditing.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'role=button describes Voyager’s own inserted prompt token and its keyboard/ARIA behavior. The token carries gv-owned prompt data, not host locator data.',
  },
  {
    file: 'src/pages/content/promptHistory/captureNavigation.ts',
    kind: 'protocol',
    values: {
      'a[href]': 1,
    },
    reason:
      'Native a[href] click resolution is filtered by modifiers, same-tab, same-origin and packaged /app or /gem routes to invalidate a pending capture on real navigation. It cannot choose an alternate composer or conversation.',
  },
  {
    file: 'src/pages/content/promptHistory/historyList.ts',
    kind: 'protocol',
    values: {
      button: 6,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own historyList controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/promptHistory/index.ts',
    kind: 'protocol',
    values: {
      button: 4,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own index controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/promptHistory/promptInput.ts',
    kind: 'proof',
    values: {
      '[role="dialog"]': 1,
    },
    reason:
      'Prompt-history capture rejects Voyager panels and native dialogs before admitting the main input.',
  },
];
