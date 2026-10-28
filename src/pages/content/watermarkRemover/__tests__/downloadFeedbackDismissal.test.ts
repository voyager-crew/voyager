import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastDriver } from '@/tests/toastDriver';
import { setCachedLanguage } from '@/utils/i18n';

import { startWatermarkRemover, stopWatermarkRemover } from './runtimeHarness';

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  vi.useFakeTimers();
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.getElementById('gv-watermark-bridge')?.remove();
  await setCachedLanguage('en');
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
    gvWatermarkDownloadEnabled: true,
    gvWatermarkPreviewEnabled: false,
  }));
});

afterEach(() => {
  stopWatermarkRemover();
  vi.useRealTimers();
});

async function startDownload(): Promise<HTMLElement> {
  // The real caller starts feedback before the watermark assets finish loading.
  void startWatermarkRemover();
  await settle();
  const image = document.createElement('generated-image');
  const button = document.createElement('button');
  button.dataset.testId = 'download-generated-image-button';
  image.append(button);
  document.body.append(image);
  button.click();
  const bridge = document.getElementById('gv-watermark-bridge');
  expect(bridge?.dataset.downloadIntentToken).toBeTruthy();
  return bridge!;
}

async function status(bridge: HTMLElement, type: string): Promise<void> {
  bridge.dataset.status = JSON.stringify({
    type,
    message: 'temporary failure',
    intentToken: bridge.dataset.downloadIntentToken,
  });
  await settle();
}

describe('watermark download notice dismissal', () => {
  it.each([
    { notice: 'initial download', elapsed: 0, statusType: null, tone: 'info', pending: true },
    { notice: 'processing fallback', elapsed: 3000, statusType: null, tone: 'info', pending: true },
    {
      notice: 'large-file warning',
      elapsed: 0,
      statusType: 'DOWNLOADING_LARGE',
      tone: 'warning',
      pending: false,
    },
    {
      notice: 'final success before processing',
      elapsed: 0,
      statusType: 'SUCCESS',
      tone: 'success',
      pending: false,
    },
    {
      notice: 'final success after processing',
      elapsed: 3000,
      statusType: 'SUCCESS',
      tone: 'success',
      pending: false,
    },
    { notice: 'final error', elapsed: 3000, statusType: 'ERROR', tone: 'error', pending: false },
    {
      notice: 'final corruption warning',
      elapsed: 3000,
      statusType: 'GOOGLE_IMAGE_CORRUPTED',
      tone: 'warning',
      pending: false,
    },
  ])(
    'the $notice remains manually dismissible through the download caller',
    async ({ elapsed, statusType, tone, pending }) => {
      const bridge = await startDownload();
      if (elapsed) vi.advanceTimersByTime(elapsed);
      if (statusType) await status(bridge, statusType);
      const notice = toastDriver
        .all()
        .find((toast) => toast.tone === tone && toast.pending === pending);
      expect(notice).toBeDefined();
      expect(toastDriver.labels(notice!)).toContain('Close');
      const before = toastDriver.all().length;
      toastDriver.press(notice!, 'Close');
      expect(notice!.element.isConnected).toBe(false);
      expect(toastDriver.all()).toHaveLength(before - 1);
      expect(bridge.dataset.downloadIntentToken).toBeTruthy();
    },
  );

  it('a delayed downloading status does not reopen a dismissed download notice', async () => {
    const bridge = await startDownload();
    const token = bridge.dataset.downloadIntentToken;
    const expiresAt = bridge.dataset.downloadIntentExpiresAt;
    toastDriver.press(toastDriver.all()[0], 'Close');

    await status(bridge, 'DOWNLOADING');
    expect(toastDriver.all()).toEqual([]);
    expect(bridge.dataset.downloadIntentToken).toBe(token);
    expect(bridge.dataset.downloadIntentExpiresAt).toBe(expiresAt);
  });

  it('a large-file status does not reopen the dismissed downloading phase', async () => {
    const bridge = await startDownload();
    toastDriver.press(toastDriver.all()[0], 'Close');

    await status(bridge, 'DOWNLOADING_LARGE');
    expect(toastDriver.all().map((notice) => notice.tone)).toEqual(['warning']);
  });

  it.each([
    { type: 'SUCCESS', tone: 'success' },
    { type: 'ERROR', tone: 'error' },
    { type: 'GOOGLE_IMAGE_CORRUPTED', tone: 'warning' },
  ])('closing the download notice still allows the $type outcome', async ({ type, tone }) => {
    const bridge = await startDownload();
    toastDriver.press(toastDriver.all()[0], 'Close');

    await status(bridge, type);
    expect(toastDriver.all()).toHaveLength(1);
    expect(toastDriver.all()[0]).toMatchObject({ tone, pending: false });
  });

  it('closing one download notice still allows processing and a new download', async () => {
    const bridge = await startDownload();
    const token = bridge.dataset.downloadIntentToken;
    toastDriver.press(toastDriver.all()[0], 'Close');

    vi.advanceTimersByTime(3000);
    expect(toastDriver.all()).toHaveLength(1);
    expect(toastDriver.all()[0]).toMatchObject({ tone: 'info', pending: true });
    toastDriver.press(toastDriver.all()[0], 'Close');

    document.querySelector<HTMLButtonElement>('generated-image button')!.click();
    expect(bridge.dataset.downloadIntentToken).not.toBe(token);
    expect(toastDriver.all()).toHaveLength(1);
    await status(bridge, 'DOWNLOADING');
    expect(toastDriver.all()).toHaveLength(1);
  });

  it('closing an older download notice does not suppress a newer download', async () => {
    const bridge = await startDownload();
    const [olderNotice] = toastDriver.all();
    vi.advanceTimersByTime(301);
    document.querySelector<HTMLButtonElement>('generated-image button')!.click();
    const newerNotice = toastDriver.all().find((notice) => notice.element !== olderNotice.element)!;
    toastDriver.press(olderNotice, 'Close');

    // Expiry is not user dismissal; a matching status can renew the new notice.
    vi.advanceTimersByTime(3001);
    expect(newerNotice.element.isConnected).toBe(false);
    expect(toastDriver.all()).toHaveLength(1); // The processing phase has started.
    await status(bridge, 'DOWNLOADING');
    expect(toastDriver.all()).toHaveLength(2);
    expect(toastDriver.all()[0]).toMatchObject({ tone: 'info', pending: true });
  });

  it('uses the localized close button while downloading', async () => {
    await setCachedLanguage('zh');
    await startDownload();
    const [notice] = toastDriver.all();
    expect(toastDriver.labels(notice)).toContain('关闭');
    toastDriver.press(notice, '关闭');
    expect(toastDriver.all()).toEqual([]);
  });
});
