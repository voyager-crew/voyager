import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { geminiAdapter } from '../sites/adapters/gemini';
import type { PluginManifest, SiteAdapter } from '../types';
import { collectProbes, probeMatches, runProbes } from '../verbs/siteCheck/probes';
import { DeclarativeEngine } from './declarativeEngine';
import { diagnoseOps } from './opDiagnostics';

const manifest: PluginManifest = {
  id: 'local.code-outline',
  name: 'Code outline',
  version: '1.0.0',
  description: 'Outline code',
  author: 'Voyager',
  category: 'other',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  contributes: {
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'codeBlock' },
        className: 'gv-code-outline',
      },
    ],
  },
};
let stop = () => {};
let engine: DeclarativeEngine | null = null;
beforeEach(() => {
  setPageUrl('https://gemini.google.com/app/test');
});
afterEach(() => {
  engine?.unmountAll();
  engine = null;
  stop();
  document.body.replaceChildren();
  resetPageUrl();
});

function code(tag: string, id: string): string {
  return `<${tag} id="${id}"><div class="code-block"><div class="code-block-decoration"><span>Mermaid</span><div class="buttons"><button>Copy</button></div></div><pre><code data-test-id="code-content">flowchart TD\nA--&gt;B</code></pre></div></${tag}>`;
}

function exercise(adapter: SiteAdapter) {
  engine = new DeclarativeEngine({ doc: document, adapter });
  engine.mount(manifest);
  const probes = collectProbes(adapter, null, 'site-check');
  const probe = probes.find((p) => p.name === 'codeBlock')!;
  const result = runProbes([probe], { doc: document, conversation: true })[0];
  const decorated = Array.from(document.querySelectorAll('.gv-code-outline'));
  expect(diagnoseOps(document, adapter, manifest)[0].count).toBe(decorated.length);
  expect(result.count).toBe(decorated.length);
  expect(decorated.every((element) => probeMatches(element, probe))).toBe(true);
  return decorated.map((element) => element.id);
}

describe('checked code semantics across plugin surfaces', () => {
  it('OFF keeps the configured code target without the online host check', () => {
    document.body.innerHTML =
      code('code-block', 'native') + '<pre id="configured">Configured code</pre>';
    expect(exercise({ ...geminiAdapter, selectors: { codeBlock: 'pre#configured' } })).toEqual([
      'configured',
    ]);
  });

  it('online fixes keep a custom Gemini code target consistent across plugins and Site Check', async () => {
    document.body.innerHTML = `<model-response>${code('new-code', 'native')}</model-response><pre id="configured">Configured code</pre>`;
    stop = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    expect(exercise({ ...geminiAdapter, selectors: { codeBlock: 'pre#configured' } })).toEqual([
      'configured',
    ]);
  });

  it('decorates and counts the same code blocks through bundled and online profiles', async () => {
    document.body.innerHTML = `<model-response>${code('code-block', 'first')}${code('code-block', 'second')}</model-response>`;
    expect(exercise(geminiAdapter)).toEqual(['first', 'second']);
    engine!.unmountAll();
    stop = await installGeminiSelectorPatch({ 'code.host': ['#first', '#second'] });
    expect(exercise(geminiAdapter)).toEqual(['first', 'second']);
  });

  it('a repaired code host appears in both the plugin and Site Check', async () => {
    document.body.innerHTML = `<model-response>${code('new-code', 'renamed')}</model-response>`;
    stop = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    expect(exercise(geminiAdapter)).toEqual(['renamed']);
  });

  it('a partial online list still decorates and counts every bundled code block', async () => {
    document.body.innerHTML = `<model-response>${code('code-block', 'first')}${code('code-block', 'second')}</model-response>`;
    stop = await installGeminiSelectorPatch({ 'code.host': ['#second'] });
    expect(exercise(geminiAdapter)).toEqual(['first', 'second']);
  });

  it('another site keeps its adapter code targets while a Gemini patch is installed', async () => {
    document.body.innerHTML = code('new-code', 'gemini') + '<pre id="other">Other site code</pre>';
    stop = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    expect(
      exercise({ ...geminiAdapter, id: 'aistudio', selectors: { codeBlock: 'pre#other' } }),
    ).toEqual(['other']);
  });

  it('a code repair keeps sidebar operations on the sidebar', async () => {
    document.body.innerHTML = code('new-code', 'code') + '<nav id="sidebar">Chats</nav>';
    stop = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    const adapter = { ...geminiAdapter, selectors: { sidebar: 'nav' } };
    const sidebarManifest: PluginManifest = {
      ...manifest,
      contributes: {
        domOps: [
          {
            op: 'addClass',
            target: { kind: 'semantic', key: 'sidebar' },
            className: 'gv-sidebar-outline',
          },
        ],
      },
    };
    engine = new DeclarativeEngine({ doc: document, adapter });
    engine.mount(sidebarManifest);
    expect(Array.from(document.querySelectorAll('.gv-sidebar-outline'), (node) => node.id)).toEqual(
      ['sidebar'],
    );
    const probe = collectProbes(adapter, null, 'site-check').find((p) => p.name === 'sidebar')!;
    expect(probeMatches(document.getElementById('sidebar')!, probe)).toBe(true);
  });
});
