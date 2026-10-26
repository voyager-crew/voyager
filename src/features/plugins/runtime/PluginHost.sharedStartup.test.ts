import { afterEach, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { LegacySettingSnapshot } from '../storage/legacySettingBindings';
import type { SiteAdapter } from '../types';
import { PluginHost } from './PluginHost';
import { createOfficialAdmission } from './officialAdmission';

afterEach(() => document.body.classList.remove('gv-startup-choice'));

it('a switch changed during the shared adapter read wins over its stale initial settings', async () => {
  const admission = createOfficialAdmission();
  admission.admit('gemini', 'formulaCopy');
  let resolveAdapter: (adapter: SiteAdapter) => void = () => {};
  let resolveSettings: (settings: LegacySettingSnapshot) => void = () => {};
  let change: (settings: LegacySettingSnapshot) => void = () => {};
  const loaded = new Promise<LegacySettingSnapshot>((resolve) => {
    resolveSettings = resolve;
  });
  const host = new PluginHost({
    url: 'https://gemini.google.com/app/test',
    admission,
    initialAdapter: new Promise((resolve) => {
      resolveAdapter = resolve;
    }),
    legacySettings: {
      load: () => loaded,
      subscribe: (listener) => {
        change = listener;
        return () => {};
      },
    },
    sources: [
      {
        id: 'fixture',
        list: async () => [
          {
            id: OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
            name: 'Fixture',
            description: 'Fixture',
            author: 'Voyager',
            category: 'other',
            license: 'MIT',
            version: '1.0.0',
            engine: '>=1.0.0',
            tier: 'declarative',
            matches: ['https://gemini.google.com/*'],
            contributes: {
              domOps: [
                {
                  op: 'addClass',
                  target: { kind: 'css', selector: 'body' },
                  className: 'gv-startup-choice',
                },
              ],
            },
          },
        ],
      },
    ],
    requestCatalogRefresh: () => {},
    formFactor: async () => 'desktop',
  });
  try {
    const starting = host.start();
    change({ [StorageKeys.FORMULA_COPY_ENABLED]: true });
    resolveSettings({ [StorageKeys.FORMULA_COPY_ENABLED]: false });
    resolveAdapter(requireBundledSiteAdapter('gemini'));
    await starting;
    expect(document.body.classList.contains('gv-startup-choice')).toBe(true);
  } finally {
    host.stop();
  }
});
