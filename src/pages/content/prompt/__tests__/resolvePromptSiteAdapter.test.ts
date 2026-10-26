// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { SiteAdapter } from '@/features/plugins/types';

import { startScheme } from '../../platformTheme/scheme';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.removeAttribute('data-gv-scheme');
  vi.restoreAllMocks();
});

describe('prompt site theme', () => {
  it('does not open a light prompt panel on a dark derived site', () => {
    const kimi: SiteAdapter = {
      id: 'kimi',
      label: 'Kimi',
      matches: ['https://www.kimi.com/*'],
      selectors: {},
      theme: {
        hostSelector: 'body',
        lightSelector: 'body.kimi-light',
        darkSelector: 'body.kimi-dark',
      },
      capabilities: new Set(['chat', 'darkMode']),
    };
    const registry = SiteRegistry.createDefault();
    registry.register(kimi);
    vi.spyOn(SiteRegistry, 'createDefault').mockReturnValue(registry);
    document.body.className = 'kimi-dark';
    const bridge = startScheme(kimi.theme);
    try {
      const prompt = resolvePromptSiteAdapter('https://www.kimi.com/chat/private-id');
      expect(prompt.scheme()).toBe('dark');
    } finally {
      bridge.stop();
    }
  });
});

describe('prompt insert', () => {
  it('unfolds a Gemini composer that input collapse folded, then inserts', () => {
    document.body.innerHTML =
      '<div class="gv-input-collapsed" style="background-color: rgb(255, 255, 255)">' +
      '<rich-textarea><div contenteditable="true"></div></rich-textarea></div>';
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    // jsdom lays nothing out; the composer lookup only takes a visible input.
    editor.getBoundingClientRect = () => new DOMRect(0, 600, 600, 48);

    expect(resolvePromptSiteAdapter('https://gemini.google.com/app').insert('Summarize')).toBe(
      true,
    );

    expect(document.querySelector('.gv-input-collapsed')).toBeNull();
    expect(editor.textContent).toContain('Summarize');
  });

  it('reports no composer so the caller can copy instead', () => {
    expect(resolvePromptSiteAdapter('https://chat.deepseek.com/').insert('Summarize')).toBe(false);
  });
});
