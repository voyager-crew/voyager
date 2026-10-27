import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { hasUnreadChangelog, showChangelogModalDirect } from '../../changelog/index';
import { readPromptPref, writePromptPref } from '../promptPrefs';
import { type PromptTrigger, mountPromptTrigger } from '../promptTrigger';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('../../changelog/index', () => ({
  hasUnreadChangelog: vi.fn(async () => false),
  showChangelogModalDirect: vi.fn(async () => true),
}));
vi.mock('../promptPrefs', () => ({
  readPromptPref: vi.fn(async (_key: string, fallback: unknown) => fallback),
  writePromptPref: vi.fn(async () => {}),
}));

let trigger: PromptTrigger | undefined;
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

async function mount(options: { hiddenByUser?: boolean; attention?: boolean; url?: string } = {}) {
  const onAttentionChange = vi.fn();
  const url = options.url ?? 'https://gemini.google.com/app';
  Object.defineProperty(window, 'location', { configurable: true, value: new URL(url) });
  const site = resolvePromptSiteAdapter(url);
  trigger = await mountPromptTrigger({
    mascotLogo: false,
    hiddenByUser: options.hiddenByUser ?? false,
    attention: options.attention ?? false,
    onAttentionChange,
    defaultSpot: (ballHeight) => site.defaultTriggerSpot(ballHeight),
  });
  return { ball: trigger.element, onAttentionChange };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  trigger?.destroy();
  trigger = undefined;
  vi.useRealTimers();
  Object.defineProperty(window, 'location', originalLocation);
});

describe('prompt trigger visibility', () => {
  it('stays visible while it announces release notes, even when the user hid it', async () => {
    const { ball } = await mount({ hiddenByUser: true, attention: true });

    expect(ball.style.display).toBe('');
    expect(ball.classList.contains('gv-pm-trigger-new')).toBe(true);
  });

  it('hides once the hidden ball has shown its release notes', async () => {
    const { ball, onAttentionChange } = await mount({ hiddenByUser: true, attention: true });

    await expect(trigger!.consumeAttention()).resolves.toBe(true);

    expect(showChangelogModalDirect).toHaveBeenCalledTimes(1);
    expect(onAttentionChange).toHaveBeenCalledWith(false);
    expect(trigger!.hasAttention).toBe(false);
    expect(ball.style.display).toBe('none');
  });

  it('reports whether hiding the Prompt Manager actually hid the ball', async () => {
    const { ball } = await mount({ attention: true });

    expect(trigger!.setHiddenByUser(true)).toBe(false);
    expect(ball.style.display).toBe('');

    await trigger!.consumeAttention();
    expect(trigger!.setHiddenByUser(true)).toBe(true);
    expect(ball.style.display).toBe('none');

    expect(trigger!.setHiddenByUser(false)).toBe(false);
    expect(ball.style.display).toBe('');
  });

  it('starts announcing when release notes become unread in badge mode', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'badge',
    } as never);
    vi.mocked(hasUnreadChangelog).mockResolvedValue(true);
    const { ball, onAttentionChange } = await mount({ hiddenByUser: true });
    expect(ball.style.display).toBe('none');

    trigger!.applyStorageChange('local', {
      [StorageKeys.CHANGELOG_DISMISSED_VERSION]: { newValue: undefined },
    });
    await flush();

    expect(onAttentionChange).toHaveBeenCalledWith(true);
    expect(ball.style.display).toBe('');
  });
});

describe('prompt trigger activation', () => {
  it('ignores clicks until enabled', async () => {
    const { ball } = await mount();
    const onActivate = vi.fn();

    ball.click();
    trigger!.enable(onActivate);
    ball.click();

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('opens the announced release notes instead of the panel', async () => {
    const { ball } = await mount({ attention: true });
    const onActivate = vi.fn();
    trigger!.enable(onActivate);

    ball.click();
    await flush();

    expect(showChangelogModalDirect).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
    ball.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('treats a press that moved as a drag: saves the position and swallows the click', async () => {
    const { ball } = await mount();
    const onActivate = vi.fn();
    trigger!.enable(onActivate);

    ball.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 40 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 40 }));
    await flush();
    ball.click();

    expect(writePromptPref).toHaveBeenCalledWith(
      StorageKeys.PROMPT_TRIGGER_POSITION,
      expect.objectContaining({ right: expect.any(Number), bottom: expect.any(Number) }),
    );
    expect(onActivate).not.toHaveBeenCalled();
    ball.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('prompt trigger default spot', () => {
  /** A Material FAB touch target laid out at the given viewport rect. */
  function mountMaterialFab(rect: DOMRect): void {
    const target = document.createElement('span');
    target.className = 'mat-mdc-button-touch-target';
    target.getBoundingClientRect = () => rect;
    document.body.appendChild(target);
  }

  it.each(['https://gemini.google.com/app', 'https://aistudio.google.com/prompts/new_chat'])(
    'sits beside the Material FAB on %s when the user never dragged it',
    async (url) => {
      mountMaterialFab(new DOMRect(900, 700, 40, 40));

      const { ball } = await mount({ url });

      // jsdom's viewport is 1024x768 and the ball reports no height, so 36 is assumed.
      expect(ball.style.right).toBe(`${1024 - 900 + 10}px`);
      expect(ball.style.bottom).toBe(`${768 - (700 + 20 + 18)}px`);
    },
  );

  it('keeps the stylesheet corner on a page without a Material FAB', async () => {
    const { ball } = await mount();

    expect(ball.style.right).toBe('');
    expect(ball.style.bottom).toBe('');
  });

  it('restores the dragged position instead of snapping to the FAB', async () => {
    mountMaterialFab(new DOMRect(900, 700, 40, 40));
    vi.mocked(readPromptPref).mockResolvedValueOnce({ right: 120, bottom: 90 });

    const { ball } = await mount();

    expect(ball.style.right).toBe('120px');
    expect(ball.style.bottom).toBe('90px');
  });

  it('follows a late FAB on the next frame and again after 350 ms while mounted', async () => {
    vi.useFakeTimers();
    const { ball } = await mount();
    expect(ball.style.right).toBe('');

    mountMaterialFab(new DOMRect(900, 700, 40, 40));
    vi.advanceTimersToNextFrame();
    expect(ball.style.right).toBe('134px');

    document.querySelector('.mat-mdc-button-touch-target')!.remove();
    mountMaterialFab(new DOMRect(800, 600, 40, 40));
    vi.advanceTimersByTime(350);
    expect(ball.style.right).toBe('234px');
    expect(ball.style.bottom).toBe('130px');
  });

  it('a destroyed prompt trigger still repositions itself after 350 ms', async () => {
    vi.useFakeTimers();
    mountMaterialFab(new DOMRect(900, 700, 40, 40));
    const { ball } = await mount();
    vi.advanceTimersToNextFrame();
    expect(ball.style.right).toBe('134px');

    trigger!.destroy();
    document.querySelector('.mat-mdc-button-touch-target')!.remove();
    mountMaterialFab(new DOMRect(800, 600, 40, 40));
    vi.advanceTimersByTime(350);

    expect(ball.style.right).toBe('134px');
    expect(ball.style.bottom).toBe('30px');
  });

  it('a destroyed prompt trigger still repositions itself on the next frame', async () => {
    vi.useFakeTimers();
    const { ball } = await mount();
    expect(ball.style.right).toBe('');
    trigger!.destroy();
    mountMaterialFab(new DOMRect(900, 700, 40, 40));

    vi.advanceTimersToNextFrame();

    expect(ball.style.right).toBe('');
    expect(ball.style.bottom).toBe('');
  });

  it.each([false, true])(
    'a saved prompt trigger position is constrained on the next frame only while mounted (destroyed=%s)',
    async (destroyed) => {
      vi.useFakeTimers();
      vi.mocked(readPromptPref).mockResolvedValueOnce({ right: 2000, bottom: 2000 });
      const { ball } = await mount();
      expect(ball.style.right).toBe('2000px');
      if (destroyed) trigger!.destroy();

      vi.advanceTimersToNextFrame();

      expect(ball.style.right).toBe(destroyed ? '2000px' : '974px');
      expect(ball.style.bottom).toBe(destroyed ? '2000px' : '718px');
    },
  );
});
