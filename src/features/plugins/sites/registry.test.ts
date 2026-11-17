import { describe, expect, it } from 'vitest';

import { BUNDLED_SITE_ADAPTERS } from '../catalog/sites';
import {
  DEFAULT_ADAPTERS,
  NATIVE_SITE_IDS,
  SiteRegistry,
  resolvePluginPlatformId,
} from './registry';

describe('DEFAULT_ADAPTERS', () => {
  // The registry dedupes by id, so only the array itself shows a doubled or reordered site,
  // which the CLI help, the authoring docs and the public SKILL.md would print.
  it('lists Gemini and AI Studio first, then every other bundled site once in directory order', () => {
    const ids = DEFAULT_ADAPTERS.map((adapter) => adapter.id);
    expect(ids.slice(0, 2)).toEqual(['gemini', 'aistudio']);
    expect(new Set(ids).size).toBe(ids.length);
    const rest = BUNDLED_SITE_ADAPTERS.map((adapter) => adapter.id).filter(
      (id) => id !== 'gemini' && id !== 'aistudio',
    );
    expect(ids.slice(2)).toEqual(rest);
    expect([...rest].sort()).toEqual(rest);
    expect(rest).toEqual(expect.arrayContaining(['chatgpt', 'claude', 'deepseek']));
  });
});

describe('SiteRegistry.resolveByUrl', () => {
  const registry = SiteRegistry.createDefault();

  it('resolves the first-party adapters by URL', () => {
    expect(registry.resolveByUrl('https://gemini.google.com/app')?.id).toBe('gemini');
    expect(registry.resolveByUrl('https://aistudio.google.com/')?.id).toBe('aistudio');
    expect(registry.resolveByUrl('https://chatgpt.com/c/abc')?.id).toBe('chatgpt');
    expect(registry.resolveByUrl('https://chat.openai.com/c/abc')?.id).toBe('chatgpt');
    expect(registry.resolveByUrl('https://claude.ai/chat/abc')?.id).toBe('claude');
    expect(
      registry.resolveByUrl('https://artifact-id.frame.claudeusercontent.com/_f/version/')?.id,
    ).toBe('claude');
    expect(registry.resolveByUrl('https://chat.deepseek.com/a/chat/s/abc')?.id).toBe('deepseek');
    expect(registry.resolveByUrl('https://grok.com/')?.id).toBe('grok');
    expect(
      registry.resolveByUrl('https://grok.com/c/01234567-89ab-cdef-0123-456789abcdef')?.id,
    ).toBe('grok');
  });

  it('returns null for sites with no adapter', () => {
    expect(registry.resolveByUrl('https://example.com/')).toBeNull();
  });
});

describe('resolvePluginPlatformId', () => {
  it('returns the platform id for third-party plugin platforms', () => {
    expect(resolvePluginPlatformId('https://chatgpt.com/c/abc')).toBe('chatgpt');
    expect(resolvePluginPlatformId('https://chat.openai.com/')).toBe('chatgpt');
    expect(resolvePluginPlatformId('https://claude.ai/chat/abc')).toBe('claude');
    expect(
      resolvePluginPlatformId('https://artifact-id.frame.claudeusercontent.com/_f/version/'),
    ).toBe('claude');
    expect(resolvePluginPlatformId('https://chat.deepseek.com/a/chat/s/abc')).toBe('deepseek');
    expect(resolvePluginPlatformId('https://grok.com/')).toBe('grok');
  });

  it('returns null for native Voyager sites (full feature set runs there)', () => {
    expect(resolvePluginPlatformId('https://gemini.google.com/app')).toBeNull();
    expect(resolvePluginPlatformId('https://aistudio.google.com/')).toBeNull();
    expect(resolvePluginPlatformId('https://business.gemini.google/')).toBeNull();
    expect(resolvePluginPlatformId('https://aistudio.google.cn/')).toBeNull();
    for (const id of NATIVE_SITE_IDS) {
      expect(['gemini', 'aistudio']).toContain(id);
    }
  });

  it('returns null for sites Voyager ships no adapter for', () => {
    expect(resolvePluginPlatformId('https://example.com/')).toBeNull();
    expect(resolvePluginPlatformId('https://deepseek.com/')).toBeNull();
    expect(resolvePluginPlatformId('https://www.grok.com/')).toBeNull();
  });
});

describe('Grok URL boundaries', () => {
  it.each([
    'https://grok.com/',
    'https://grok.com/c/01234567-89ab-cdef-0123-456789abcdef?x=1#last',
  ])('resolves %s as a plugin-only platform', (url) => {
    expect(resolvePluginPlatformId(url)).toBe('grok');
  });

  it.each([
    'https://grok.com.example.org/',
    'http://grok.com/',
    'https://www.grok.com/',
    'https://x.com/i/grok',
    'https://grok.x.ai/',
  ])('does not grant platform support to %s', (url) => {
    expect(SiteRegistry.createDefault().resolveByUrl(url)).toBeNull();
  });
});

describe('DeepSeek URL boundaries', () => {
  it.each(['https://chat.deepseek.com/', 'https://chat.deepseek.com/a/chat/s/example?x=1#last'])(
    'resolves %s as a plugin-only platform',
    (url) => expect(resolvePluginPlatformId(url)).toBe('deepseek'),
  );
  it.each([
    'https://deepseek.com/',
    'https://api.deepseek.com/',
    'https://chat.deepseek.com.example.org/',
    'http://chat.deepseek.com/',
  ])('does not grant platform support to %s', (url) => {
    expect(SiteRegistry.createDefault().resolveByUrl(url)).toBeNull();
  });
});
