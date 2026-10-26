// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createToaster } from '@/core/ui/toast/toaster';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { DefaultModelAutoApply } from '../autoApply';
import { ModelPicker } from '../modelPicker';
import { findModelFocusInput } from '../modelPickerSelectors';
import { DefaultModelPreferences } from '../preferences';

let retire = () => {};
const stops: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/app');
  const get = vi.mocked(chrome.storage.sync.get) as unknown as ReturnType<typeof vi.fn>;
  get.mockImplementation((_keys: unknown, callback?: (items: Record<string, unknown>) => void) => {
    const data = { [StorageKeys.DEFAULT_MODEL]: { id: 'pro-id', name: 'Pro' } };
    callback?.(data);
    return Promise.resolve(data);
  });
  document.body.innerHTML =
    '<button id="keep-focus">Keep focus</button><button data-test-id="bard-mode-menu-button" id="picker">Flash</button><div class="mat-mdc-menu-panel gds-mode-switch-menu" role="menu"><button id="pro" role="menuitemradio" data-mode-id="pro-id"><span class="mode-title">Pro</span></button></div>';
  document.getElementById('pro')!.addEventListener('click', () => {
    document.getElementById('picker')!.textContent = 'Pro';
    document.getElementById('pro')!.setAttribute('aria-checked', 'true');
  });
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function switchModel() {
  document.getElementById('picker')!.textContent = 'Flash';
  document.getElementById('pro')!.removeAttribute('aria-checked');
  document.getElementById('keep-focus')!.focus();
  const preferences = new DefaultModelPreferences();
  const toaster = createToaster();
  const apply = new DefaultModelAutoApply(preferences, new ModelPicker(preferences), toaster);
  const stop = () => {
    apply.stop();
    toaster.destroy();
  };
  stops.push(stop);
  apply.start();
  await vi.advanceTimersByTimeAsync(1500);
  expect(document.getElementById('picker')!.textContent).toBe('Pro');
  expect(document.getElementById('pro')!.getAttribute('aria-checked')).toBe('true');
  stop();
}

it.each([
  'model-response',
  'user-query',
  'div class="edit-container"',
  'div data-message-author-role="assistant"',
  'div class="gv-preview"',
  'div data-gv-component="preview"',
  'div role="alertdialog"',
  'div role="menu"',
])('model switching cannot focus a renamed rich-textarea inside %s', async (owner) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<${owner}><input-area-v2><rich-textarea><textarea class="focus-alias"></textarea></rich-textarea></input-area-v2></${owner.split(' ')[0]}>`,
  );
  const field = document.querySelector<HTMLTextAreaElement>('.focus-alias')!;
  retire = await installGeminiSelectorPatch({ 'modelPicker.focusInput': ['.focus-alias'] });
  await switchModel();
  expect(document.activeElement).toBe(document.getElementById('keep-focus'));

  // The identical editable becomes eligible only when it belongs to the original main input owner.
  const native = document.createElement('input-area-v2');
  document.body.append(native);
  native.append(field.closest('rich-textarea')!);
  await switchModel();
  expect(document.activeElement).toBe(field);
});

it('two independently owned composers do not let a focus alias choose an arbitrary draft', async () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<input-area-v2><textarea class="focus-alias"></textarea></input-area-v2><input-area-v2 id="other"><textarea></textarea></input-area-v2>',
  );
  retire = await installGeminiSelectorPatch({ 'modelPicker.focusInput': ['.focus-alias'] });
  await switchModel();
  expect(document.activeElement).toBe(document.getElementById('keep-focus'));
  document.getElementById('other')!.remove();
  await switchModel();
  expect(document.activeElement).toBe(document.querySelector('.focus-alias'));
});

it('the same native composer receives focus with bundled and remote profiles', async () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<main><input-area-v2><rich-textarea><div class="focus-alias" contenteditable="true"></div></rich-textarea></input-area-v2></main>',
  );
  const field = document.querySelector<HTMLElement>('.focus-alias')!;
  await switchModel();
  expect(document.activeElement).toBe(field);
  retire = await installGeminiSelectorPatch({ 'modelPicker.focusInput': ['.focus-alias'] });
  await switchModel();
  expect(document.activeElement).toBe(field);
});

it('bundled focus retains its original first-match query cost', () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<main><rich-textarea><div contenteditable="true"></div></rich-textarea></main>',
  );
  const field = document.querySelector('[contenteditable]')!;
  const scans = vi.spyOn(document, 'querySelectorAll');
  expect(findModelFocusInput()).toBe(field);
  expect(scans).toHaveBeenCalledTimes(1);
});
