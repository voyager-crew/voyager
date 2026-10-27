// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chat.deepseek.com/a/chat/s/work" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';
import { LONG_CODE_BLOCK_MIN_LINES } from '@/pages/content/codeBlockCollapse/engine';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { codeCollapsePrimitive } from './index';

const source = Array.from(
  { length: LONG_CODE_BLOCK_MIN_LINES },
  (_, index) => `line ${index}`,
).join('\n');
let scope: PluginScope;
let stopSelectors = () => {};
const toggle = (element: Element) => element.querySelector('.gv-code-block-toggle');

function reply(id: string, classes: string): string {
  return `<div class="ds-message"><div class="ds-assistant-message-main-content"><section id="${id}" class="${classes}"><pre>${source}</pre></section></div></div>`;
}
async function patch(selector: string) {
  const session = initializeSiteSelectors('deepseek', {
    host: 'chat.deepseek.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'deepseek', catalogRevision: 1, selectors: { codeBlock: selector } }),
  });
  stopSelectors = session.stop;
  await session.ready;
}
function activate() {
  void codeCollapsePrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: withGuardedPageAdapter(requireBundledSiteAdapter('deepseek'), document),
      pluginId: 'test.code-collapse',
      settings: {},
      setTargetCounter: () => {},
    },
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<main>${reply('code', 'renamed-code')}</main>`;
  scope = new PluginScope();
});
afterEach(async () => {
  await scope.dispose();
  stopSelectors();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('a once-valid code alias cannot collapse a dialog preview that appears after activation', async () => {
  await patch('.renamed-code');
  activate();
  const code = document.getElementById('code')!;
  expect(toggle(code)).not.toBeNull();
  expect(code.classList.contains('gv-code-block-collapsed')).toBe(true);

  document.body.insertAdjacentHTML(
    'beforeend',
    `<div role="dialog">${reply('preview', 'renamed-code')}</div>`,
  );
  await vi.runAllTimersAsync();
  const preview = document.getElementById('preview')!;
  expect(toggle(preview)).toBeNull();
  expect(toggle(code)).toBeNull();
  expect(preview.textContent).toBe(source);

  // A working bundled host resumes collapsing even while the foreign alias remains in the page.
  code.classList.add('md-code-block');
  code.querySelector('pre')!.append('\ncontinued');
  await vi.runAllTimersAsync();
  expect(toggle(code)).not.toBeNull();
  expect(toggle(preview)).toBeNull();
});

it('equivalent bundled and online code reads preserve the same toggle, clip and streaming behavior', async () => {
  const code = document.getElementById('code')!;
  code.classList.add('md-code-block');
  const snapshot = () => ({
    collapsed: code.classList.contains('gv-code-block-collapsed'),
    clipped: code.querySelector('pre')!.classList.contains('gv-code-block-clip'),
    label: toggle(code)?.getAttribute('aria-label'),
    text: code.querySelector('pre')!.textContent,
  });
  activate();
  const bundled = snapshot();
  await scope.dispose();
  scope = new PluginScope();
  await patch('#code');
  activate();
  expect(snapshot()).toEqual(bundled);
  code.querySelector('pre')!.append('\ncontinued');
  await vi.runAllTimersAsync();
  expect(toggle(code)).not.toBeNull();
  expect(code.classList.contains('gv-code-block-collapsed')).toBe(true);
});

it('a bundled streaming pass keeps its local scan without re-querying every code host', async () => {
  const code = document.getElementById('code')!;
  code.classList.add('md-code-block');
  activate();
  const pageScan = vi.spyOn(document.body, 'querySelectorAll');
  code.querySelector('pre')!.append('\ncontinued');
  await vi.runAllTimersAsync();
  expect(toggle(code)).not.toBeNull();
  expect(pageScan.mock.calls.filter(([selector]) => selector === '.md-code-block')).toHaveLength(0);
});
