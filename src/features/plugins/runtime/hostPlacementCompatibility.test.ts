import type { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { pageSemanticSelector } from '@/core/selectors/semanticSnapshot';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';

import { PLUGIN_HIDDEN_CLASS } from '../constants';
import { semanticRef, type PluginManifest } from '../types';
import { DeclarativeEngine } from './declarativeEngine';
import { createHostEngine } from './hostEngine';
import { ReleaseLedger } from './releaseLedger';

declare const jsdom: JSDOM;
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.replaceChildren();
});

it.each([
  ['claude', 'claude.ai', 'sidebar'],
  ['kimi', 'www.kimi.com', 'sidebar'],
  ['chatgpt', 'chatgpt.com', 'sidebar'],
  ['deepseek', 'chat.deepseek.com', 'sidebar'],
  ['chatgpt', 'chatgpt.com', 'headerActions'],
])('%s %s %s keeps baseline declarative targets inside host controls', async (site, host, key) => {
  jsdom.reconfigure({ url: `https://${host}/` });
  document.body.innerHTML =
    '<a href="/another-chat"><span class="catalog-target">Link</span></a><div role="button"><span class="catalog-target">Action</span></div><pre><code class="catalog-target">source</code></pre>';
  const adapter = {
    ...requireBundledSiteAdapter(site),
    selectors: { ...requireBundledSiteAdapter(site).selectors, [key]: '.catalog-target' },
  };
  const run = initializeSiteSelectors(site, {
    host,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: site, catalogRevision: 1, selectors: adapter.selectors }),
  });
  cleanup.push(run.stop);
  await run.ready;
  const plugin: PluginManifest = {
    id: 'test.placement-compatibility',
    name: 'Placement compatibility',
    version: '1.0.0',
    description: 'Test existing catalog semantic overrides',
    author: 'test',
    category: 'other',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: [`https://${host}/*`],
    contributes: {
      domOps: [
        { op: 'hide', target: semanticRef(key) },
        {
          op: 'setAttribute',
          target: semanticRef(key),
          name: 'data-catalog-applied',
          value: 'yes',
        },
        { op: 'setStyle', target: semanticRef(key), styles: { color: 'red' } },
      ],
    },
  };
  const read = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.catalog-target')).map((node) => ({
      node,
      hidden: node.classList.contains(PLUGIN_HIDDEN_CLASS),
      attribute: node.getAttribute('data-catalog-applied'),
      color: node.style.color,
    }));
  // At 6fa19b4ae the engine received the resolved adapter directly, without placement admission.
  const baseline = new DeclarativeEngine({ doc: document, adapter });
  cleanup.push(() => baseline.unmountAll());
  baseline.mount(plugin);
  const original = read();
  expect(
    original.every(
      (result) => result.hidden && result.attribute === 'yes' && result.color === 'red',
    ),
  ).toBe(true);
  expect(original).toHaveLength(3);
  baseline.unmountAll();
  const current = createHostEngine({
    doc: document,
    adapter,
    inspectPlugins: () => ({ statuses: [], manifests: [] }),
    releases: new ReleaseLedger(),
  });
  cleanup.push(() => current.unmountAll());
  current.mount(plugin);
  expect(read()).toEqual(original);
  // The same remote key remains unavailable as a native UI mount until it matches a safe location.
  expect(pageSemanticSelector(adapter, key, document)).not.toBe('.catalog-target');
  current.unmountAll();
  const safe = document.createElement('section');
  safe.className = 'catalog-safe';
  document.body.append(safe);
  adapter.selectors[key] = '.catalog-safe';
  const updated = createHostEngine({
    doc: document,
    adapter,
    inspectPlugins: () => ({ statuses: [], manifests: [] }),
    releases: new ReleaseLedger(),
  });
  cleanup.push(() => updated.unmountAll());
  updated.mount(plugin);
  expect(safe.getAttribute('data-catalog-applied')).toBe('yes');
  expect(safe.style.color).toBe('red');
});
