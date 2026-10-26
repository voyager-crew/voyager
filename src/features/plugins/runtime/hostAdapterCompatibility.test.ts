import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

import { getSiteSelectorContract } from '@/core/selectors/contracts';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';

import { SEMANTIC_SELECTOR_KEYS } from '../sites/semanticKeys';
import { semanticRef, type PluginManifest } from '../types';
import { DeclarativeEngine } from './declarativeEngine';
import { createHostEngine } from './hostEngine';
import { ReleaseLedger } from './releaseLedger';

const cleanup: Array<() => void> = [];

afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);

it.each([
  ['claude', 'claude.ai'],
  ['kimi', 'www.kimi.com'],
  ['chatgpt', 'chatgpt.com'],
  ['deepseek', 'chat.deepseek.com'],
])(
  '%s declarative repairs outside the guarded contract still reach renamed page nodes',
  (siteId, host) => {
    const page = new JSDOM('<!doctype html><body></body>', { url: `https://${host}/` });
    cleanup.push(() => page.window.close());
    const doc = page.window.document;
    const keys = SEMANTIC_SELECTOR_KEYS.filter(
      (key) => !getSiteSelectorContract(siteId)!.keys.includes(key),
    );
    const adapter = {
      ...requireBundledSiteAdapter(siteId),
      selectors: Object.fromEntries(keys.map((key) => [key, `#renamed-${key}`])),
    };
    for (const key of keys) {
      const target = doc.createElement('section');
      target.id = `renamed-${key}`;
      target.textContent = `${siteId} ${key}`;
      doc.body.append(target);
    }
    const plugin: PluginManifest = {
      id: 'test.adapter-compatibility',
      name: 'Adapter compatibility',
      version: '1.0.0',
      description: 'Test existing catalog semantic overrides',
      author: 'test',
      category: 'other',
      license: 'MIT',
      engine: '>=1.0.0',
      tier: 'declarative',
      matches: [`https://${host}/*`],
      contributes: {
        domOps: keys.map((key) => ({
          op: 'addClass',
          target: semanticRef(key),
          className: 'gv-catalog-repair',
        })),
      },
    };
    // The baseline engine read the resolved adapter directly, including newly added semantic keys.
    const baseline = new DeclarativeEngine({ doc, adapter });
    cleanup.push(() => baseline.unmountAll());
    baseline.mount(plugin);
    const originalTargets = Array.from(doc.querySelectorAll('.gv-catalog-repair'));
    expect(originalTargets.map((node) => node.textContent)).toEqual(
      keys.map((key) => `${siteId} ${key}`),
    );
    baseline.unmountAll();

    const current = createHostEngine({
      doc,
      adapter,
      inspectPlugins: () => ({ statuses: [], manifests: [] }),
      releases: new ReleaseLedger(),
    });
    cleanup.push(() => current.unmountAll());
    current.mount(plugin);
    expect(Array.from(doc.querySelectorAll('.gv-catalog-repair'))).toEqual(originalTargets);
  },
);
