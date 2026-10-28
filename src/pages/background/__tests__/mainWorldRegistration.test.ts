import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createMainWorldRegistration } from '../mainWorldRegistration';

const platform = vi.hoisted(() => ({ target: 'chrome', firefox: false }));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => platform.target,
  isFirefox: () => platform.firefox,
}));
const injectOpenTabs = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../watermarkOpenTabs', () => ({
  injectWatermarkInterceptorIntoOpenTabs: injectOpenTabs,
}));

const originalScripting = Object.getOwnPropertyDescriptor(chrome, 'scripting');

describe('MAIN-world registrations', () => {
  const registerContentScripts = vi.fn(
    async (_scripts: chrome.scripting.RegisteredContentScript[]) => {},
  );
  const unregisterContentScripts = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    platform.target = 'chrome';
    platform.firefox = false;
    registerContentScripts.mockClear();
    unregisterContentScripts.mockClear();
    injectOpenTabs.mockClear();
    Object.defineProperty(chrome, 'scripting', {
      value: { registerContentScripts, unregisterContentScripts },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScripting) Object.defineProperty(chrome, 'scripting', originalScripting);
    else Reflect.deleteProperty(chrome, 'scripting');
  });

  it('keeps watermark interception off Business while observing completion there', async () => {
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation(async () => ({
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
      [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: true,
    }));
    const registration = createMainWorldRegistration();
    await registration.registerFetchInterceptor();
    await registration.syncResponseCompleteObserverRegistration();

    const scripts = registerContentScripts.mock.calls.flatMap(([registered]) => registered);
    const fetch = scripts.find((script) => script.id === 'gv-fetch-interceptor');
    const response = scripts.find((script) => script.id === 'gv-response-complete-observer');
    expect(new Set(fetch?.matches)).toEqual(
      new Set([
        'https://gemini.google.com/*',
        'https://aistudio.google.com/*',
        'https://aistudio.google.cn/*',
      ]),
    );
    expect(new Set(response?.matches)).toEqual(
      new Set([
        'https://gemini.google.com/*',
        'https://business.gemini.google/*',
        'https://aistudio.google.com/*',
        'https://aistudio.google.cn/*',
      ]),
    );
  });

  it('serializes an enable followed by disable while an earlier settings read is pending', async () => {
    let finishRead!: (value: Record<string, unknown>) => void;
    const pendingRead = new Promise<Record<string, unknown>>((resolve) => {
      finishRead = resolve;
    });
    const read = vi.spyOn(chrome.storage.sync, 'get');
    read.mockImplementationOnce(() => pendingRead);
    read.mockImplementationOnce(async () => ({
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: false,
    }));
    const registration = createMainWorldRegistration();

    const enable = registration.registerFetchInterceptor(true);
    const disable = registration.registerFetchInterceptor(true);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    finishRead({ [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true });
    await Promise.all([enable, disable]);

    expect(registerContentScripts).toHaveBeenCalledTimes(1);
    expect(registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'gv-fetch-interceptor', world: 'MAIN' }),
    ]);
    expect(unregisterContentScripts).toHaveBeenCalledTimes(2);
    expect(injectOpenTabs).toHaveBeenCalledTimes(1);
    expect(registerContentScripts.mock.invocationCallOrder[0]).toBeLessThan(
      unregisterContentScripts.mock.invocationCallOrder[1],
    );
  });

  it('removes a stale Safari interceptor without reading settings or adding a dynamic copy', async () => {
    platform.target = 'safari';
    const read = vi.spyOn(chrome.storage.sync, 'get');
    await createMainWorldRegistration().registerFetchInterceptor(true);
    expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ['gv-fetch-interceptor'] });
    expect(read).not.toHaveBeenCalled();
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(injectOpenTabs).not.toHaveBeenCalled();
  });

  // #1072: watermark download was switched off on every Android browser.
  it('registers the download interceptor on Android too, where watermark download now runs', async () => {
    const runtime = chrome.runtime as unknown as { getPlatformInfo?: () => Promise<unknown> };
    runtime.getPlatformInfo = async () => ({ os: 'android' });
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation((async () => ({
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: true,
    })) as never);
    try {
      // A fresh module: the platform is read once per background lifetime.
      vi.resetModules();
      const fresh = await import('../mainWorldRegistration');
      await fresh.createMainWorldRegistration().registerFetchInterceptor(true);
      expect(registerContentScripts).toHaveBeenCalled();
    } finally {
      delete runtime.getPlatformInfo;
    }
  });

  it.each(['firefox', 'safari'])(
    'cleans up response observers without adding MAIN-world copies on %s',
    async (target) => {
      platform.target = target;
      platform.firefox = target === 'firefox';
      const read = vi.spyOn(chrome.storage.sync, 'get');
      await createMainWorldRegistration().syncResponseCompleteObserverRegistration();
      expect(unregisterContentScripts).toHaveBeenCalledWith({
        ids: ['gv-response-complete-observer'],
      });
      expect(read).not.toHaveBeenCalled();
      expect(registerContentScripts).not.toHaveBeenCalled();
    },
  );
});
