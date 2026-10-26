// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/code" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';
import { LONG_CODE_BLOCK_MIN_LINES } from '@/pages/content/codeBlockCollapse/engine';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { codeCollapsePrimitive } from './index';

const scopes: PluginScope[] = [];
let lifetime: SiteSelectorLifetime | undefined;
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
  vi.useRealTimers();
});
function mount(): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  codeCollapsePrimitive.activate(
    scope,
    { code: 'code' },
    {
      doc: document,
      adapter: withGuardedPageAdapter(requireBundledSiteAdapter('chatgpt'), document),
      pluginId: 'test.collapse',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  return scope;
}
it('a renamed ChatGPT block keeps its native source and copy header when collapsed', async () => {
  vi.useFakeTimers();
  const source = Array.from(
    { length: LONG_CODE_BLOCK_MIN_LINES },
    (_, index) => `line ${index}`,
  ).join('\n');
  document.body.innerHTML = `<article data-chatgpt-selection-message-id="answer"><section class="renamed" data-markdown-copy="code-block"><header data-markdown-copy="exclude"><span>python</span><button>Copy</button></header><code style="display:block;white-space:pre">${source}</code></section></article>`;
  const host = document.querySelector('section')!;
  const header = document.querySelector('header')!;
  const code = document.querySelector('code')!;
  const snapshot = () => ({
    collapsed: host.classList.contains('gv-code-block-collapsed'),
    clip: code.classList.contains('gv-code-block-clip'),
    label: host.querySelector('.gv-code-block-toggle')?.getAttribute('aria-label'),
    source: code.textContent,
    header: header.innerHTML,
  });
  const bundled = mount();
  const before = snapshot();
  expect(before.collapsed).toBe(true);
  await bundled.dispose();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: 'chatgpt', catalogRevision: 2, selectors: { codeBlock: '.renamed' } }),
  });
  await lifetime.ready;
  const parity = mount();
  expect(snapshot()).toEqual(before);
  await parity.dispose();
  host.removeAttribute('data-markdown-copy');
  mount();
  expect(snapshot()).toEqual(before);
  code.append('\ncontinued');
  await vi.runAllTimersAsync();
  expect(host.querySelectorAll('.gv-code-block-toggle')).toHaveLength(1);
  expect(code.textContent).toBe(source + '\ncontinued');
  expect(header.querySelector('button')?.textContent).toBe('Copy');
});
