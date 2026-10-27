// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { COLLAPSE_TOGGLE_CLASS, collapsePrimitive } from './index';

let scope: PluginScope;
let lifetime: SiteSelectorLifetime | undefined;
const host = () => document.getElementById('prompt')!;
const toggle = (element = host()) => {
  const next = element.nextElementSibling;
  return next?.classList.contains(COLLAPSE_TOGGLE_CLASS) ? (next as HTMLButtonElement) : null;
};
const snapshot = () => ({
  height: getComputedStyle(host()).maxHeight,
  expanded: toggle()?.getAttribute('aria-expanded'),
  label: toggle()?.getAttribute('aria-label'),
  content: host().innerHTML,
});
async function patch() {
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'chatgpt', catalogRevision: 1, selectors: { userTurn: '.prompt' } }),
  });
  await lifetime.ready;
}
function activate() {
  let count: () => number = () => 0;
  void collapsePrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: withGuardedPageAdapter(requireBundledSiteAdapter('chatgpt'), document),
      pluginId: 'test.collapse',
      settings: {},
      setTargetCounter: (read) => (count = read),
    },
  );
  return () => count();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500);
  document.body.innerHTML =
    '<main><section data-message-role="user"><div id="prompt" class="prompt"><p>Long prompt <strong>keeps formatting</strong></p></div></section></main>';
  scope = new PluginScope();
});
afterEach(async () => {
  await scope.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('a once-valid turn alias releases its old collapse when a dialog preview appears', async () => {
  await patch();
  const count = activate();
  expect(snapshot().height).toBe('320px');
  expect(count()).toBe(1);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div role="dialog"><section data-message-role="user"><div id="preview" class="prompt"><p>Preview prompt</p></div></section></div>',
  );
  await vi.runAllTimersAsync();
  const preview = document.getElementById('preview')!;
  expect(toggle()).toBeNull();
  expect(getComputedStyle(host()).maxHeight).not.toBe('320px');
  expect(toggle(preview)).toBeNull();
  expect(preview.textContent).toBe('Preview prompt');
  expect(count()).toBe(0);

  host().setAttribute('data-user-message-bubble', '');
  host().querySelector('p')!.append(' Continued.');
  await vi.runAllTimersAsync();
  expect(snapshot().height).toBe('320px');
  expect(toggle(preview)).toBeNull();
  expect(count()).toBe(1);
});

it('bundled and remote reads preserve the same collapse controls and native content on the same DOM', async () => {
  host().setAttribute('data-user-message-bubble', '');
  activate();
  const original = snapshot();
  await scope.dispose();
  scope = new PluginScope();
  await patch();
  activate();
  expect(snapshot()).toEqual(original);
  toggle()!.click();
  host().querySelector('p')!.append(' Continued.');
  await vi.runAllTimersAsync();
  expect(snapshot().expanded).toBe('true');
  expect(snapshot().height).not.toBe('320px');
  expect(host().textContent).toContain('Continued.');
});

it('its own collapse decorations do not release a renamed prompt during streaming', async () => {
  await patch();
  activate();
  expect(snapshot().height).toBe('320px');
  host().querySelector('p')!.append(' Continued.');
  await vi.runAllTimersAsync();
  expect(snapshot().height).toBe('320px');
  expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
  expect(host().textContent).toContain('Continued.');
});

it('a released collapse decoration cannot certify a later unrelated Voyager component', async () => {
  await patch();
  activate();
  const oldClass = Array.from(host().classList).find((name) => name.startsWith('gv-collapse-'))!;
  expect(snapshot().height).toBe('320px');
  await scope.dispose();
  // Reusing that old class after teardown is no longer a decoration owned by a running feature.
  host().classList.add(oldClass);
  scope = new PluginScope();
  activate();
  expect(toggle()).toBeNull();
  host().classList.remove(oldClass);
  host().querySelector('p')!.append(' Native again.');
  await vi.runAllTimersAsync();
  expect(snapshot().height).toBe('320px');
  expect(toggle()).not.toBeNull();
});

it('a turn initially rejected in a dialog receives its collapse when its native owner mounts', async () => {
  const prompt = host();
  const owner = prompt.parentElement!;
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  dialog.append(owner);
  await patch();
  activate();
  expect(toggle(prompt)).toBeNull();
  document.querySelector('main')!.append(owner);
  await vi.runAllTimersAsync();
  expect(toggle(prompt)!.getAttribute('aria-expanded')).toBe('false');
  expect(getComputedStyle(prompt).maxHeight).toBe('320px');
});

it('bundled streaming keeps local host lookup without a complete turn rescan', async () => {
  host().setAttribute('data-user-message-bubble', '');
  activate();
  const scan = vi.spyOn(document.body, 'querySelectorAll');
  vi.mocked(
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')!.get!,
  ).mockReturnValue(100);
  host().querySelector('p')!.textContent = 'Short prompt';
  await vi.runAllTimersAsync();
  expect(toggle()).toBeNull();
  expect(snapshot().height).not.toBe('320px');
  vi.mocked(
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')!.get!,
  ).mockReturnValue(500);
  host().querySelector('p')!.append(' Continued.');
  await vi.runAllTimersAsync();
  expect(snapshot().height).toBe('320px');
  expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
  expect(host().textContent).toBe('Short prompt Continued.');
  expect(
    scan.mock.calls.filter(
      ([query]) => query === requireBundledSiteAdapter('chatgpt').selectors.userTurn,
    ),
  ).toHaveLength(0);
});
