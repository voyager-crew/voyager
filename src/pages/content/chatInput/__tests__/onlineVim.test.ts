import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBundledGeminiSelectorView } from '@/core/gemini/selectors';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { createGeminiVimComposerResolver } from '../vimGeminiComposer';
import { createVimInputTargets, getSendButtonTarget, isEditPromptInput } from '../vimInputTargets';
import { startInputVimMode } from '../vimMode';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
let stop = () => {};
let stopVim = () => {};
function layout(id: string): HTMLElement {
  const element = document.getElementById(id)!;
  element.getBoundingClientRect = () =>
    ({ width: 400, height: 40, top: 100, bottom: 140, left: 0, right: 400 }) as DOMRect;
  return element;
}
function read(configured: string | null = null, requireVisible = true) {
  return createGeminiVimComposerResolver(() => configured)({ doc: document, requireVisible });
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
});
afterEach(() => {
  stopVim();
  stopVim = () => {};
  stop();
  stop = () => {};
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', originalLocation);
});

describe('Gemini Vim owner profiles', () => {
  it('keeps wrapper traversal, visible-first and hidden fallback identical online', async () => {
    const configured = 'input-area-v2, rich-textarea, .text-input-field';
    document.body.innerHTML = `<input-area-v2 class="renamed"><textarea id="hidden"></textarea>
      <div><textarea id="visible"></textarea></div></input-area-v2>`;
    const visible = layout('visible');
    const bundled = read(configured);
    stop = await installGeminiSelectorPatch({
      'vim.configuredComposer': ['.renamed'],
      'vim.candidates': ['textarea'],
    });
    const remote = read(configured);
    expect(remote.element).toBe(bundled.element);
    expect(remote.element).toBe(visible);
    expect(remote.view.remoteKeys.has('vim.configuredComposer')).toBe(true);
    visible.style.display = 'none';
    expect(read(configured).element).toBeNull();
    expect(read(configured, false).element?.id).toBe('hidden');
  });

  it('keeps editing the original draft when an online list drops a hidden editor', async () => {
    document.body.innerHTML = `<input-area-v2><textarea id="hidden"></textarea>
      <textarea id="draft"></textarea></input-area-v2>`;
    layout('draft');
    stop = await installGeminiSelectorPatch({ 'vim.candidates': ['#draft'] });
    const result = read();
    expect(result.element?.id).toBe('draft');
    expect(result.view).toBe(getBundledGeminiSelectorView());
    document.getElementById('draft')!.style.display = 'none';
    expect(read(null, false).element?.id).toBe('hidden');
  });

  it('does not enter a reply editor when a renamed main input needs repair', async () => {
    document.body.innerHTML = `<input-area-v2><div id="draft" contenteditable="plaintext-only"></div></input-area-v2>
      <model-response><div id="reply" contenteditable="plaintext-only"></div></model-response>`;
    layout('draft');
    layout('reply');
    stop = await installGeminiSelectorPatch({ 'vim.candidates': ['#reply'] });
    expect(read().element).toBeNull();
    stop();
    stop = await installGeminiSelectorPatch({ 'vim.candidates': ['#draft'] });
    expect(read().element?.id).toBe('draft');
    expect(read().view.remoteKeys.has('vim.candidates')).toBe(true);
  });

  it('rejects a configured wrapper that skips the original draft', async () => {
    const configured = 'input-area-v2, rich-textarea, .text-input-field';
    document.body.innerHTML = `<input-area-v2><textarea id="draft"></textarea></input-area-v2>
      <section class="wrong"><textarea id="other"></textarea></section>`;
    layout('draft');
    layout('other');
    stop = await installGeminiSelectorPatch({ 'vim.configuredComposer': ['.wrong'] });
    expect(read(configured).element?.id).toBe('draft');
    expect(read(configured).view).toBe(getBundledGeminiSelectorView());
  });

  it('keeps the original generic fallback when a new wrapper would take over another draft', async () => {
    const configured = 'input-area-v2, rich-textarea, .text-input-field';
    document.body.innerHTML = `<textarea id="original"></textarea>
      <input-area class="renamed"><textarea id="main"></textarea></input-area>`;
    layout('original');
    layout('main');
    stop = await installGeminiSelectorPatch({ 'vim.configuredComposer': ['.renamed'] });
    expect(read(configured).element?.id).toBe('original');
  });

  it('a confirming patch does not move the HUD', async () => {
    const composerSelector = 'input-area-v2, rich-textarea, .text-input-field';
    document.body.innerHTML = `<section id="composer-parent"><rich-textarea>
      <textarea id="draft">draft</textarea></rich-textarea></section>
      <toolbox-drawer><button id="tools">Tools</button></toolbox-drawer>`;
    layout('draft');
    layout('tools');
    stopVim = await startInputVimMode({ forceEnabled: true, composerSelector });
    expect(document.querySelector('.gv-input-vim-hud')?.parentElement?.id).toBe('tools');
    stopVim();
    stop = await installGeminiSelectorPatch({ 'vim.configuredComposer': ['rich-textarea'] });
    stopVim = await startInputVimMode({ forceEnabled: true, composerSelector });
    expect(document.querySelector('.gv-input-vim-hud')?.parentElement?.id).toBe('tools');
    expect(read(composerSelector).element?.id).toBe('draft');
  });

  it('mounts the repaired HUD through its real fallback order and keeps explicit plugin params', async () => {
    const composerSelector = 'input-area-v2, rich-textarea, .text-input-field';
    document.body.innerHTML = `<section class="input-area" id="mount"><section class="renamed">
      <section id="draft" contenteditable="true">draft</section></section></section>
      <section><section id="custom" contenteditable="true">custom</section></section>
      <toolbox-drawer><button id="tools">Tools</button></toolbox-drawer>`;
    const draft = layout('draft');
    layout('custom');
    layout('tools');
    stop = await installGeminiSelectorPatch({ 'vim.configuredComposer': ['.renamed'] });
    stopVim = await startInputVimMode({ forceEnabled: true, composerSelector });
    expect(document.querySelector('.gv-input-vim-hud')?.parentElement?.id).toBe('mount');
    expect(read(composerSelector).element).toBe(draft);
    expect(read('#custom').element?.id).toBe('custom');
  });

  it('non-editable focus and keys leave the bundled composer unmeasured while fixes are off', async () => {
    document.body.innerHTML = `<input-area-v2><textarea id="draft">draft</textarea></input-area-v2>
      <button id="outside">Outside</button>`;
    const draft = layout('draft');
    const outside = document.getElementById('outside')!;
    stopVim = await startInputVimMode({ forceEnabled: true });
    const measure = vi.spyOn(draft, 'getBoundingClientRect');
    const styles = vi.spyOn(window, 'getComputedStyle');
    outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(measure).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
    draft.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect((draft as HTMLTextAreaElement).value).toBe('raft');
    expect(measure).toHaveBeenCalled();
    expect(styles).toHaveBeenCalled();
  });

  it('keeps the repaired wrapper editable after the real HUD decorates its mount', async () => {
    const configured = 'input-area-v2, rich-textarea, .text-input-field';
    document.body.innerHTML = `<section class="input-area" id="mount"><section class="renamed">
      <section id="draft" contenteditable="true">draft</section></section></section>`;
    const draft = layout('draft');
    stop = await installGeminiSelectorPatch({ 'vim.configuredComposer': ['.renamed'] });
    stopVim = await startInputVimMode({ forceEnabled: true, composerSelector: configured });
    expect(document.querySelector('.gv-input-vim-hud')?.parentElement?.id).toBe('mount');
    expect(read(configured).element).toBe(draft);
    draft.classList.add('gv-input-vim-mode-normal');
    draft.style.display = 'none';
    expect(read(configured, false).element).toBe(draft);
    stopVim();
    expect(read(configured, false).element).toBe(draft);
  });

  it.each([undefined, 'input-area-v2, rich-textarea, .text-input-field'])(
    'keeps the repaired generic editor and HUD together with configured fallback %s',
    async (composerSelector) => {
      document.body.innerHTML = `<input-area id="mount"><section contenteditable="plaintext-only" id="draft">draft</section></input-area>`;
      const draft = layout('draft');
      stop = await installGeminiSelectorPatch({ 'vim.candidates': ['#draft'] });
      stopVim = await startInputVimMode({ forceEnabled: true, composerSelector });
      expect(document.querySelector('.gv-input-vim-hud')?.parentElement?.id).toBe('mount');
      expect(read().element).toBe(draft);
      expect(read(composerSelector ?? null).composerSelector).toBe('#draft');
      draft.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      draft.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      expect(draft.dataset.gvVimMode).toBe('normal');
      draft.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }),
      );
      expect(draft.textContent).toBe('raft');
      draft.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }),
      );
      expect(draft.dataset.gvVimMode).toBe('insert');
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      expect(draft.dataset.gvVimMode).toBe('insert');
    },
  );

  it('keeps old-message edits, Gem editor fallback and send target ownership with online fixes', async () => {
    document.body.innerHTML = `<div class="edit-container"><textarea id="edit"></textarea>
      <button class="update-button" id="update"><span id="label">Update</span></button></div>
      <textarea id="gem"></textarea>`;
    layout('edit');
    layout('gem');
    stop = await installGeminiSelectorPatch({ 'vim.candidates': ['textarea'] });
    const targets = createVimInputTargets(
      () => null,
      createGeminiVimComposerResolver(() => null),
    );
    expect(targets.findVimInput()?.id).toBe('edit');
    expect(isEditPromptInput(document.getElementById('edit')!)).toBe(true);
    expect(getSendButtonTarget(document.getElementById('label'))?.id).toBe('update');
    document.querySelector('.edit-container')!.remove();
    expect(targets.findVimInput()?.id).toBe('gem');
  });
});
