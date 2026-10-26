// @vitest-environment jsdom
import type { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { DeclarativeEngine } from '@/features/plugins/runtime/declarativeEngine';
import type { PluginManifest } from '@/features/plugins/types';

import { withGuardedPageAdapter } from '../semanticSnapshot';
import { initializeSiteSelectors, type SiteSelectorLifetime } from '../service';

declare const jsdom: JSDOM;
let engine: DeclarativeEngine | undefined;
let lifetime: SiteSelectorLifetime | undefined;
afterEach(() => {
  engine?.unmountAll();
  lifetime?.stop();
  document.body.replaceChildren();
});

const sites = [
  ['chatgpt', 'chatgpt.com', '<aside id="native" class="bundled" aria-label="History"></aside>'],
  ['claude', 'claude.ai', '<aside id="native" class="bundled" data-testid="sidebar"></aside>'],
  [
    'deepseek',
    'chat.deepseek.com',
    '<div id="native" class="bundled"><div class="ds-scroll-area"><a href="/a/chat/s/one">One</a></div></div>',
  ],
  ['kimi', 'www.kimi.com', '<aside id="native" class="next-sidebar bundled"></aside>'],
] as const;

function fixture(site: string, host: string, native: string, extra = ''): void {
  jsdom.reconfigure({ url: `https://${host}/` });
  document.body.innerHTML = native + extra;
  if (site === 'chatgpt') document.getElementById('native')!.id = 'stage-slideover-sidebar';
}

async function online(site: string, host: string, selector: string): Promise<void> {
  lifetime = initializeSiteSelectors(site, {
    host,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: site, catalogRevision: 1, selectors: { sidebar: selector } }),
  });
  await lifetime.ready;
}

function decorate(site: string): Element[] {
  const adapter = requireBundledSiteAdapter(site);
  const manifest: PluginManifest = {
    id: 'local.sidebar-decoration',
    name: 'Sidebar decoration',
    version: '1.0.0',
    description: 'Sidebar decoration',
    author: 'Voyager',
    category: 'other',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: adapter.matches,
    contributes: {
      styles: [{ css: '.gv-sidebar-decoration::before { content: "Voyager"; }' }],
      domOps: [
        {
          op: 'addClass',
          target: { kind: 'semantic', key: 'sidebar' },
          className: 'gv-sidebar-decoration',
        },
      ],
    },
  };
  engine = new DeclarativeEngine({
    doc: document,
    adapter: withGuardedPageAdapter(adapter, document),
  });
  engine.mount(manifest);
  return Array.from(document.querySelectorAll('.gv-sidebar-decoration'));
}

describe.each(sites)('%s sidebar placement', (site, host, native) => {
  it.each([
    ['remote location', '<section id="remote"></section>', '#remote', '#remote'],
    ['no matching location', '<section id="remote"></section>', '.missing', '.bundled'],
    [
      'editable descendant',
      '<div contenteditable="true"><span id="remote"></span></div>',
      '#remote',
      '.bundled',
    ],
    ['input control', '<input id="remote">', '#remote', '.bundled'],
    ['textarea control', '<textarea id="remote"></textarea>', '#remote', '.bundled'],
    ['select control', '<select id="remote"></select>', '#remote', '.bundled'],
  ] as const)(
    'places the actual plugin decoration with %s',
    async (_name, extra, selector, target) => {
      fixture(site, host, native, extra);
      await online(site, host, selector);
      expect(decorate(site)).toEqual([document.querySelector(target)]);
    },
  );

  it('decorates the same native sidebar through bundled and remote data', async () => {
    fixture(site, host, native);
    const before = decorate(site);
    expect(before).toEqual([document.querySelector('.bundled')]);
    engine!.unmountAll();
    await online(site, host, '.bundled');
    expect(decorate(site)).toEqual(before);
  });
});
