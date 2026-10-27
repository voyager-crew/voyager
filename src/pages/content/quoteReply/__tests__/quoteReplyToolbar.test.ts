// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { HighlightManager } from '../../highlight/manager';
import {
  setupQuoteReplyFixture,
  selectSourceText,
  installHighlightConversation,
  emitStorageChange,
} from './quoteReplyFixture';
import { startQuoteReply } from './startQuoteReply';

vi.mock('../../inputCollapse/index', () => ({
  expandInputCollapseIfNeeded: vi.fn(),
}));

vi.mock('@/core/utils/browser', () => ({
  getBrowserName: vi.fn(() => 'Chrome/Chromium'),
}));

setupQuoteReplyFixture();

describe('quote and highlight toolbar', () => {
  it('uses the same selection toolbar for Highlight when Quote Reply is disabled', () => {
    installHighlightConversation();
    const cleanup = startQuoteReply({ quoteEnabled: false });

    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(300);

    const toolbar = document.querySelector('.gv-selection-toolbar');
    const quoteButton = toolbar?.querySelector('.gv-quote-btn');
    const highlightButton = toolbar?.querySelector('.gv-highlight-action');
    expect(document.querySelectorAll('.gv-selection-toolbar')).toHaveLength(1);
    expect(quoteButton).toBeNull();
    expect(highlightButton?.classList.contains('gv-hidden')).toBe(false);

    cleanup();
  });

  it('previews the selected color immediately and saves it with Highlight', async () => {
    installHighlightConversation();
    const createFromRange = vi
      .spyOn(HighlightManager.prototype, 'createFromRange')
      .mockResolvedValue(true);
    const cleanup = startQuoteReply({ quoteEnabled: false, highlightDefaultColor: 'blue' });

    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(300);

    expect(document.querySelector('.gv-highlight-action svg')).not.toBeNull();

    const colorButton = document.querySelector<HTMLButtonElement>('.gv-highlight-color-trigger');
    expect(colorButton?.classList.contains('gv-hidden')).toBe(false);
    expect(colorButton?.style.backgroundColor).toBe('rgb(96, 165, 250)');
    colorButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    colorButton?.click();

    const palette = document.querySelector('.gv-highlight-color-palette');
    expect(palette?.classList.contains('gv-hidden')).toBe(false);
    expect(palette?.getAttribute('role')).toBe('group');
    expect(palette?.querySelectorAll('.gv-highlight-color-option')).toHaveLength(5);
    expect(
      palette?.querySelector('[data-highlight-color="blue"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      palette?.querySelector('[data-highlight-color="pink"]')?.getAttribute('aria-label'),
    ).toBe('Highlight color 4');
    expect(document.getElementById('gemini-voyager-quote-reply-style')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    expect(palette?.classList.contains('gv-hidden')).toBe(true);
    colorButton?.click();
    const pink = palette?.querySelector<HTMLButtonElement>('[data-highlight-color="pink"]');
    pink?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    pink?.click();
    await Promise.resolve();

    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      { [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: 'pink' },
      expect.any(Function),
    );
    expect(createFromRange).not.toHaveBeenCalled();
    expect(
      document.documentElement.classList.contains('gv-highlight-selection-preview-active'),
    ).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue('--gv-highlight-selection-preview-color'),
    ).toBe('rgba(244, 114, 182, 0.38)');
    expect(palette?.classList.contains('gv-hidden')).toBe(false);

    const highlightButton = document.querySelector<HTMLButtonElement>('.gv-highlight-action');
    highlightButton?.click();
    await Promise.resolve();

    expect(createFromRange).toHaveBeenCalledWith(expect.any(Range), 'pink');
    expect(document.querySelector('.gv-selection-toolbar')?.classList.contains('gv-hidden')).toBe(
      true,
    );
    expect(
      document.documentElement.classList.contains('gv-highlight-selection-preview-active'),
    ).toBe(false);
    cleanup();
  });

  it('uses and remembers a custom highlight color', async () => {
    installHighlightConversation();
    const createFromRange = vi
      .spyOn(HighlightManager.prototype, 'createFromRange')
      .mockResolvedValue(true);
    const cleanup = startQuoteReply({ quoteEnabled: false, highlightDefaultColor: 'blue' });

    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(300);

    const colorButton = document.querySelector<HTMLButtonElement>('.gv-highlight-color-trigger');
    colorButton?.click();
    const editColorControl = document.querySelector<HTMLLabelElement>('.gv-highlight-color-edit');
    expect(editColorControl).toBeInstanceOf(HTMLLabelElement);
    const customColor = document.querySelector<HTMLInputElement>('.gv-highlight-custom-color');
    if (!customColor) throw new Error('Expected custom color input');
    expect(editColorControl?.contains(customColor)).toBe(true);
    expect(customColor.getAttribute('aria-label')).toBe(
      'Choose a custom highlight color · Highlight color 3',
    );
    customColor.value = '#123456';
    customColor.dispatchEvent(new Event('input', { bubbles: true }));
    customColor.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      {
        [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: '#123456',
        [StorageKeys.HIGHLIGHT_COLOR_PALETTE]: ['yellow', 'green', '#123456', 'pink', '#c084fc'],
      },
      expect.any(Function),
    );
    expect(createFromRange).not.toHaveBeenCalled();
    expect(
      document.documentElement.style.getPropertyValue('--gv-highlight-selection-preview-color'),
    ).toBe('rgba(18, 52, 86, 0.38)');
    expect(
      document.querySelector('.gv-highlight-color-palette')?.classList.contains('gv-hidden'),
    ).toBe(false);

    document.querySelector<HTMLButtonElement>('.gv-highlight-action')?.click();
    await Promise.resolve();
    expect(createFromRange).toHaveBeenCalledWith(expect.any(Range), '#123456');

    cleanup();
  });

  it('keeps the palette inside the viewport near the bottom-right edge', () => {
    installHighlightConversation();
    const cleanup = startQuoteReply({ quoteEnabled: false });

    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(300);

    const colorButton = document.querySelector<HTMLButtonElement>('.gv-highlight-color-trigger');
    const palette = document.querySelector<HTMLElement>('.gv-highlight-color-palette');
    if (!colorButton || !palette) throw new Error('Expected highlight color controls');
    colorButton.getBoundingClientRect = () =>
      ({
        top: window.innerHeight - 30,
        bottom: window.innerHeight - 8,
        left: window.innerWidth - 30,
        right: window.innerWidth - 8,
        width: 22,
        height: 22,
        x: window.innerWidth - 30,
        y: window.innerHeight - 30,
        toJSON: () => {},
      }) as DOMRect;
    palette.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 40,
        left: 0,
        right: 150,
        width: 150,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    colorButton.click();

    expect(palette.style.top).toBe(`${window.innerHeight - 30 - 40 - 6}px`);
    expect(palette.style.left).toBe(`${window.innerWidth - 150 - 10}px`);
    cleanup();
  });

  it('does not leave an empty toolbar when Highlight is disabled live', () => {
    installHighlightConversation();
    const cleanup = startQuoteReply({ quoteEnabled: false, highlightEnabled: true });

    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(300);

    const listener = (
      chrome.storage.onChanged.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0];
    if (typeof listener !== 'function') throw new Error('Expected storage change listener');
    const toolbar = document.querySelector('.gv-selection-toolbar');
    expect(toolbar?.classList.contains('gv-hidden')).toBe(false);

    listener({ [StorageKeys.HIGHLIGHT_ENABLED]: { newValue: false } }, 'sync');
    expect(toolbar?.classList.contains('gv-hidden')).toBe(true);

    listener({ [StorageKeys.HIGHLIGHT_ENABLED]: { newValue: true } }, 'sync');
    expect(document.querySelector('.gv-highlight-action')?.classList.contains('gv-hidden')).toBe(
      false,
    );
    expect(toolbar?.classList.contains('gv-hidden')).toBe(false);
    cleanup();
  });

  it('hides Highlight and its color picker when the feature is disabled', () => {
    installHighlightConversation();
    const cleanup = startQuoteReply({ quoteEnabled: true, highlightEnabled: false });

    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(300);

    expect(document.querySelector('.gv-highlight-action')).toBeNull();
    expect(document.querySelector('.gv-highlight-color-trigger')).toBeNull();
    expect(document.querySelector('.gv-quote-btn')?.classList.contains('gv-hidden')).toBe(false);
    cleanup();
  });

  it('does not run Highlight until enabled and destroys it when disabled again', () => {
    const init = vi.spyOn(HighlightManager.prototype, 'init').mockResolvedValue();
    const destroy = vi.spyOn(HighlightManager.prototype, 'destroy').mockImplementation(() => {});
    const cleanup = startQuoteReply({ quoteEnabled: true, highlightEnabled: false });

    expect(init).not.toHaveBeenCalled();

    const listener = (
      chrome.storage.onChanged.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0];
    if (typeof listener !== 'function') throw new Error('Expected storage change listener');

    listener({ [StorageKeys.HIGHLIGHT_ENABLED]: { newValue: true } }, 'sync');
    expect(init).toHaveBeenCalledOnce();

    listener({ [StorageKeys.HIGHLIGHT_ENABLED]: { newValue: false } }, 'sync');
    expect(destroy).toHaveBeenCalledOnce();

    cleanup();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('leaves the toolbar and selection available when the composer cannot be found', () => {
    const cleanup = startQuoteReply({ highlightEnabled: false });
    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);
    document.getElementById('input-container')!.remove();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.querySelector<HTMLButtonElement>('.gv-quote-btn')!.click();
    expect(window.getSelection()?.toString()).toBe('Hello');
    expect(document.querySelector('.gv-selection-toolbar')?.classList.contains('gv-hidden')).toBe(
      false,
    );
    cleanup();
  });

  it('clears an open color preview and pending selection work on teardown and can mount again', () => {
    installHighlightConversation();
    const cleanup = startQuoteReply();
    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);
    document.querySelector<HTMLButtonElement>('.gv-highlight-color-trigger')!.click();
    document.querySelector<HTMLButtonElement>('[data-highlight-color="pink"]')!.click();
    expect(
      document.documentElement.classList.contains('gv-highlight-selection-preview-active'),
    ).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    cleanup();
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.gv-selection-toolbar')).toBeNull();
    expect(document.getElementById('gemini-voyager-quote-reply-style')).toBeNull();
    expect(
      document.documentElement.classList.contains('gv-highlight-selection-preview-active'),
    ).toBe(false);
    expect(
      document.documentElement.style.getPropertyValue('--gv-highlight-selection-preview-color'),
    ).toBe('');
    const stopAgain = startQuoteReply();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);
    expect(document.querySelectorAll('.gv-selection-toolbar')).toHaveLength(1);
    stopAgain();
  });

  it('applies a combined external palette and default-color change before saving a highlight', async () => {
    installHighlightConversation();
    const createFromRange = vi
      .spyOn(HighlightManager.prototype, 'createFromRange')
      .mockResolvedValue(true);
    const cleanup = startQuoteReply({ highlightDefaultColor: 'blue' });
    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);
    emitStorageChange(
      {
        [StorageKeys.HIGHLIGHT_COLOR_PALETTE]: {
          newValue: ['yellow', 'green', '#123456', 'pink', '#c084fc'],
        },
        [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: { newValue: '#123456' },
      },
      'sync',
    );
    // The old selected blue must not overwrite the incoming palette before the new default applies.
    expect(
      document.querySelector<HTMLElement>('[data-highlight-slot="0"]')?.dataset.highlightColor,
    ).toBe('yellow');
    const selectedSwatch = document.querySelector<HTMLButtonElement>(
      '.gv-highlight-color-option[aria-pressed="true"]',
    );
    expect(selectedSwatch?.dataset.highlightColor).toBe('#123456');
    expect(selectedSwatch?.getAttribute('aria-label')).toBe('Highlight color 3');
    expect(
      document.querySelector<HTMLButtonElement>('.gv-highlight-color-trigger')?.style
        .backgroundColor,
    ).toBe('rgb(18, 52, 86)');
    document.querySelector<HTMLButtonElement>('.gv-highlight-action')!.click();
    await Promise.resolve();
    expect(createFromRange).toHaveBeenCalledWith(expect.any(Range), '#123456');
    cleanup();
  });

  it('finishes an accepted insertion after the feature is stopped', () => {
    const cleanup = startQuoteReply({ highlightEnabled: false });
    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);
    document.querySelector<HTMLButtonElement>('.gv-quote-btn')!.click();
    const input = document.getElementById('input')!;
    expect(input.textContent).toBe('');
    cleanup();
    vi.advanceTimersByTime(200);
    expect(input.textContent).toBe('> Hello\n');
  });
});
