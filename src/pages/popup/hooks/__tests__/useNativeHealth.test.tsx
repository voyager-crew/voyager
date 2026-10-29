import React, { act, useEffect, useMemo } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NATIVE_HEALTH_STATUS_MESSAGE, type NativeHealthEntry } from '@/core/gemini/nativeHealth';
import { StorageKeys } from '@/core/types/common';

import { NATIVE_HEALTH_REPOLL_MS, useNativeHealth } from '../useNativeHealth';

const { polyfill } = vi.hoisted(() => ({
  polyfill: {
    tabs: { sendMessage: vi.fn() },
    storage: { local: { get: vi.fn(), set: vi.fn() } },
  },
}));

vi.mock('webextension-polyfill', () => ({ default: polyfill }));

const GEMINI_URL = 'https://gemini.google.com/app/0123456789abcdef';

const timelineBroken: NativeHealthEntry = {
  feature: 'timeline',
  anchor: 'turn.user',
  status: 'broken',
  route: 'conversation',
  firstSeenAt: 1_790_000_000_000,
  lastSeenAt: 1_790_000_010_000,
  extensionVersion: '1.7.3',
};

type Health = ReturnType<typeof useNativeHealth>;

describe('useNativeHealth', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: Health;

  function Probe({ tabId, url }: { tabId: number | null; url: string }) {
    const requestTab = useMemo(
      () =>
        tabId === null
          ? null
          : (request: unknown) => polyfill.tabs.sendMessage(tabId, request) as Promise<unknown>,
      [tabId],
    );
    const health = useNativeHealth({ activeUrl: url, requestTab });
    useEffect(() => {
      latest = health;
    });
    return null;
  }

  async function mount(tabId: number | null, url: string) {
    await act(async () => {
      root.render(<Probe tabId={tabId} url={url} />);
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    polyfill.storage.local.get.mockResolvedValue({});
    polyfill.storage.local.set.mockResolvedValue(undefined);
    polyfill.tabs.sendMessage.mockResolvedValue({ ok: true, entries: [timelineBroken] });
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('asks the active Gemini tab, then once more after the grace period', async () => {
    await mount(7, GEMINI_URL);
    expect(polyfill.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: NATIVE_HEALTH_STATUS_MESSAGE,
    });
    expect(latest.visibleEntries).toEqual([timelineBroken]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_HEALTH_REPOLL_MS);
    });
    expect(polyfill.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not message tabs outside Gemini', async () => {
    await mount(7, 'https://claude.ai/new');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_HEALTH_REPOLL_MS);
    });
    expect(polyfill.tabs.sendMessage).not.toHaveBeenCalled();
    expect(latest.entries).toEqual([]);
  });

  it('shows nothing when the tab has no content script yet', async () => {
    polyfill.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
    await mount(7, GEMINI_URL);
    expect(latest.visibleEntries).toEqual([]);
  });

  it('drops malformed entries from the page', async () => {
    polyfill.tabs.sendMessage.mockResolvedValue({
      ok: true,
      entries: [{ ...timelineBroken, anchor: 'https://gemini.google.com/app/x' }],
    });
    await mount(7, GEMINI_URL);
    expect(latest.entries).toEqual([]);
  });

  it('remembers a dismissal for this extension version only', async () => {
    polyfill.storage.local.get.mockResolvedValue({
      [StorageKeys.NATIVE_HEALTH_DISMISSED]: { 'export:turn.user@1.7.2': true },
    });
    await mount(7, GEMINI_URL);
    expect(latest.visibleEntries).toEqual([timelineBroken]);

    await act(async () => latest.dismiss());
    expect(latest.visibleEntries).toEqual([]);
    expect(polyfill.storage.local.set).toHaveBeenCalledWith({
      [StorageKeys.NATIVE_HEALTH_DISMISSED]: { 'timeline:turn.user@1.7.3': true },
    });
  });

  it('keeps a dismissed notice hidden on the next popup open', async () => {
    polyfill.storage.local.get.mockResolvedValue({
      [StorageKeys.NATIVE_HEALTH_DISMISSED]: { 'timeline:turn.user@1.7.3': true },
    });
    await mount(7, GEMINI_URL);
    expect(latest.entries).toEqual([timelineBroken]);
    expect(latest.visibleEntries).toEqual([]);
  });
});
