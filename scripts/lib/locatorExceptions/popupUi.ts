import type { LocatorLiteralException } from './types';

export const POPUP_UI_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/popup/components/CatalogTimelineOptions.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own CatalogTimelineOptions controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/ChatGptBridgeCard.tsx',
    kind: 'protocol',
    values: {
      button: 4,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own ChatGptBridgeCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/ChatGptExportCard.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own ChatGptExportCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/DiagnosticsExportCard.tsx',
    kind: 'protocol',
    values: {
      button: 4,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own DiagnosticsExportCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/GeneralSettingsCard.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own GeneralSettingsCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/KeyboardShortcutSettings.tsx',
    kind: 'protocol',
    values: {
      button: 5,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own KeyboardShortcutSettings controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/PopupSearchBox.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own PopupSearchBox controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/PopupSection.tsx',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own PopupSection controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/PopupToc.tsx',
    kind: 'protocol',
    values: {
      h3: 1,
      button: 1,
    },
    reason:
      'The h2/h3 query runs inside Voyager’s extension popup sections to move focus to their own headings. JSX button type also defines own controls; neither reads an AI host page.',
  },
  {
    file: 'src/pages/popup/components/PromptManagerSettingsCard.tsx',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own PromptManagerSettingsCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/StarredHistory.tsx',
    kind: 'protocol',
    values: {
      button: 6,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own StarredHistory controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/StorageManager.tsx',
    kind: 'protocol',
    values: {
      button: 7,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own StorageManager controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/StorageQuotaCard.tsx',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own StorageQuotaCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/ToolbarPinHint.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own ToolbarPinHint controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/UndoToast.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own UndoToast controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
];
