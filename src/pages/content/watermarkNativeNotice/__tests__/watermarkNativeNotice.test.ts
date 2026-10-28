import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { isSafari } from '@/core/utils/browser';
import { packagedPluginRunsHere } from '@/features/plugins/runtime/packagedFormFactor';
import * as translations from '@/utils/translations';

import {
  CLEAN_IMAGE_STREAK_CAP,
  hasCleanImageStreak,
  nextCleanStreak,
  recordWatermarkPresence,
} from '../cleanStreak';
import { shouldShowWatermarkNativeNotice, startWatermarkNativeNotice } from '../index';

vi.mock('@/core/utils/browser', () => ({
  isSafari: vi.fn(() => false),
}));

vi.mock('@/features/plugins/runtime/packagedFormFactor', () => ({
  packagedPluginRunsHere: vi.fn(async () => true),
}));

vi.mock('@/utils/i18n', () => ({
  getCurrentLanguage: vi.fn(async () => 'zh'),
}));

type StorageState = Record<string, unknown>;

type MockFn = ReturnType<typeof vi.fn>;

function mockLocalStorage(state: StorageState): void {
  (chrome.storage.local.get as unknown as MockFn).mockImplementation(
    (defaults: Record<string, unknown>, callback?: (result: StorageState) => void) => {
      const merged = { ...defaults, ...state };
      if (typeof callback === 'function') {
        callback(merged);
        return undefined;
      }
      return Promise.resolve(merged);
    },
  );
  (chrome.storage.local.set as unknown as MockFn).mockImplementation(
    (values: StorageState, callback?: () => void) => {
      Object.assign(state, values);
      callback?.();
      return Promise.resolve();
    },
  );
}

function mockSyncStorage(state: StorageState): void {
  (chrome.storage.sync.get as unknown as MockFn).mockImplementation(() => Promise.resolve(state));
  (chrome.storage.sync.set as unknown as MockFn).mockImplementation((values: StorageState) => {
    Object.assign(state, values);
    return Promise.resolve();
  });
}

describe('shouldShowWatermarkNativeNotice', () => {
  it('shows once while Voyager removal is still doing work', () => {
    expect(shouldShowWatermarkNativeNotice({ alreadyShown: false, removalActive: true })).toBe(
      true,
    );
  });

  it('never repeats after the user has seen it', () => {
    expect(shouldShowWatermarkNativeNotice({ alreadyShown: true, removalActive: true })).toBe(
      false,
    );
  });

  it('stays silent for users who already turned removal off', () => {
    expect(shouldShowWatermarkNativeNotice({ alreadyShown: false, removalActive: false })).toBe(
      false,
    );
  });
});

describe('clean image streak', () => {
  it('counts consecutive watermark-free images', () => {
    expect(nextCleanStreak(0, 'none')).toBe(1);
    expect(nextCleanStreak(1, 'none')).toBe(2);
  });

  it('resets as soon as any watermark is found', () => {
    expect(nextCleanStreak(5, 'reliable')).toBe(0);
    expect(nextCleanStreak(5, 'difficult')).toBe(0);
  });

  it('treats corrupted stored values as zero', () => {
    expect(nextCleanStreak(undefined, 'none')).toBe(1);
    expect(nextCleanStreak('3', 'none')).toBe(1);
    expect(nextCleanStreak(Number.NaN, 'none')).toBe(1);
    expect(nextCleanStreak(-4, 'none')).toBe(1);
  });

  it('caps the stored counter', () => {
    expect(nextCleanStreak(CLEAN_IMAGE_STREAK_CAP, 'none')).toBe(CLEAN_IMAGE_STREAK_CAP);
  });

  it('reports the streak only at the threshold', () => {
    expect(hasCleanImageStreak(2)).toBe(false);
    expect(hasCleanImageStreak(3)).toBe(true);
    expect(hasCleanImageStreak(undefined)).toBe(false);
  });
});

describe('recordWatermarkPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments the stored streak for a clean image', async () => {
    const state: StorageState = { [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: 1 };
    mockLocalStorage(state);

    await recordWatermarkPresence('none');

    expect(state[StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]).toBe(2);
  });

  it('resets the streak when a watermark is removed', async () => {
    const state: StorageState = { [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: 2 };
    mockLocalStorage(state);

    await recordWatermarkPresence('reliable');

    expect(state[StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]).toBe(0);
  });

  it('stops writing once the threshold is reached', async () => {
    const state: StorageState = { [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: 3 };
    mockLocalStorage(state);

    await recordWatermarkPresence('none');

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(state[StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]).toBe(3);
  });

  it('skips redundant writes when the value would not change', async () => {
    const state: StorageState = { [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: 0 };
    mockLocalStorage(state);

    await recordWatermarkPresence('difficult');

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe('startWatermarkNativeNotice', () => {
  let cleanup: (() => void) | null = null;
  const legacyEnabled = { [StorageKeys.WATERMARK_REMOVER_ENABLED]: true };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.mocked(isSafari).mockReturnValue(false);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  it('still displays the notice in English when the selected language cannot load', async () => {
    vi.spyOn(translations, 'loadTranslations').mockRejectedValueOnce(
      new Error('locale chunk unavailable'),
    );
    mockLocalStorage({});
    mockSyncStorage(legacyEnabled);
    cleanup = startWatermarkNativeNotice(0);

    await flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('.gv-wm-notice__title')?.textContent).toBe(
      translations.getLoadedTranslations('en')?.watermarkNotice_title,
    );
    expect(document.querySelector('.gv-wm-notice__btn--primary')).not.toBeNull();
  });

  it('does not revive a stopped notice when its language finishes loading', async () => {
    const messages = await translations.loadTranslations('zh');
    let finishLoading!: (loaded: typeof messages) => void;
    vi.spyOn(translations, 'loadTranslations').mockReturnValueOnce(
      new Promise((resolve) => {
        finishLoading = resolve;
      }),
    );
    const onSettled = vi.fn();
    mockLocalStorage({});
    mockSyncStorage(legacyEnabled);
    cleanup = startWatermarkNativeNotice({ delayMs: 0, onSettled });
    await flush();

    cleanup();
    cleanup = null;
    finishLoading(messages);
    await flush();

    expect(document.querySelector('.gv-wm-notice')).toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('shows the dialog with steps once the delay elapses', async () => {
    mockLocalStorage({});
    mockSyncStorage(legacyEnabled);

    cleanup = startWatermarkNativeNotice(1000);
    await flush();
    expect(document.querySelector('.gv-wm-notice')).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);

    const notice = document.querySelector('.gv-wm-notice');
    const dialog = notice?.querySelector('.gv-wm-notice__dialog');
    expect(notice?.textContent).toContain('Gemini 现在可以关闭可见水印');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.hasAttribute('aria-modal')).toBe(false);
    // The path renders as a breadcrumb: Settings → Media watermark → Off.
    const hops = dialog?.querySelectorAll('.gv-wm-notice__trail-hop');
    expect(hops).toHaveLength(3);
    expect(hops?.[hops.length - 1].textContent).toBe('Off');
    expect(hops?.[hops.length - 1].classList).toContain('gv-wm-notice__trail-hop--target');
    // The clean-image hint only appears once the streak has been observed.
    expect(dialog?.querySelector('.gv-wm-notice__detected')).toBeNull();
  });

  it('only handles Escape while focus is inside the non-modal card', async () => {
    mockLocalStorage({});
    mockSyncStorage(legacyEnabled);

    cleanup = startWatermarkNativeNotice(0);
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.gv-wm-notice')).not.toBeNull();

    const closeBtn = document.querySelector<HTMLButtonElement>('.gv-wm-notice__close');
    closeBtn?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect(document.querySelector('.gv-wm-notice')).toBeNull();
  });

  it('adds the detected hint after a clean-image streak', async () => {
    mockLocalStorage({ [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: 3 });
    mockSyncStorage(legacyEnabled);

    cleanup = startWatermarkNativeNotice(0);
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('.gv-wm-notice__detected')).not.toBeNull();
  });

  it('stays away when the user already turned removal off', async () => {
    const onSettled = vi.fn();
    mockLocalStorage({});
    mockSyncStorage({
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: false,
      [StorageKeys.WATERMARK_PREVIEW_ENABLED]: false,
    });

    cleanup = startWatermarkNativeNotice({ delayMs: 0, onSettled });
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    expect(document.querySelector('.gv-wm-notice')).toBeNull();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('stays away on a phone, where the removal it would retire never runs', async () => {
    const onSettled = vi.fn();
    vi.mocked(packagedPluginRunsHere).mockResolvedValue(false);
    mockLocalStorage({});
    mockSyncStorage(legacyEnabled);

    cleanup = startWatermarkNativeNotice({ delayMs: 0, onSettled });
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    expect(document.querySelector('.gv-wm-notice')).toBeNull();
    expect(onSettled).toHaveBeenCalledOnce();
    vi.mocked(packagedPluginRunsHere).mockResolvedValue(true);
  });

  it('stays away for a user with no watermark preference', async () => {
    mockLocalStorage({});
    mockSyncStorage({});

    cleanup = startWatermarkNativeNotice(0);
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    expect(document.querySelector('.gv-wm-notice')).toBeNull();
  });

  it('stays away after it has been shown once', async () => {
    mockLocalStorage({ [StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]: true });
    mockSyncStorage({});

    cleanup = startWatermarkNativeNotice(0);
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    expect(document.querySelector('.gv-wm-notice')).toBeNull();
  });

  it('shows on Safari when its watermark-removal setting is still active', async () => {
    vi.mocked(isSafari).mockReturnValue(true);
    mockLocalStorage({});
    mockSyncStorage(legacyEnabled);

    cleanup = startWatermarkNativeNotice(0);
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    expect(document.querySelector('.gv-wm-notice')).not.toBeNull();
  });

  it('turns both removal paths off when the user confirms', async () => {
    const localState: StorageState = {};
    const syncState: StorageState = { ...legacyEnabled };
    mockLocalStorage(localState);
    mockSyncStorage(syncState);

    cleanup = startWatermarkNativeNotice(0);
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    const disableBtn = document.querySelector<HTMLButtonElement>('.gv-wm-notice__btn--primary');
    expect(disableBtn?.textContent).toBe('已设为 Off，关闭 Voyager 去水印');
    disableBtn?.click();
    await flush();

    expect(syncState[StorageKeys.WATERMARK_DOWNLOAD_ENABLED]).toBe(false);
    expect(syncState[StorageKeys.WATERMARK_PREVIEW_ENABLED]).toBe(false);
    // The legacy key is deliberately left untouched.
    expect(syncState[StorageKeys.WATERMARK_REMOVER_ENABLED]).toBe(true);
    expect(localState[StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]).toBe(true);
    expect(document.querySelector('.gv-wm-notice__done')).not.toBeNull();
  });

  it('keeps the notice open and retryable when disabling storage fails', async () => {
    const localState: StorageState = {};
    const syncState: StorageState = { ...legacyEnabled };
    const onSettled = vi.fn();
    mockLocalStorage(localState);
    mockSyncStorage(syncState);
    (chrome.storage.sync.set as unknown as MockFn).mockRejectedValue(new Error('write failed'));

    cleanup = startWatermarkNativeNotice({ delayMs: 0, onSettled });
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    document.querySelector<HTMLButtonElement>('.gv-wm-notice__btn--primary')?.click();
    await flush();

    expect(localState[StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]).toBeUndefined();
    expect(document.querySelector('.gv-wm-notice')).not.toBeNull();
    expect(document.querySelector('.gv-wm-notice__error')?.textContent).toBe(
      '未能更新设置，请重试。',
    );
    expect(document.querySelector<HTMLButtonElement>('.gv-wm-notice__btn--primary')?.disabled).toBe(
      false,
    );
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('marks the notice seen when dismissed without changing settings', async () => {
    const localState: StorageState = {};
    const syncState: StorageState = { ...legacyEnabled };
    const onSettled = vi.fn();
    mockLocalStorage(localState);
    mockSyncStorage(syncState);

    cleanup = startWatermarkNativeNotice({ delayMs: 0, onSettled });
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    document.querySelector<HTMLButtonElement>('.gv-wm-notice__btn--secondary')?.click();
    await flush();

    expect(localState[StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]).toBe(true);
    expect(syncState[StorageKeys.WATERMARK_DOWNLOAD_ENABLED]).toBeUndefined();
    expect(document.querySelector('.gv-wm-notice')).toBeNull();
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
