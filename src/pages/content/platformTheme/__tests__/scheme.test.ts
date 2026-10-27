import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { SiteThemeDescriptor } from '@/features/plugins/types';

import {
  SCHEME_ATTR,
  ensureScheme,
  getScheme,
  getSchemeBridge,
  resolveScheme,
  startScheme,
  stopScheme,
  subscribeScheme,
} from '../scheme';

/** Let the MutationObserver microtask run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const GEMINI: SiteThemeDescriptor = {
  hostSelector: '.theme-host',
  lightSelector: '.theme-host.light-theme',
  darkSelector: '.theme-host.dark-theme',
};

afterEach(() => {
  stopScheme();
  document.documentElement.removeAttribute(SCHEME_ATTR);
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
  document.body.className = '';
  document.body.replaceChildren();
});

describe('resolveScheme', () => {
  it('reads each shipped class-dialect adapter its own way, DeepSeek included', () => {
    const registry = SiteRegistry.createDefault();
    const cases: Array<[string, string]> = [['https://chat.deepseek.com/a/chat/s/1', 'dark']];

    for (const [url, expected] of cases) {
      const theme = registry.resolveByUrl(url)?.theme;
      expect(theme, `${url} declares no theme`).toBeDefined();
      // Put the site into ITS OWN dark state, whatever dialect that is.
      const target = theme!.darkSelector.startsWith('body')
        ? document.body
        : document.documentElement;
      target.className = theme!.darkSelector.replace(/^(body|html|:root)\./, '');
      expect(resolveScheme(theme, document), url).toBe(expected);
      target.className = '';
    }
  });

  it('reads ChatGPT from the data-theme attribute on <html>', () => {
    const chatgpt = SiteRegistry.createDefault().resolveByUrl('https://chatgpt.com/c/1')?.theme;
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(resolveScheme(chatgpt, document)).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(resolveScheme(chatgpt, document)).toBe('light');
  });

  it('lets an explicit light marker win over a lingering dark one', () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.className = 'theme-host light-theme dark-theme';
    document.body.appendChild(host);
    expect(resolveScheme(GEMINI, document)).toBe('light');
  });

  it('falls back to the OS when no descriptor matches — custom sites have no adapter', () => {
    expect(resolveScheme(null, document)).toBe('light');
    vi.mocked(window.matchMedia).mockReturnValueOnce({
      matches: true,
    } as unknown as MediaQueryList);
    expect(resolveScheme(null, document)).toBe('dark');
  });

  it('treats an unparseable selector as no match instead of throwing', () => {
    const broken = { hostSelector: 'body', lightSelector: ':::', darkSelector: ':::' };
    expect(() => resolveScheme(broken, document)).not.toThrow();
    expect(resolveScheme(broken, document)).toBe('light');
  });
});

describe('startScheme', () => {
  it('stamps the root and follows a host class flip', async () => {
    const deepseek = SiteRegistry.createDefault().resolveByUrl('https://chat.deepseek.com/')?.theme;
    const bridge = startScheme(deepseek ?? null, document);

    expect(getScheme()).toBe('light');

    document.body.className = 'dark';
    await settle();
    expect(document.documentElement.getAttribute(SCHEME_ATTR)).toBe('dark');
    expect(getScheme()).toBe('dark');

    document.body.className = 'light';
    await settle();
    expect(getScheme()).toBe('light');

    bridge.stop();
  });

  it('follows a ChatGPT data-theme flip on <html>', async () => {
    const chatgpt = SiteRegistry.createDefault().resolveByUrl('https://chatgpt.com/')?.theme;
    document.documentElement.setAttribute('data-theme', 'light');
    const bridge = startScheme(chatgpt ?? null, document);
    expect(getScheme()).toBe('light');

    document.documentElement.setAttribute('data-theme', 'dark');
    await settle();
    expect(getScheme()).toBe('dark');

    bridge.stop();
  });

  it('notifies subscribers once per change, not per mutation', async () => {
    const seen: string[] = [];
    const un = subscribeScheme((s) => seen.push(s));
    const bridge = startScheme(GEMINI, document);

    const host = document.createElement('div');
    host.className = 'theme-host dark-theme';
    document.body.appendChild(host);
    await settle();

    // A mutation that does not change the resolved scheme must stay silent.
    host.setAttribute('data-theme', 'dark');
    await settle();

    expect(seen).toEqual(['dark']);
    un();
    bridge.stop();
  });

  it('re-points at a corrected descriptor without restarting', async () => {
    document.body.className = 'dark';
    const bridge = startScheme(null, document);
    expect(getScheme()).toBe('light'); // no descriptor yet → OS

    bridge.setTheme({
      hostSelector: 'body',
      lightSelector: 'body.light',
      darkSelector: 'body.dark',
    });
    expect(getScheme()).toBe('dark');

    bridge.stop();
  });

  it('stops observing and clears the attribute on teardown', async () => {
    const bridge = startScheme(GEMINI, document);
    const host = document.createElement('div');
    host.className = 'theme-host dark-theme';
    document.body.appendChild(host);
    await settle();
    expect(getScheme()).toBe('dark');

    bridge.stop();
    expect(document.documentElement.hasAttribute(SCHEME_ATTR)).toBe(false);

    host.className = 'theme-host light-theme';
    await settle();
    expect(document.documentElement.hasAttribute(SCHEME_ATTR)).toBe(false);
  });
});

describe('the page-lifetime bridge', () => {
  it('starts once and hands the same bridge back', () => {
    const first = ensureScheme(GEMINI, document);
    const second = ensureScheme(GEMINI, document);

    expect(second).toBe(first);
    expect(getSchemeBridge()).toBe(first);
  });

  it('is absent until something starts it, so a feature cannot create one by accident', () => {
    expect(getSchemeBridge()).toBeNull();
    // This is what startBrandTheme does: correct the descriptor if a bridge is
    // running, never mount one. A popup toggle must not own the page's theme.
    getSchemeBridge()?.setTheme(GEMINI);
    expect(document.documentElement.hasAttribute(SCHEME_ATTR)).toBe(false);
  });

  it('clears the attribute on stop and can be started again', () => {
    ensureScheme(GEMINI, document);
    expect(document.documentElement.hasAttribute(SCHEME_ATTR)).toBe(true);

    stopScheme();
    expect(document.documentElement.hasAttribute(SCHEME_ATTR)).toBe(false);
    expect(getSchemeBridge()).toBeNull();

    ensureScheme(GEMINI, document);
    expect(document.documentElement.hasAttribute(SCHEME_ATTR)).toBe(true);
  });
});

describe('a host element that appears, is replaced, or goes away', () => {
  const mountHost = (className: string): HTMLElement => {
    const host = document.createElement('div');
    host.className = className;
    document.body.appendChild(host);
    return host;
  };

  it('follows a replacement instead of holding the detached element', async () => {
    const bridge = startScheme(GEMINI, document);

    const first = mountHost('theme-host dark-theme');
    await settle();
    expect(getScheme()).toBe('dark');

    // Angular swaps the whole element rather than toggling its class.
    first.remove();
    const second = mountHost('theme-host light-theme');
    await settle();
    expect(getScheme()).toBe('light');

    // The new host drives the scheme; the detached one must not.
    first.className = 'theme-host dark-theme';
    await settle();
    expect(getScheme()).toBe('light');

    second.className = 'theme-host dark-theme';
    await settle();
    expect(getScheme()).toBe('dark');

    bridge.stop();
  });

  it('keeps Voyager UI dark on Claude dark mode, which Claude marks with data-mode', async () => {
    const claude = SiteRegistry.createDefault().resolveByUrl('https://claude.ai/chat/1')?.theme;
    document.documentElement.setAttribute('data-mode', 'light');
    const bridge = startScheme(claude ?? null, document);
    expect(getScheme()).toBe('light');

    document.documentElement.setAttribute('data-mode', 'dark');
    await settle();
    expect(getScheme()).toBe('dark');

    document.documentElement.setAttribute('data-mode', 'light');
    await settle();
    expect(getScheme()).toBe('light');

    bridge.stop();
  });

  it('follows the OS on Claude when its appearance is set to match the system', async () => {
    const claude = SiteRegistry.createDefault().resolveByUrl('https://claude.ai/chat/1')?.theme;
    document.documentElement.setAttribute('data-mode', 'system');
    vi.mocked(window.matchMedia).mockReturnValueOnce({
      matches: true,
    } as unknown as MediaQueryList);

    expect(resolveScheme(claude, document)).toBe('dark');
  });

  it('hears toggles of an attribute only a corrected descriptor names', async () => {
    document.documentElement.setAttribute('data-mode', 'light');
    const bridge = startScheme(
      { hostSelector: ':root', lightSelector: ':root:not(.dark)', darkSelector: ':root.dark' },
      document,
    );
    bridge.setTheme({
      hostSelector: ':root',
      lightSelector: ':root:not([data-mode="dark"])',
      darkSelector: ':root[data-mode="dark"]',
    });
    expect(getScheme()).toBe('light');

    document.documentElement.setAttribute('data-mode', 'dark');
    await settle();
    expect(getScheme()).toBe('dark');

    bridge.stop();
  });
});
