import { describe, expect, it, vi } from 'vitest';

import {
  setupVimTestEnvironment,
  setVimTestSite,
  setVisibleRect,
  mockInputVimModeStorage,
  createQuestionInput,
  fireInputKey,
  setContentEditableSelection,
} from './vimHarness';

setupVimTestEnvironment();

describe('Vim on each site’s own editor', () => {
  it.each([
    {
      site: 'Claude',
      markup:
        '<fieldset><div data-testid="chat-input" class="tiptap ProseMirror" contenteditable="true" role="textbox">hello</div></fieldset>',
      inputSelector: '[data-testid="chat-input"]',
      mountSelector: 'fieldset',
    },
    {
      site: 'ChatGPT',
      markup:
        '<form><textarea aria-label="Chat with ChatGPT"></textarea><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox">hello</div></form>',
      inputSelector: '#prompt-textarea',
      mountSelector: 'form',
    },
  ])(
    'uses Vim commands and a non-overlapping HUD in $site',
    async ({ site, markup, inputSelector, mountSelector }) => {
      setVimTestSite(site === 'ChatGPT' ? 'chatgpt.com' : 'claude.ai');
      mockInputVimModeStorage(true);
      document.body.innerHTML = markup;

      const input = document.querySelector<HTMLElement>(inputSelector);
      const mount = document.querySelector<HTMLElement>(mountSelector);
      if (!input || !mount) throw new Error('Expected cross-site composer.');

      setVisibleRect(input);
      setVisibleRect(mount);
      input.focus = vi.fn();
      setContentEditableSelection(input, 1);

      const onInput = vi.fn();
      input.addEventListener('input', onInput);

      const { startInputVimMode } = await import('../vimMode');
      const cleanup = await startInputVimMode();

      fireInputKey(input, 'Escape');
      fireInputKey(input, 'x');

      expect(input.textContent).toBe('hllo');
      expect(onInput).toHaveBeenCalledTimes(1);
      expect(input.dataset.gvVimMode).toBe('normal');
      const hud = mount.querySelector<HTMLElement>('.gv-input-vim-hud');
      expect(hud?.dataset.placement).toBe('floating');
      expect(hud?.parentElement).toBe(mount);

      cleanup();
    },
  );

  it.each([
    { site: 'Claude', saveLabel: 'Save' },
    { site: 'ChatGPT', saveLabel: 'Send' },
  ])('uses Vim commands in the $site historical-message editor', async ({ site, saveLabel }) => {
    setVimTestSite(site === 'ChatGPT' ? 'chatgpt.com' : 'claude.ai');
    mockInputVimModeStorage(true);
    const mainInput = createQuestionInput('main prompt');
    const editCard = document.createElement('div');
    editCard.innerHTML = `
        <div class="edit-scroll">
          <textarea aria-label="Edit message">hello</textarea>
        </div>
        <div class="edit-actions">
          <button type="button">Cancel</button>
          <button type="button">${saveLabel}</button>
        </div>
      `;
    document.body.prepend(editCard);

    const input = editCard.querySelector('textarea');
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error('Expected cross-site edit textarea.');
    }

    setVisibleRect(editCard);
    setVisibleRect(input);
    input.focus = vi.fn();
    input.selectionStart = 1;
    input.selectionEnd = 1;

    const { startInputVimMode } = await import('../vimMode');
    const cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'x');

    expect(input.value).toBe('hllo');
    expect(input.dataset.gvVimMode).toBe('normal');
    expect(mainInput.dataset.gvVimMode).toBeUndefined();
    const hud = editCard.querySelector<HTMLElement>('.gv-input-vim-hud');
    expect(hud?.dataset.placement).toBe('edit-floating');
    expect(hud?.parentElement).toBe(editCard);

    cleanup();
  });
});
