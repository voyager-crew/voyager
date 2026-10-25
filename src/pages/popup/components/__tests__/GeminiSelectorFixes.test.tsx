import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import {
  GEMINI_SELECTOR_REFRESH_MESSAGE,
  GEMINI_SELECTOR_SET_ENABLED_MESSAGE,
  GEMINI_SELECTOR_STATUS_MESSAGE,
  type GeminiSelectorResponse,
  type GeminiSelectorStatus,
} from '@/features/geminiSelectorFixes/messages';
import { TRANSLATIONS, type TranslationKey } from '@/utils/translations';

import { useActivePopupTab } from '../../hooks/useActivePopupTab';
import {
  type GeminiSelectorFixesControl,
  useGeminiSelectorFixes,
} from '../../hooks/useGeminiSelectorFixes';
import { GeminiSelectorFixesCard } from '../GeminiSelectorFixesCard';

const api = vi.hoisted(() => ({
  tabs: { get: vi.fn(), query: vi.fn(), reload: vi.fn() },
  runtime: { sendMessage: vi.fn() },
  storage: {
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    local: { set: vi.fn() },
    sync: { set: vi.fn() },
  },
}));

vi.mock('webextension-polyfill', () => ({ default: api }));

interface Request {
  type: string;
  host: string;
  tabId?: number;
  enabled?: boolean;
  force?: boolean;
}

type StorageListener = (
  changes: Record<string, browser.Storage.StorageChange>,
  area: string,
) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function tab(id: number, url: string): browser.Tabs.Tab {
  return { id, url, index: 0, active: true, highlighted: true, pinned: false, incognito: false };
}

const translate = (key: TranslationKey) => TRANSLATIONS.en[key];

describe('Gemini selector fixes popup', () => {
  let root: Root;
  let container: HTMLDivElement;
  let control: GeminiSelectorFixesControl;
  let refreshSource: () => Promise<void>;
  let channel: Omit<GeminiSelectorStatus, 'result'>;
  let sent: Request[];
  let listeners: Set<StorageListener>;
  let onRefresh: () => Promise<GeminiSelectorResponse>;
  let onSet: (enabled: boolean) => Promise<GeminiSelectorResponse>;

  function emitConsent(enabled: boolean) {
    for (const listener of listeners) {
      listener({ [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: { newValue: enabled } }, 'local');
    }
  }

  function Harness({ sourceTabId, show = true }: { sourceTabId?: number; show?: boolean }) {
    const context = useActivePopupTab(sourceTabId);
    const fixes = useGeminiSelectorFixes(context, sourceTabId);
    useEffect(() => {
      control = fixes;
      refreshSource = context.refreshActiveTabContext;
    });
    return <GeminiSelectorFixesCard control={fixes} isVisible={() => show} t={translate} />;
  }

  const render = async (props: { sourceTabId?: number; show?: boolean } = {}) => {
    await act(async () => root.render(<Harness {...props} />));
  };
  const toggle = () => container.querySelector<HTMLInputElement>('#gemini-selector-fixes');
  const manual = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === translate('geminiSelectorFixesCheckNow'),
    );
  const requests = (type: string) => sent.filter((request) => request.type === type);
  // Without a verified Gemini source tab the popup may only read consent, never name a tab.
  const onlyTablessStatusReads = (from = 0) =>
    sent
      .slice(from)
      .every(
        (request) => request.type === GEMINI_SELECTOR_STATUS_MESSAGE && request.tabId === undefined,
      );

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    channel = {
      ok: true,
      enabled: false,
      buildEnabled: true,
      cachedRevision: null,
      lastAttemptAt: null,
    };
    sent = [];
    listeners = new Set();
    api.storage.onChanged.addListener.mockImplementation((listener: StorageListener) => {
      listeners.add(listener);
    });
    api.storage.onChanged.removeListener.mockImplementation((listener: StorageListener) => {
      listeners.delete(listener);
    });
    onRefresh = async () => ({ ...channel, result: 'upToDate' });
    onSet = async (enabled) => {
      channel = { ...channel, enabled, cachedRevision: enabled ? channel.cachedRevision : null };
      emitConsent(enabled);
      return channel;
    };
    api.runtime.sendMessage.mockImplementation(async (message: Request) => {
      sent.push(message);
      if (message.type === GEMINI_SELECTOR_STATUS_MESSAGE) return channel;
      if (message.type === GEMINI_SELECTOR_SET_ENABLED_MESSAGE)
        return onSet(message.enabled === true);
      if (message.type === GEMINI_SELECTOR_REFRESH_MESSAGE) return onRefresh();
      return undefined;
    });
    api.tabs.query.mockResolvedValue([tab(7, 'https://gemini.google.com/u/1/app/abc')]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('waits for the actual source URL instead of the initial Gemini placeholder', async () => {
    const source = deferred<browser.Tabs.Tab[]>();
    api.tabs.query.mockReturnValue(source.promise);
    await render();
    expect(toggle()).toBeNull();
    expect(sent).toEqual([]);

    await act(async () => source.resolve([tab(7, 'https://aistudio.google.com/prompts/new')]));
    expect(toggle()).toBeNull();
    expect(onlyTablessStatusReads()).toBe(true);
  });

  it.each([
    'https://aistudio.google.com/prompts/new',
    'https://aistudio.google.com/u/2/prompts/new',
    'http://gemini.google.com/app',
    'https://gemini.google.com:8443/app',
    'https://other.gemini.google.com/app',
    'https://gemini.google.com.example.org/app',
    'https://claude.ai/new',
  ])('offers no way to turn Gemini fixes on from %s', async (url) => {
    api.tabs.query.mockResolvedValue([tab(7, url)]);
    await render();
    expect(toggle()).toBeNull();
    expect(onlyTablessStatusReads()).toBe(true);
  });

  it('lets the user turn Gemini fixes off from any tab', async () => {
    api.tabs.query.mockResolvedValue([tab(7, 'https://claude.ai/new')]);
    channel = { ...channel, enabled: true, cachedRevision: 401 };
    await render();
    expect(toggle()?.checked).toBe(true);
    expect(toggle()?.disabled).toBe(false);
    expect(manual()).toBeUndefined();
    await act(async () => toggle()!.click());
    expect(requests(GEMINI_SELECTOR_SET_ENABLED_MESSAGE)).toEqual([
      { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: 'gemini.google.com', enabled: false },
    ]);
    // The card stays to confirm the change, but turning back on needs a Gemini tab.
    expect(toggle()?.checked).toBe(false);
    expect(toggle()?.disabled).toBe(true);
    expect(container.textContent).toContain(translate('geminiSelectorFixesOff'));
    expect(container.textContent).toContain(translate('geminiSelectorFixesTurnOnInGemini'));
    await act(async () => control.setEnabled(true));
    expect(requests(GEMINI_SELECTOR_SET_ENABLED_MESSAGE)).toHaveLength(1);
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE)).toEqual([]);
  });

  it('keeps the card mounted while the popup re-reads the same Gemini tab', async () => {
    await render();
    expect(toggle()).not.toBeNull();
    const reread = deferred<browser.Tabs.Tab[]>();
    api.tabs.query.mockReturnValueOnce(reread.promise);
    await act(async () => {
      void refreshSource();
    });
    expect(toggle()).not.toBeNull();
    await act(async () => reread.resolve([tab(7, 'https://gemini.google.com/u/1/app/abc')]));
    expect(toggle()).not.toBeNull();
  });

  it('keeps old cache data from enabling checks while the setting is off', async () => {
    channel = { ...channel, cachedRevision: 400, lastAttemptAt: 1000 };
    await render();
    expect(toggle()?.checked).toBe(false);
    expect(toggle()?.disabled).toBe(false);
    expect(manual()).toBeUndefined();
    expect(container.textContent).toContain(translate('geminiSelectorFixesOff'));
    await act(async () => control.checkNow());
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE)).toEqual([]);
    expect(api.storage.local.set).not.toHaveBeenCalled();
    expect(api.storage.sync.set).not.toHaveBeenCalled();
  });

  it('uses the options source tab, including its account route, instead of the active tab', async () => {
    api.tabs.get.mockResolvedValue(tab(12, 'https://gemini.google.com/u/2/app/source'));
    api.tabs.query.mockResolvedValue([tab(99, 'https://gemini.google.com/app/other')]);
    channel = { ...channel, enabled: true };
    await render({ sourceTabId: 12 });
    expect(toggle()?.checked).toBe(true);
    expect(api.tabs.query).not.toHaveBeenCalled();
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE)).toEqual([
      {
        type: GEMINI_SELECTOR_REFRESH_MESSAGE,
        host: 'gemini.google.com',
        tabId: 12,
        force: false,
      },
    ]);
  });

  it('does not authorize another active Gemini tab when the explicit options source has closed', async () => {
    api.tabs.get.mockRejectedValue(new Error('No tab with id: 12'));
    api.tabs.query.mockResolvedValue([tab(99, 'https://gemini.google.com/app/other')]);
    channel = { ...channel, enabled: true };
    await render({ sourceTabId: 12 });
    expect(manual()).toBeUndefined();
    expect(onlyTablessStatusReads()).toBe(true);
  });

  it('hides the previous source while the next options source is unresolved', async () => {
    api.tabs.get.mockResolvedValueOnce(tab(12, 'https://gemini.google.com/app/first'));
    await render({ sourceTabId: 12 });
    expect(toggle()).not.toBeNull();
    const second = deferred<browser.Tabs.Tab>();
    api.tabs.get.mockReturnValueOnce(second.promise);
    const oldRequests = sent.length;
    await render({ sourceTabId: 24 });
    expect(toggle()).toBeNull();
    expect(sent).toHaveLength(oldRequests);
    await act(async () => second.resolve(tab(24, 'https://claude.ai/new')));
    expect(toggle()).toBeNull();
    expect(onlyTablessStatusReads(oldRequests)).toBe(true);
  });

  it('does not authorize a cached source URL after both source and active-tab reads fail', async () => {
    api.tabs.get.mockResolvedValueOnce(tab(12, 'https://gemini.google.com/app/first'));
    await render({ sourceTabId: 12 });
    expect(toggle()).not.toBeNull();
    const oldRequests = sent.length;
    api.tabs.get.mockRejectedValue(new Error('Source closed'));
    api.tabs.query.mockRejectedValue(new Error('Window closed'));
    await act(async () => refreshSource());
    expect(toggle()).toBeNull();
    expect(onlyTablessStatusReads(oldRequests)).toBe(true);
  });

  it('enables through the background, then checks automatically and allows a manual due bypass', async () => {
    await render();
    await act(async () => toggle()!.click());
    expect(toggle()?.checked).toBe(true);
    expect(requests(GEMINI_SELECTOR_SET_ENABLED_MESSAGE)).toEqual([
      {
        type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE,
        host: 'gemini.google.com',
        tabId: 7,
        enabled: true,
      },
    ]);
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE).map((request) => request.force)).toEqual([
      false,
    ]);
    await act(async () => manual()!.click());
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE).map((request) => request.force)).toEqual([
      false,
      true,
    ]);
    expect(api.storage.local.set).not.toHaveBeenCalled();
    expect(api.storage.sync.set).not.toHaveBeenCalled();
  });

  it('does not ask for a refresh when a successful check finds no new selectors', async () => {
    channel = { ...channel, enabled: true, cachedRevision: 400, lastAttemptAt: 1000 };
    await render();
    expect(container.textContent).toContain(translate('geminiSelectorFixesUpToDate'));
    expect(manual()?.disabled).toBe(false);
    expect(container.textContent).not.toContain(translate('geminiSelectorFixesUpdated'));
    expect(api.tabs.reload).not.toHaveBeenCalled();
  });

  it('explains a new download without reloading the page', async () => {
    channel = { ...channel, enabled: true };
    onRefresh = async () => {
      channel = { ...channel, cachedRevision: 401, lastAttemptAt: 1000 };
      return { ...channel, result: 'updated' };
    };
    await render();
    expect(container.textContent).toContain(translate('geminiSelectorFixesUpdated'));
    expect(api.tabs.reload).not.toHaveBeenCalled();
  });

  it('does not describe an existing cache as a new download when no check is due', async () => {
    channel = { ...channel, enabled: true, cachedRevision: 401, lastAttemptAt: 1000 };
    onRefresh = async () => ({ ...channel, result: 'notDue' });
    await render();
    expect(container.textContent).not.toContain(translate('geminiSelectorFixesUpdated'));
    expect(container.textContent).toContain(new Date(1000).toLocaleString());
  });

  it('keeps OFF visible when a check finishes after the switch is turned off', async () => {
    const pending = deferred<GeminiSelectorResponse>();
    channel = { ...channel, enabled: true };
    onRefresh = () => pending.promise;
    await render();
    expect(container.textContent).toContain(translate('geminiSelectorFixesChecking'));
    expect(toggle()?.disabled).toBe(false);
    await act(async () => toggle()!.click());
    await act(async () =>
      pending.resolve({ ...channel, enabled: true, cachedRevision: 401, result: 'updated' }),
    );
    expect(toggle()?.checked).toBe(false);
    expect(manual()).toBeUndefined();
    expect(container.textContent).toContain(translate('geminiSelectorFixesOff'));
    expect(container.textContent).not.toContain(translate('geminiSelectorFixesUpdated'));
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE)).toHaveLength(1);
  });

  it('reports failed OFF cleanup after the consent event instead of treating that event as success', async () => {
    channel = { ...channel, enabled: true };
    await render();
    onSet = async () => {
      channel = { ...channel, enabled: false };
      emitConsent(false);
      return { ok: false, error: 'storage' };
    };
    await act(async () => toggle()!.click());
    expect(toggle()?.checked).toBe(false);
    expect(manual()).toBeUndefined();
    expect(container.textContent).toContain(translate('geminiSelectorFixesSaveFailed'));
    expect(container.textContent).not.toContain(translate('geminiSelectorFixesOff'));
  });

  it('stops offering checks after another popup turns the setting off', async () => {
    channel = { ...channel, enabled: true };
    await render();
    const checks = requests(GEMINI_SELECTOR_REFRESH_MESSAGE).length;
    await act(async () => {
      channel = { ...channel, enabled: false };
      emitConsent(false);
    });
    expect(toggle()?.checked).toBe(false);
    expect(manual()).toBeUndefined();
    await act(async () => control.checkNow());
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE)).toHaveLength(checks);
  });

  it('keeps a confirmed external OFF visible when the background status read fails', async () => {
    channel = { ...channel, enabled: true };
    await render();
    api.runtime.sendMessage.mockRejectedValue(new Error('Worker unavailable'));
    await act(async () => emitConsent(false));
    expect(toggle()?.checked).toBe(false);
    expect(manual()).toBeUndefined();
    expect(container.textContent).toContain(translate('geminiSelectorFixesFailed'));
  });

  it('keeps its confirmed OFF visible when both the cleanup reply and reconciliation fail', async () => {
    channel = { ...channel, enabled: true, cachedRevision: 401 };
    await render();
    onSet = async () => {
      channel = { ...channel, enabled: false };
      emitConsent(false);
      api.runtime.sendMessage.mockRejectedValue(new Error('Worker unavailable'));
      return { ok: false, error: 'storage' };
    };
    await act(async () => toggle()!.click());
    expect(toggle()?.checked).toBe(false);
    expect(manual()).toBeUndefined();
    expect(container.textContent).toContain(translate('geminiSelectorFixesSaveFailed'));
  });

  it('shows a failed check without changing consent or requiring a page refresh', async () => {
    channel = { ...channel, enabled: true, cachedRevision: 401 };
    onRefresh = async () => ({ ...channel, result: 'failed' });
    await render();
    expect(toggle()?.checked).toBe(true);
    expect(container.textContent).toContain(translate('geminiSelectorFixesFailed'));
    expect(container.textContent).not.toContain(translate('geminiSelectorFixesUpdated'));
    expect(manual()?.disabled).toBe(false);
  });

  it('offers no check when this build disables the channel despite stored consent', async () => {
    channel = { ...channel, enabled: true, buildEnabled: false };
    await render();
    expect(toggle()?.disabled).toBe(true);
    expect(manual()).toBeUndefined();
    expect(container.textContent).toContain(translate('geminiSelectorFixesUnavailable'));
    expect(requests(GEMINI_SELECTOR_REFRESH_MESSAGE)).toEqual([]);
  });

  it('keeps the hook alive when settings search hides and restores its card', async () => {
    channel = { ...channel, enabled: true };
    await render();
    const priorRequests = sent.length;
    await render({ show: false });
    expect(toggle()).toBeNull();
    await render({ show: true });
    expect(toggle()?.checked).toBe(true);
    expect(container.textContent).toContain(translate('geminiSelectorFixesUpToDate'));
    expect(sent).toHaveLength(priorRequests);
  });
});
