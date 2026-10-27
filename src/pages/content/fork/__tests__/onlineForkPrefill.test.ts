// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { mountRealGeminiSidebar } from '@/core/gemini/sidebar/__tests__/realSidebarFixture';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { startForkLinkFinisher } from '../linkFinisher';
import { startPendingFork } from '../pendingFork';

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) } } },
}));
let stop = () => {};
let stopCore = () => {};
let retire = () => {};
const markdown = '# Source\n\nThe original conversation';
const flush = async () => {
  for (let n = 0; n < 8; n++) await Promise.resolve();
};
function start(mode: 'paste' | 'fileUpload' = 'paste') {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    gvPendingFork: {
      sourceConversationId: 'source',
      sourceTurnId: 's-1111111111111111',
      sourceUrl: 'https://gemini.google.com/app/source',
      sourceTitle: 'Source',
      forkGroupId: 'group',
      sourceForkIndex: 0,
      nextForkIndex: 1,
      markdown,
      mode,
      filename: 'fork.md',
      createdAt: Date.now(),
    },
  });
  stop = startPendingFork({
    getConversationId: () => null,
    getConversationTitle: () => 'New',
    onLinked: async () => undefined,
  });
}
function sharedAppField(): HTMLElement {
  const page = mountRealGeminiSidebar();
  const shell = document.createElement('div');
  shell.setAttribute('role', 'dialog');
  page.main.before(shell);
  shell.append(page.main);
  page.chatWindow.insertAdjacentHTML(
    'beforeend',
    '<input-area-v2><composer-box><section class="fork-input" contenteditable="true">Untouched</section></composer-box></input-area-v2>',
  );
  return page.chatWindow.querySelector('.fork-input')!;
}
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/app');
  stopCore = startForkLinkFinisher();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 24,
  } as DOMRect);
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn().mockReturnValue(false),
  });
});
afterEach(() => {
  stop();
  stopCore();
  retire();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(['paste', 'fileUpload'] as const)(
  'a renamed composer receives the pending fork %s instead of timing out',
  async (mode) => {
    document.body.innerHTML =
      '<main><input-area-v2><composer-box><div class="fork-input" contenteditable="true"></div></composer-box></input-area-v2></main>';
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.fork-input'] });
    start(mode);
    await flush();
    const field = document.querySelector('.fork-input')!;
    if (mode === 'paste') expect(field.textContent).toBe(markdown);
    else expect(field.textContent).toContain('fork.md');
  },
);

it.each(['paste', 'fileUpload'] as const)(
  'a repaired fork %s never reaches the draft because the app has a shared dialog owner',
  async (mode) => {
    const field = sharedAppField();
    field.textContent = '';
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.fork-input'] });
    start(mode);
    await flush();
    if (mode === 'paste') expect(field.textContent).toBe(markdown);
    else expect(field.textContent).toContain('fork.md');
  },
);

it('a nested dialog cannot borrow the repaired fork draft from the shared app', async () => {
  const field = sharedAppField();
  field.setAttribute('data-testid', 'chat-input');
  const preview = document.createElement('div');
  preview.setAttribute('role', 'dialog');
  field.before(preview);
  preview.append(field);
  retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.fork-input'] });
  start();
  await flush();
  expect(field.textContent).toBe('Untouched');
  stop();
  preview.before(field);
  start();
  await flush();
  expect(field.textContent).toBe(markdown);
});

it('bundled and remote fork prefill write the same text into the same main field', async () => {
  document.body.innerHTML =
    '<main><input-area-v2><rich-textarea><div class="fork-input" contenteditable="true"></div></rich-textarea></input-area-v2></main>';
  const field = document.querySelector('.fork-input')!;
  start();
  await flush();
  const bundled = field.textContent;
  expect(bundled).toBe(markdown);
  stop();
  field.textContent = '';
  retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.fork-input'] });
  start();
  await flush();
  expect(field.textContent).toBe(bundled);
});

it('fork prefill waits until a reply-owned alias becomes the original main composer', async () => {
  document.body.innerHTML =
    '<main><model-response><input-area-v2><div class="fork-input" contenteditable="true">Reply preview</div></input-area-v2></model-response></main>';
  const field = document.querySelector<HTMLElement>('.fork-input')!;
  retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.fork-input'] });
  start();
  await flush();
  expect(field.textContent).toBe('Reply preview');
  document.querySelector('main')!.append(field.closest('input-area-v2')!);
  await vi.advanceTimersByTimeAsync(20);
  expect(field.textContent).toBe(markdown);
});

it('a composer moved into a reply before the paste resumes keeps its own text', async () => {
  document.body.innerHTML =
    '<main><model-response></model-response><input-area-v2><div class="fork-input" contenteditable="true">Untouched</div></input-area-v2></main>';
  const field = document.querySelector<HTMLElement>('.fork-input')!;
  retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.fork-input'] });
  const measure = vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => {
    queueMicrotask(() =>
      document.querySelector('model-response')!.append(field.closest('input-area-v2')!),
    );
    return { height: 24 } as DOMRect;
  });
  start();
  await flush();
  expect(field.textContent).toBe('Untouched');
  stop();
  measure.mockReturnValue({ height: 24 } as DOMRect);
  document.querySelector('main')!.append(field.closest('input-area-v2')!);
  start();
  await flush();
  expect(field.textContent).toBe(markdown);
});
