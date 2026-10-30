import { describe, expect, it } from 'vitest';

import {
  FEATURE_OWNERS,
  type OwnedFeature,
  PACKAGED_OFFICIAL_PLUGIN_IDS,
  isPackagedOfficialPluginId,
  ownedFeatureByPluginId,
  pluginOwnedHandlers,
  tracksPluginHealth,
} from './featureOwners';

function entry(overrides: Partial<OwnedFeature>): OwnedFeature {
  return {
    site: 'gemini',
    feature: 'formulaCopy',
    officialPluginId: 'voyager.gemini-formula-copy',
    handlers: ['formulaCopy'],
    healthTracking: false,
    ...overrides,
  };
}

describe('feature owners', () => {
  it('names each feature once, with an official id the build reserves', () => {
    const features = FEATURE_OWNERS.map(({ site, feature }) => `${site}/${feature}`);
    expect(new Set(features).size).toBe(features.length);
    const ids = FEATURE_OWNERS.map((owned) => owned.officialPluginId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isPackagedOfficialPluginId(id)).toBe(true);
      expect(ownedFeatureByPluginId(id)?.officialPluginId).toBe(id);
    }
  });

  it('reserves official ids whoever owns the feature', () => {
    expect(PACKAGED_OFFICIAL_PLUGIN_IDS.has('voyager.gemini-formula-copy')).toBe(true);
    expect(isPackagedOfficialPluginId('voyager.formula-copy')).toBe(false);
    expect(isPackagedOfficialPluginId('local.gemini-formula-copy')).toBe(false);
    expect(ownedFeatureByPluginId('voyager.formula-copy')).toBeNull();
  });

  it('opens the renderer primitives on Gemini', () => {
    expect(pluginOwnedHandlers('gemini')).toEqual(
      new Set([
        'formulaCopy',
        'vimInput',
        'userLatex',
        'codeCollapse',
        'wavedrom',
        'echarts',
        'mermaid',
        'sendShortcut',
        'draftSave',
        'turnNavigator',
        'folders',
        'siteCheck',
      ]),
    );
    // Folders on both are their official plugins'; local plugins stay refused (packagedFoldersPolicy).
    expect(pluginOwnedHandlers('aistudio')).toEqual(
      new Set(['formulaCopy', 'sendShortcut', 'folders', 'siteCheck']),
    );
    // Appearance is pure CSS or a fixed-id builtin: it opens no primitive.
    for (const id of [
      'voyager.gemini-chat-font-size',
      'voyager.gemini-chat-line-height',
      'voyager.gemini-chat-width',
    ]) {
      expect(ownedFeatureByPluginId(id)?.handlers).toEqual([]);
      expect(tracksPluginHealth(id)).toBe(false);
    }
  });

  it('owns feature-specific runtimes without opening their primitives to local plugins', () => {
    for (const [feature, id] of [
      ['promptHistory', 'voyager.gemini-prompt-history'],
      ['inputCollapse', 'voyager.gemini-input-collapse'],
      ['markdownFix', 'voyager.gemini-markdown-fix'],
      ['messageTimestamps', 'voyager.gemini-message-timestamps'],
      ['deepResearchExport', 'voyager.gemini-deep-research-export'],
      ['conversationExport', 'voyager.gemini-export'],
    ] as const) {
      expect(isPackagedOfficialPluginId(id)).toBe(true);
      expect(ownedFeatureByPluginId(id)).toMatchObject({ site: 'gemini', feature, handlers: [] });
      expect(tracksPluginHealth(id)).toBe(false);
    }
  });

  it.each(['gemini', 'aistudio'])(
    'keeps %s batch deletion private to its packaged runtime',
    (site) => {
      const id = `voyager.${site}-batch-delete`;
      expect(isPackagedOfficialPluginId(id)).toBe(true);
      expect(ownedFeatureByPluginId(id)).toMatchObject({
        site,
        feature: 'batchDelete',
        handlers: [],
        healthTracking: false,
      });
    },
  );

  it('owns AI Studio sidebar layout independently without opening a public primitive', () => {
    const id = 'voyager.aistudio-sidebar-width';
    expect(isPackagedOfficialPluginId(id)).toBe(true);
    expect(ownedFeatureByPluginId(id)).toMatchObject({
      site: 'aistudio',
      feature: 'aistudioSidebarWidth',
      handlers: [],
      healthTracking: false,
    });
  });

  it('exempts only the listed official plugins from the health monitor', () => {
    expect(tracksPluginHealth('voyager.gemini-vim-input')).toBe(false);
    expect(tracksPluginHealth('voyager.chatgpt-folders')).toBe(true);
    expect(tracksPluginHealth('local.my-plugin')).toBe(true);
  });
});

describe('pluginOwnedHandlers', () => {
  it('opens the handlers of owned features on their own site only', () => {
    const owners = [
      entry({}),
      entry({ site: 'aistudio', officialPluginId: 'voyager.aistudio-formula-copy', handlers: [] }),
    ];
    expect(pluginOwnedHandlers('gemini', owners)).toEqual(new Set(['formulaCopy']));
    expect(pluginOwnedHandlers('aistudio', owners)).toEqual(new Set());
  });
});
