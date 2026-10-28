import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChangelogModal } from '../modal';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('changelog modal', () => {
  it('loads the requested language before rendering its controls', async () => {
    const overlay = await createChangelogModal('<p>Notes</p>', 'ja');

    expect(overlay.querySelector('.gv-changelog-close')?.getAttribute('aria-label')).toBe('閉じる');
  });

  it.each(['.gv-changelog-close', '.gv-changelog-got-it', 'outside'])(
    'closes a regular release through %s',
    async (control) => {
      const overlay = await createChangelogModal('<p>Notes</p>', 'en');
      document.body.appendChild(overlay);

      const target = control === 'outside' ? overlay : overlay.querySelector<HTMLElement>(control);
      target?.click();

      expect(overlay.isConnected).toBe(false);
    },
  );

  it('keeps a regular release open when clicking inside the dialog', async () => {
    const overlay = await createChangelogModal('<p>Notes</p>', 'en');
    document.body.appendChild(overlay);

    overlay.querySelector<HTMLElement>('.gv-changelog-body')?.click();

    expect(overlay.isConnected).toBe(true);
  });

  it('requires an explicit close after the force-popup reading gate finishes', async () => {
    vi.useFakeTimers();
    const overlay = await createChangelogModal('<p>Notes</p>', 'en', 2);
    document.body.appendChild(overlay);
    const close = overlay.querySelector<HTMLButtonElement>('.gv-changelog-close')!;
    const gotIt = overlay.querySelector<HTMLButtonElement>('.gv-changelog-got-it')!;

    expect(close.disabled).toBe(true);
    expect(gotIt.disabled).toBe(true);
    close.click();
    gotIt.click();
    overlay.click();
    expect(overlay.isConnected).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(gotIt.textContent).toMatch(/\(1\)$/);
    expect(gotIt.disabled).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(close.disabled).toBe(false);
    expect(gotIt.disabled).toBe(false);
    expect(gotIt.textContent).not.toMatch(/\(\d+\)$/);
    expect(vi.getTimerCount()).toBe(0);

    overlay.click();
    expect(overlay.isConnected).toBe(true);
    gotIt.click();
    expect(overlay.isConnected).toBe(false);
  });

  it.each(['click', 'Escape'])(
    'closes an image preview through %s and releases its keyboard listener',
    async (action) => {
      const overlay = await createChangelogModal(
        '<img src="https://example.com/image.png" alt="Preview">',
        'en',
      );
      document.body.appendChild(overlay);
      const removeListener = vi.spyOn(document, 'removeEventListener');

      overlay.querySelector<HTMLElement>('img')?.click();
      const lightbox = document.querySelector<HTMLElement>('.gv-changelog-lightbox')!;
      expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(
        'https://example.com/image.png',
      );
      expect(lightbox.querySelector('img')?.alt).toBe('Preview');

      if (action === 'click') lightbox.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(lightbox.isConnected).toBe(false);
      expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(overlay.isConnected).toBe(true);
    },
  );
});
