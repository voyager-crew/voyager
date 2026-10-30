import { describe, expect, it } from 'vitest';

import { GEMINI_EXPORT_MANIFEST } from '../builtin/geminiExportManifest';
import { validateLocalManifest } from '../local/validateLocalManifest';
import { OFFICIAL_PLUGIN_IDS, ownedFeatureByPluginId } from './featureOwners';
import { allowsNativeHandler, hostPolicyRefusal, manifestHostPolicyIssues } from './hostPolicy';

const refused = { kind: 'native-op', handlers: ['conversationExport'] };

describe('Gemini official-only conversation export', () => {
  it('admits only the official export id without opening the public handler', () => {
    expect(
      hostPolicyRefusal('https://gemini.google.com/u/2/app/chat', GEMINI_EXPORT_MANIFEST),
    ).toBeNull();
    for (const id of ['local.gemini-export', OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport]) {
      expect(
        hostPolicyRefusal('https://gemini.google.com/u/2/app/chat', {
          ...GEMINI_EXPORT_MANIFEST,
          id,
        }),
      ).toEqual(refused);
    }
    expect(
      hostPolicyRefusal('https://aistudio.google.com/prompts/chat', GEMINI_EXPORT_MANIFEST),
    ).toEqual(refused);
    expect(allowsNativeHandler('gemini', 'conversationExport')).toBe(false);
    expect(ownedFeatureByPluginId(OFFICIAL_PLUGIN_IDS.geminiExport)?.handlers).toEqual([]);
  });

  it('refuses a local import even when it copies the official manifest id', () => {
    const imported = validateLocalManifest(GEMINI_EXPORT_MANIFEST);
    expect(imported.success).toBe(false);
    if (imported.success) throw new Error('Local Gemini export unexpectedly imported');
    expect(imported.error).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'contributes.domOps[0]' })]),
    );
    // A stored import stays listed, but its namespaced id never gains official permission.
    const stored = validateLocalManifest(GEMINI_EXPORT_MANIFEST, undefined, {
      hostPolicy: 'defer',
    });
    expect(stored.success).toBe(true);
    if (!stored.success) throw new Error('Stored fixture failed non-policy validation');
    expect(hostPolicyRefusal('https://gemini.google.com/app/chat', stored.data.manifest)).toEqual(
      refused,
    );
    expect(manifestHostPolicyIssues(stored.data.manifest)).not.toEqual([]);
  });
});
