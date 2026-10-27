// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { siteDraftPrefix } from './draftKey';
import { draftSavePrimitive } from './index';
import { DRAFT_SAVE_DEBOUNCE_MS, SEND_INTENT_TIMEOUT_MS } from './session';

const scopes: PluginScope[] = [];
let lifetime: SiteSelectorLifetime | undefined;
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('a send alias moved to another control cannot erase a draft that still needs restoring', async () => {
  vi.useFakeTimers();
  const records: Record<string, unknown> = {};
  const get = vi.spyOn(chrome.storage.local, 'get') as unknown as ReturnType<typeof vi.fn>;
  get.mockImplementation(
    (keys: string | null, callback?: (items: Record<string, unknown>) => void) => {
      const selected = typeof keys === 'string' ? { [keys]: records[keys] } : { ...records };
      callback?.(selected);
      return Promise.resolve(selected);
    },
  );
  vi.spyOn(chrome.storage.local, 'set').mockImplementation((items, callback) => {
    Object.assign(records, items);
    callback?.();
    return Promise.resolve();
  });
  vi.spyOn(chrome.storage.local, 'remove').mockImplementation((keys, callback) => {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete records[key];
    callback?.();
    return Promise.resolve();
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 300, 40),
  );
  document.body.innerHTML =
    '<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" class="repaired-send">Send</button></form>';
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 1,
      selectors: { sendButton: '.repaired-send' },
    }),
  });
  await lifetime.ready;
  const adapter = withGuardedPageAdapter(requireBundledSiteAdapter('chatgpt'), document)!;
  const activate = () => {
    const scope = new PluginScope();
    scopes.push(scope);
    void draftSavePrimitive.activate(
      scope,
      {},
      { doc: document, adapter, pluginId: 'test', settings: {}, setTargetCounter: () => {} },
    );
    return scope;
  };
  const scope = activate();
  await vi.advanceTimersByTimeAsync(0);
  const field = document.querySelector('textarea')!;
  const send = document.querySelector('button')!;
  const key = `${siteDraftPrefix('chatgpt')}conv:work`;
  field.value = 'Keep my unsent question';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
  expect(records[key]).toMatchObject({ content: 'Keep my unsent question' });

  send.className = '';
  send.type = 'submit';
  document.body.insertAdjacentHTML(
    'beforeend',
    '<button type="button" class="repaired-send" id="other">Open another pane</button>',
  );
  document.getElementById('other')!.click();
  field.value = '';
  await vi.advanceTimersByTimeAsync(SEND_INTENT_TIMEOUT_MS);
  expect(records[key]).toMatchObject({ content: 'Keep my unsent question' });

  await scope.dispose();
  activate();
  await vi.advanceTimersByTimeAsync(0);
  expect(field.value).toBe('Keep my unsent question');
  send.addEventListener('click', (event) => event.preventDefault());
  send.click();
  field.value = '';
  await vi.advanceTimersByTimeAsync(SEND_INTENT_TIMEOUT_MS);
  expect(records[key]).toBeUndefined();
});
