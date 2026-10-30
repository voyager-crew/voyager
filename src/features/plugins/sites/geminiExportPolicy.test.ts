import { describe, expect, it } from 'vitest';

import { GEMINI_EXPORT_MANIFEST } from '../builtin/geminiExportManifest';
import { validateLocalManifest } from '../local/validateLocalManifest';
import type { PluginManifest } from '../types';
import { OFFICIAL_PLUGIN_IDS, ownedFeatureByPluginId } from './featureOwners';
import { allowsNativeHandler, hostPolicyRefusal, manifestHostPolicyIssues } from './hostPolicy';

// Exercise the permission independently of whether the builtin has migrated yet.
const exporter: PluginManifest = {
  ...GEMINI_EXPORT_MANIFEST,
  engine: '>=1.10.0',
  contributes: { domOps: [{ op: 'native', handler: 'conversationExport', params: {} }] },
};
const refused = { kind: 'native-op', handlers: ['conversationExport'] };

describe('Gemini official-only conversation export', () => {
  it('admits only the official export id without opening the public handler', () => {
    expect(hostPolicyRefusal('https://gemini.google.com/u/2/app/chat', exporter)).toBeNull();
    for (const id of ['local.gemini-export', OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport]) {
      expect(
        hostPolicyRefusal('https://gemini.google.com/u/2/app/chat', { ...exporter, id }),
      ).toEqual(refused);
    }
    expect(hostPolicyRefusal('https://aistudio.google.com/prompts/chat', exporter)).toEqual(
      refused,
    );
    expect(allowsNativeHandler('gemini', 'conversationExport')).toBe(false);
    expect(ownedFeatureByPluginId(OFFICIAL_PLUGIN_IDS.geminiExport)?.handlers).toEqual([]);
  });

  it('refuses a local import even when it copies the official manifest id', () => {
    const imported = validateLocalManifest(exporter);
    expect(imported.success).toBe(false);
    if (imported.success) throw new Error('Local Gemini export unexpectedly imported');
    expect(imported.error).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'contributes.domOps[0]' })]),
    );
    // A stored import stays listed, but its namespaced id never gains official permission.
    const stored = validateLocalManifest(exporter, undefined, { hostPolicy: 'defer' });
    expect(stored.success).toBe(true);
    if (!stored.success) throw new Error('Stored fixture failed non-policy validation');
    expect(hostPolicyRefusal('https://gemini.google.com/app/chat', stored.data.manifest)).toEqual(
      refused,
    );
    expect(manifestHostPolicyIssues(stored.data.manifest)).not.toEqual([]);
  });
});
