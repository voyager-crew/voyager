import { describe, expect, it, vi } from 'vitest';

import { BUILTIN_PLUGINS } from '@/features/plugins/builtin';
import type { PluginManifest } from '@/features/plugins/types';

import { turnOnInstalled } from '../installReviewed';

// What Firefox gives the panel's moz-extension:// frame: no permissions API (#1118).
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } },
}));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'firefox',
  isFirefox: () => true,
  browserSupportsDynamicContentScriptRegistration: () => true,
  supportsDynamicContentScriptRegistration: () => false,
}));

function artifactsCreation(): PluginManifest {
  const base = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.claude-timeline');
  if (!base) throw new Error('Claude timeline missing');
  return {
    ...base,
    id: 'local.me.artifacts',
    matches: ['https://claude.ai/*', 'https://*.frame.claudeusercontent.com/*'],
  };
}

describe("turning on a reviewed creation from Firefox's in-page panel", () => {
  it("hands a Claude artifact frame's grant to the popup", async () => {
    const creation = artifactsCreation();
    const askElsewhere = vi.fn();

    expect(await turnOnInstalled(creation, 'https://claude.ai/chat/1', askElsewhere)).toBe(false);
    expect(askElsewhere).toHaveBeenCalledExactlyOnceWith(creation);
  });
});
