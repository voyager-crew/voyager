// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors/service';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { SiteAdapter } from '@/features/plugins/types';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { startScheme } from '../../platformTheme/scheme';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

const pages = [
  ['https://gemini.google.com/app', true, 'gemini', 'dark', 'light', true],
  ['https://business.gemini.google/', true, 'gemini', 'dark', 'light', true],
  ['https://aistudio.google.com/prompts/new_chat', false, 'aistudio', 'light', 'dark', true],
  ['https://aistudio.google.cn/prompts/new_chat', false, 'aistudio', 'light', 'dark', true],
  ['https://chatgpt.com/', false, 'gemini', 'light', 'dark', false],
  ['https://claude.ai/new', false, 'gemini', 'light', 'dark', false],
  ['https://chat.deepseek.com/', false, 'gemini', 'light', 'dark', false],
  ['https://www.kimi.com/', false, 'gemini', 'light', 'dark', false],
  ['https://custom.example/', false, 'gemini', 'dark', 'light', true],
] as const;

const stops: Array<() => void> = [];

function materialFab(): HTMLElement {
  const fab = document.createElement('span');
  fab.className = 'mat-mdc-button-touch-target';
  fab.getBoundingClientRect = () => new DOMRect(900, 700, 40, 40);
  document.body.append(fab);
  return fab;
}

afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.removeAttribute('data-gv-scheme');
  resetPageUrl();
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
  it.each(['https://gemini.google.com/app', 'https://business.gemini.google/'])(
    'unfolds a composer that input collapse folded on %s, then inserts',
    (url) => {
      setPageUrl(url);
      document.body.innerHTML =
        '<div class="gv-input-collapsed" style="background-color: rgb(255, 255, 255)">' +
        '<rich-textarea><div contenteditable="true"></div></rich-textarea></div>';
      const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      // jsdom lays nothing out; the composer lookup only takes a visible input.
      editor.getBoundingClientRect = () => new DOMRect(0, 600, 600, 48);

      expect(resolvePromptSiteAdapter(url).insert('Summarize')).toBe(true);

      expect(document.querySelector('.gv-input-collapsed')).toBeNull();
      expect(editor.textContent).toContain('Summarize');
    },
  );

  it('reports no composer so the caller can copy instead', () => {
    expect(resolvePromptSiteAdapter('https://chat.deepseek.com/').insert('Summarize')).toBe(false);
  });
});

describe('Prompt Manager site behavior before mounting', () => {
  it('keeps custom aistudio-prefix websites in the generic saved-highlight scope', () => {
    const url = 'https://aistudio.example.com/';
    setPageUrl(url);
    const prompt = resolvePromptSiteAdapter(url);
    document.body.className = 'dark-theme';
    document.documentElement.setAttribute('data-gv-scheme', 'light');
    expect(prompt.slash).toBe(false);
    expect(prompt.highlightPlatform).toBe('gemini');
    expect(prompt.scheme()).toBe('dark');
    materialFab();
    expect(prompt.defaultTriggerSpot(36)).toEqual({ right: 134, bottom: 30 });
  });

  it.each(pages)(
    '%s keeps slash, saved-highlight scope and its theme source',
    (url, slash, highlightPlatform, markerDark, markerLight) => {
      setPageUrl(url);
      const prompt = resolvePromptSiteAdapter(url);
      expect(prompt.slash).toBe(slash);
      expect(prompt.highlightPlatform).toBe(highlightPlatform);

      document.body.className = 'dark-theme';
      document.documentElement.setAttribute('data-gv-scheme', 'light');
      expect(prompt.scheme()).toBe(markerDark);
      document.body.className = 'light-theme';
      document.documentElement.setAttribute('data-gv-scheme', 'dark');
      expect(prompt.scheme()).toBe(markerLight);
    },
  );

  it.each(pages)(
    '%s uses the Material FAB only where the bundled behavior admits it',
    (url, _slash, _highlight, _dark, _light, besideFab) => {
      setPageUrl(url);
      const prompt = resolvePromptSiteAdapter(url);
      expect(prompt.defaultTriggerSpot(36)).toBeNull();
      const fab = materialFab();
      expect(prompt.defaultTriggerSpot(36)).toEqual(besideFab ? { right: 134, bottom: 30 } : null);
      fab.remove();
      expect(prompt.defaultTriggerSpot(36)).toBeNull();
    },
  );

  it.each([
    ['gemini', 'https://gemini.google.com/app'],
    ['gemini', 'https://business.gemini.google/'],
    ['aistudio', 'https://aistudio.google.com/prompts/new_chat'],
    ['aistudio', 'https://aistudio.google.cn/prompts/new_chat'],
    ['chatgpt', 'https://chatgpt.com/'],
    ['claude', 'https://claude.ai/new'],
    ['deepseek', 'https://chat.deepseek.com/'],
    ['kimi', 'https://www.kimi.com/'],
  ])(
    '%s on %s can sit beside a published FAB and falls back when it disappears',
    async (id, url) => {
      setPageUrl(url);
      const prompt = resolvePromptSiteAdapter(url);
      const run = initializeSiteSelectors(id, {
        host: location.hostname,
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => ({
          id,
          catalogRevision: 1,
          locators: { 'input.fab': ['#published-fab'] },
        }),
      });
      stops.push(run.stop);
      await run.ready;
      expect(prompt.defaultTriggerSpot(36)).toBeNull();
      const fab = materialFab();
      fab.className = '';
      fab.id = 'published-fab';
      expect(prompt.defaultTriggerSpot(36)).toEqual({ right: 134, bottom: 30 });
      fab.remove();
      expect(prompt.defaultTriggerSpot(36)).toBeNull();
    },
  );
});
