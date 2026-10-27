import type { LocatorLiteralException } from './types';

export const POPUP_PLUGINS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/popup/components/LocalPluginComposer.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own LocalPluginComposer controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/LocalPluginsPanel.tsx',
    kind: 'protocol',
    values: {
      button: 3,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own LocalPluginsPanel controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/NativeCatalogUpdatesCard.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own NativeCatalogUpdatesCard controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/NativeHealthNotice.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own NativeHealthNotice controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/NativeLocalPluginsSection.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own NativeLocalPluginsSection controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/PluginIdentity.tsx',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own PluginIdentity controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/components/PluginManager.tsx',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own PluginManager controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/popup/officialPlugins/officialPluginEntries.ts',
    kind: 'protocol',
    values: {
      nav: 3,
    },
    reason:
      'nav appears only in human-readable popup searchAliases. These are metadata search terms, not selectors or CSS sinks.',
  },
];
