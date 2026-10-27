import type { JSDOM } from 'jsdom';
// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { sendShortcutPrimitive } from '../verbs/sendShortcut';
import { vimInputPrimitive } from '../verbs/vimInput';
import { PluginScope } from './pluginScope';

const scopes: PluginScope[] = [];
const lifetimes: SiteSelectorLifetime[] = [];
declare const jsdom: JSDOM;
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  for (const lifetime of lifetimes.splice(0)) lifetime.stop();
  jsdom.reconfigure({ url: 'https://chatgpt.com/c/work' });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function offline(site: string, hostname: string): Promise<void> {
  jsdom.reconfigure({ url: `https://${hostname}/c/work` });
  const lifetime = initializeSiteSelectors(site, {
    host: hostname,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: site, catalogRevision: 2, locators: {} }),
    readOnlineUpdates: async () => false,
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
}
function context(site: string, selectors: Record<string, string>) {
  const adapter = requireBundledSiteAdapter(site);
  return {
    doc: document,
    adapter: { ...adapter, selectors: { ...adapter.selectors, ...selectors } },
    pluginId: 'test.legacy-inputs',
    settings: {},
    setTargetCounter: () => {},
  };
}
function scope() {
  const instance = new PluginScope();
  scopes.push(instance);
  return instance;
}
function show() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 300,
    height: 40,
  } as DOMRect);
}
function key(field: HTMLElement, name: string, ctrlKey = false) {
  const event = new KeyboardEvent('keydown', {
    key: name,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  field.dispatchEvent(event);
  return event;
}

it('OFF keeps an outside-form upload from sending prematurely through the cached composer root', async () => {
  await offline('chatgpt', 'chatgpt.com');
  document.body.innerHTML =
    '<div class="catalog-root"><progress></progress><form><div id="prompt-textarea" contenteditable="true">draft</div><button type="submit">Send</button></form></div>';
  show();
  const field = document.getElementById('prompt-textarea')!;
  const clicks = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('button')!.addEventListener('click', clicks);
  sendShortcutPrimitive.activate(
    scope(),
    {},
    context('chatgpt', { composerRoot: '.catalog-root' }),
  );
  key(field, 'Enter', true);
  expect(clicks).not.toHaveBeenCalled();
  expect(field.textContent).toBe('draft');
  document.querySelector('progress')!.remove();
  key(field, 'Enter', true);
  expect(clicks).toHaveBeenCalledTimes(1);
});

it.each([
  [
    'claude',
    'claude.ai',
    '<textarea id="catalog-input">draft</textarea>',
    { composer: '#catalog-input', composerRoot: '.catalog-root', sendButton: '.catalog-send' },
  ],
  [
    'deepseek',
    'chat.deepseek.com',
    '<textarea id="catalog-input">draft</textarea>',
    { composer: '#catalog-input', composerRoot: '.catalog-root', sendButton: '.catalog-send' },
  ],
  [
    'kimi',
    'www.kimi.com',
    '<div class="chat-input-editor" contenteditable="true" role="textbox">draft</div>',
    { composerRoot: '.catalog-root', sendButton: '.catalog-send' },
  ],
] as const)(
  'OFF keeps %s cached input fields sending from the selected draft',
  async (site, hostname, fieldHtml, selectors) => {
    await offline(site, hostname);
    document.body.innerHTML = `<div class="catalog-root">${fieldHtml}<div role="button" class="catalog-send">Send</div></div>`;
    show();
    const field = document.querySelector<HTMLElement>('textarea, [contenteditable]')!;
    const clicks = vi.fn();
    document.querySelector('.catalog-send')!.addEventListener('click', clicks);
    sendShortcutPrimitive.activate(scope(), {}, context(site, selectors));
    expect(key(field, 'Enter', true).defaultPrevented).toBe(true);
    expect(clicks).toHaveBeenCalledTimes(1);
  },
);

it('a DeepSeek composer override keeps Vim editing the selected draft instead of the first textarea', async () => {
  document.body.innerHTML =
    '<textarea id="profile">profile draft</textarea><div class="catalog-root"><textarea id="catalog-input">draft</textarea></div>';
  show();
  const field = document.querySelector<HTMLTextAreaElement>('#catalog-input')!;
  vimInputPrimitive.activate(scope(), {}, context('deepseek', { composer: '#catalog-input' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  field.focus();
  field.setSelectionRange(0, 0);
  key(field, 'Escape');
  key(field, 'x');
  expect(field.value).toBe('raft');
  expect(document.querySelector<HTMLTextAreaElement>('#profile')!.value).toBe('profile draft');
});
