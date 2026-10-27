import { describe, expect, it } from 'vitest';

import { createVimEditor } from '../vimDomEditor';
import {
  setupVimTestEnvironment,
  setVimTestSite,
  setVisibleRect,
  createQuestionInput,
  addToolboxLabel,
  addPromptComposer,
  addEditPromptInput,
  setContentEditableSelection,
  mockCollapsedCaretRects,
  mockCharacterRects,
  presentationFor,
  loadVimStyles,
} from './vimHarness';

setupVimTestEnvironment();

describe('Vim presentation', () => {
  it('mounts the mode HUD below the prompt text instead of next to the Tools button', async () => {
    const input = createQuestionInput();
    const composer = addPromptComposer(input);
    const label = addToolboxLabel();

    const view = presentationFor(input);

    const hud = composer.querySelector<HTMLElement>('.gv-input-vim-hud');
    expect(hud).not.toBeNull();
    expect(hud?.parentElement).toBe(composer);
    expect(hud?.dataset.placement).toBe('composer');
    expect(hud?.style.getPropertyValue('--gv-input-vim-hud-left')).toBe('54px');
    expect(label.querySelector('.gv-input-vim-hud')).toBeNull();
    expect(composer.classList.contains('gv-input-vim-hud-composer-mount')).toBe(true);
    expect(composer.classList.contains('gv-input-vim-hud-mount')).toBe(false);

    view.dispose();

    expect(composer.classList.contains('gv-input-vim-hud-composer-mount')).toBe(false);
  });

  it('anchors the composer HUD in the bottom gutter below editable text', () => {
    const input = createQuestionInput();
    addPromptComposer(input);
    const view = presentationFor(input);
    loadVimStyles();
    const hud = document.querySelector<HTMLElement>('.gv-input-vim-hud')!;
    const style = getComputedStyle(hud);

    expect(style.top).toBe('auto');
    expect(style.bottom).toBe('1px');
    expect(style.left).toBe('var(--gv-input-vim-hud-left, 48px)');
    expect(style.transform).toBe('none');
    expect(style.top).not.toBe('50%');
    expect(style.boxSizing).toBe('border-box');

    view.dispose();
  });

  it('floats the cross-site HUD above the composer instead of covering its input row', () => {
    setVimTestSite('chatgpt.com');
    document.body.innerHTML =
      '<form><div id="prompt-textarea" contenteditable="true">hello</div></form>';
    const input = document.getElementById('prompt-textarea')!;
    setVisibleRect(input);
    const view = presentationFor(input);
    loadVimStyles();
    const hud = document.querySelector<HTMLElement>('.gv-input-vim-hud')!;
    const style = getComputedStyle(hud);

    expect(style.bottom).toBe('calc(100% + 6px)');
    expect(style.left).toBe('var(--gv-input-vim-hud-left, 16px)');
    expect(style.transform).toBe('none');

    view.dispose();
  });

  it('keeps the edit prompt HUD in the reserved row below its outlined textarea', () => {
    createQuestionInput();
    const { input } = addEditPromptInput();
    const view = presentationFor(input);
    loadVimStyles();
    const hud = document.querySelector<HTMLElement>('.gv-input-vim-hud')!;
    const style = getComputedStyle(hud);

    expect(style.bottom).toBe('0px');
    expect(style.height).toBe('16px');
    expect(style.left).toBe('var(--gv-input-vim-hud-left, 28px)');

    view.dispose();
  });

  it('floats the cross-site edit HUD below the card without covering host controls', () => {
    setVimTestSite('chatgpt.com');
    document.body.innerHTML =
      '<div><textarea aria-label="Edit message">hello</textarea><button>Cancel</button><button>Save</button></div>';
    const input = document.querySelector('textarea')!;
    setVisibleRect(input);
    const view = presentationFor(input);
    loadVimStyles();
    const hud = document.querySelector<HTMLElement>('.gv-input-vim-hud')!;
    const style = getComputedStyle(hud);

    expect(style.top).toBe('calc(100% + 4px)');
    expect(style.bottom).toBe('auto');
    expect(style.left).toBe('var(--gv-input-vim-hud-left, 12px)');

    view.dispose();
  });

  it('mounts the HUD on a visible Tools label instead of a stale hidden one', async () => {
    const input = createQuestionInput();
    const hiddenLabel = addToolboxLabel({ hidden: true });
    const visibleLabel = addToolboxLabel();

    const view = presentationFor(input);

    expect(hiddenLabel.querySelector('.gv-input-vim-hud')).toBeNull();
    const hud = visibleLabel.querySelector<HTMLElement>('.gv-input-vim-hud');
    expect(hud).not.toBeNull();
    expect(hud?.parentElement).toBe(visibleLabel);

    view.dispose();
  });

  it('relocates the HUD when the visible Tools label appears after startup', async () => {
    const input = createQuestionInput();

    const view = presentationFor(input);

    const initialHud = document.querySelector<HTMLElement>('.gv-input-vim-hud');
    expect(initialHud).not.toBeNull();
    expect(initialHud?.parentElement).not.toBeNull();

    const label = addToolboxLabel();
    view.updateHud();

    const hud = label.querySelector<HTMLElement>('.gv-input-vim-hud');
    expect(hud).toBe(initialHud);

    view.dispose();
  });

  it('positions the normal-mode cursor at the collapsed caret rect after selection movement', async () => {
    mockCollapsedCaretRects();
    const input = createQuestionInput();
    setContentEditableSelection(input, 2);

    const view = presentationFor(input);

    createVimEditor(() => {}).setInputSelection(input, 3);
    window.dispatchEvent(new Event('resize'));

    const cursor = document.querySelector<HTMLElement>('.gv-input-vim-cursor');
    expect(cursor?.hidden).toBe(false);
    expect(cursor?.style.left).toBe('116px');

    view.dispose();
  });

  it('flashes the Vim cursor when it moves', async () => {
    mockCollapsedCaretRects();
    const input = createQuestionInput();
    setContentEditableSelection(input, 1);

    const view = presentationFor(input);

    window.dispatchEvent(new Event('resize'));
    const cursor = document.querySelector<HTMLElement>('.gv-input-vim-cursor');
    expect(cursor?.classList.contains('gv-input-vim-cursor-moving')).toBe(false);

    createVimEditor(() => {}).setInputSelection(input, 2);
    window.dispatchEvent(new Event('resize'));

    expect(cursor?.classList.contains('gv-input-vim-cursor-moving')).toBe(true);

    view.dispose();
  });

  it('sizes the normal-mode cursor to the full rendered CJK character width', async () => {
    mockCharacterRects({
      0: { left: 80, top: 10, width: 9 },
      1: { left: 89, top: 10, width: 18 },
      2: { left: 107, top: 10, width: 9 },
    });
    const input = createQuestionInput('a你b');
    setContentEditableSelection(input, 1);

    const view = presentationFor(input);

    window.dispatchEvent(new Event('resize'));

    const cursor = document.querySelector<HTMLElement>('.gv-input-vim-cursor');
    expect(cursor?.style.left).toBe('89px');
    expect(cursor?.style.width).toBe('18px');

    view.dispose();
  });

  it('uses a narrow normal-mode cursor on an empty line', async () => {
    mockCharacterRects({
      0: { left: 80, top: 10, width: 10 },
      2: { left: 80, top: 30, width: 0 },
      3: { left: 80, top: 50, width: 10 },
    });
    const input = createQuestionInput('a\n\nb');
    setContentEditableSelection(input, 2);

    const view = presentationFor(input);

    window.dispatchEvent(new Event('resize'));

    const cursor = document.querySelector<HTMLElement>('.gv-input-vim-cursor');
    expect(cursor?.style.left).toBe('80px');
    expect(cursor?.style.width).toBe('9px');

    view.dispose();
  });
});
