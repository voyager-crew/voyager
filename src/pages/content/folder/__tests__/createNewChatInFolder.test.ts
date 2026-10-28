import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPageUrl, setPageUrl, watchFullPageLoads } from '@/tests/pageUrl';

import { clearNewChatFolder, pendingNewChatFolder } from '../../folderProject/pendingFolder';
import { FolderNavigation } from '../FolderNavigation';

const { mockBrowserStorage } = vi.hoisted(() => ({
  mockBrowserStorage: {
    local: { set: vi.fn(), get: vi.fn(), remove: vi.fn() },
    sync: { get: vi.fn(), set: vi.fn() },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: mockBrowserStorage,
  },
}));

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
  initI18n: () => Promise.resolve(),
}));

describe('createNewChatInFolder', () => {
  let navigation: FolderNavigation;
  let fullPageLoad: ReturnType<typeof watchFullPageLoads>;
  let pushStateSpy: MockInstance<typeof window.history.pushState>;

  beforeEach(() => {
    navigation = new FolderNavigation({
      getContext: () => ({
        container: null,
        sidebar: null,
        isDestroyed: false,
        accountIsolationEnabled: false,
      }),
      onOpened: vi.fn(),
      onTitleChange: vi.fn(),
      onGemDetected: vi.fn(),
    });
    setPageUrl('https://gemini.google.com/app');
    fullPageLoad = watchFullPageLoads();
    pushStateSpy = vi.spyOn(window.history, 'pushState');
    mockBrowserStorage.local.set.mockReset();
    mockBrowserStorage.local.set.mockResolvedValue(undefined);
    mockBrowserStorage.sync.get.mockResolvedValue({});
    mockBrowserStorage.local.get.mockResolvedValue({});
  });

  afterEach(() => {
    resetPageUrl();
    navigation.destroy();
    clearNewChatFolder();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  /** Gemini's sidebar "New chat" link; clicking it routes in-app to `path`. */
  function mountNativeNewChat(path: string | null): ReturnType<typeof vi.fn> {
    const wrapper = document.createElement('side-nav-action-button');
    wrapper.setAttribute('data-test-id', 'new-chat-button');
    const link = document.createElement('a');
    link.setAttribute('href', '/app');
    const onClick = vi.fn((event: Event) => {
      event.preventDefault();
      if (path) setPageUrl(path);
    });
    link.addEventListener('click', onClick);
    wrapper.appendChild(link);
    document.body.appendChild(wrapper);
    return onClick;
  }

  function expectNoFullPageLoad(): void {
    expect(fullPageLoad).not.toHaveBeenCalled();
  }

  it("hands the folder to this tab's picker, never through storage other tabs see", async () => {
    setPageUrl('/app/abc123def456');

    navigation.createNewChatInFolder('folder-1');
    await settle();

    expect(pendingNewChatFolder()).toBe('folder-1');
    expect(mockBrowserStorage.local.set).not.toHaveBeenCalled();
  });

  it('stays on the new-chat page without reloading when already on /app', async () => {
    // The query keeps a load of /app observable: jsdom ignores one to the current URL.
    setPageUrl('/app?hl=en');
    const nativeClick = mountNativeNewChat('/app');

    navigation.createNewChatInFolder('folder-1');
    await settle();

    // The page's folder picker takes the folder from the handoff.
    expect(pendingNewChatFolder()).toBe('folder-1');
    expect(nativeClick).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
    expectNoFullPageLoad();
  });

  it("opens the new chat through Gemini's own New chat link from a conversation", async () => {
    vi.useFakeTimers();
    setPageUrl('/app/abc123def456');
    const nativeClick = mountNativeNewChat('/app');

    navigation.createNewChatInFolder('folder-1');
    await settle();
    await vi.advanceTimersByTimeAsync(2000);

    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).not.toHaveBeenCalled();
    expectNoFullPageLoad();
    vi.useRealTimers();
  });

  it("falls back to the History API when Gemini's New chat link does not route", async () => {
    vi.useFakeTimers();
    setPageUrl('/u/1/app/abc123def456');
    const nativeClick = mountNativeNewChat(null);

    navigation.createNewChatInFolder('folder-1');
    await settle();
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/u/1/app');
    expectNoFullPageLoad();
    vi.useRealTimers();
  });

  it('navigates to /app via SPA route when the page has no New chat link', async () => {
    setPageUrl('/app/abc123def456');

    navigation.createNewChatInFolder('folder-1');
    await settle();

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/app');
    expectNoFullPageLoad();
  });

  it('preserves the multi-account user prefix (/u/N/app)', async () => {
    setPageUrl('/u/2/c/abc');

    navigation.createNewChatInFolder('folder-1');
    await settle();

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/u/2/app');
    expectNoFullPageLoad();
  });

  it('never loads the page when the History API path fails, leaving the folder pending', async () => {
    setPageUrl('/app/abc123def456');
    pushStateSpy.mockImplementation(() => {
      throw new Error('pushState blocked');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    navigation.createNewChatInFolder('folder-1');
    await settle();

    expectNoFullPageLoad();
    expect(warnSpy).toHaveBeenCalled();
    expect(pendingNewChatFolder()).toBe('folder-1');
  });
});
