import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SafariICloudSyncError } from '@/core/utils/safariICloudSync';

import { CloudSyncSettings } from '../CloudSyncSettings';
import {
  baseState,
  createCloudSyncChromeMock as createChromeMock,
  flushMicrotasks,
} from './cloudSyncChromeMock';

const browserTarget = vi.hoisted(() => ({ value: 'chrome' }));
const deleteSafariICloudBackup = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) =>
      key === 'syncDeleteICloudSuccess'
        ? 'Deleted {count} records'
        : key === 'syncDeleteICloudFailed'
          ? 'Delete failed: {error}'
          : key,
  }),
}));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => browserTarget.value,
  isSafari: () => false,
}));

vi.mock('@/core/utils/safariICloudSync', async (original) => ({
  ...(await original<typeof import('@/core/utils/safariICloudSync')>()),
  deleteSafariICloudBackup,
}));

type MockedChrome = typeof chrome;

describe('CloudSyncSettings on Safari', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    browserTarget.value = 'chrome';
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('lets Safari users select iCloud without changing the sync mode', async () => {
    browserTarget.value = 'safari';
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.setProvider') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, provider: 'icloud' },
        });
      }
      return Promise.resolve({ ok: true });
    });
    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const iCloudButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'syncProviderICloud',
    );
    expect(iCloudButton).toBeDefined();
    await act(async () => {
      iCloudButton?.click();
    });

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'gv.sync.setProvider',
      payload: { provider: 'icloud' },
    });
    expect(container.textContent).toContain('cloudSyncDescriptionICloud');
  });

  it('gives unauthenticated Safari users a direct Google Drive connection link', async () => {
    browserTarget.value = 'safari';
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      return Promise.resolve({ ok: true });
    });
    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const connectLink = container.querySelector<HTMLAnchorElement>(
      'a[href="gemini-voyager://google-drive-auth"]',
    );
    expect(connectLink?.textContent).toBe('syncConnectGoogleDrive');
  });

  it('offers to change account once the Voyager app has connected Drive', async () => {
    browserTarget.value = 'safari';
    // Sync is off and the background only knows what it had before the app signed in.
    let nativeSignedIn = false;
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: { ...baseState, mode: 'disabled' } });
      }
      if (message.type === 'gv.sync.refreshAuthorization') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, mode: 'disabled', isAuthenticated: nativeSignedIn },
        });
      }
      return Promise.resolve({ ok: true });
    });
    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    const link = () =>
      container.querySelector<HTMLAnchorElement>('a[href="gemini-voyager://google-drive-auth"]');
    expect(link()?.textContent).toBe('syncConnectGoogleDrive');

    await act(async () => {
      link()?.addEventListener('click', (event) => event.preventDefault());
      link()?.click();
    });
    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'gv.sync.connectStarted' });

    // The app finishes signing in; the popup is focused again.
    nativeSignedIn = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flushMicrotasks();

    expect(link()?.textContent).toBe('syncChangeGoogleDriveAccount');
  });

  it('lets Safari users delete their iCloud backup without deleting local data', async () => {
    browserTarget.value = 'safari';
    deleteSafariICloudBackup.mockResolvedValue(3);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: { ...baseState, provider: 'icloud' } });
      }
      return Promise.resolve({ ok: true });
    });
    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'syncDeleteICloudBackup',
    );
    expect(deleteButton).toBeDefined();
    await act(async () => {
      deleteButton?.click();
    });

    expect(deleteSafariICloudBackup).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Deleted 3 records');
  });

  it('shows confirmed deletion progress alongside an error so partial deletion is reviewable', async () => {
    browserTarget.value = 'safari';
    deleteSafariICloudBackup.mockRejectedValue(
      Object.assign(new SafariICloudSyncError('Network unavailable', 'cloudkit_4', null), {
        deleted: 804,
        errors: [],
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sendMessageMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ok: true, state: { ...baseState, provider: 'icloud' } }),
      );
    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);
    const remove = vi.mocked(chrome.storage.local.remove);
    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    const button = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'syncDeleteICloudBackup',
    );
    await act(async () => {
      button?.click();
    });
    expect(container.textContent).toContain('Deleted 804 records');
    expect(container.textContent).toContain('Delete failed: Network unavailable');
    expect(remove).not.toHaveBeenCalled();
  });
});
