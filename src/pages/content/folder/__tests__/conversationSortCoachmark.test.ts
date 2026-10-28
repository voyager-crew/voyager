import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPageUrl } from '@/tests/pageUrl';

const mocks = vi.hoisted(() => ({
  getTranslationSync: vi.fn((key: string) => key),
  initI18n: vi.fn(async () => undefined),
  showCoachmark: vi.fn(async (_config: unknown) => 'dismissed'),
  releaseSidebar: vi.fn(),
  keepSidebarExpanded: vi.fn(),
}));

mocks.keepSidebarExpanded.mockImplementation(() => mocks.releaseSidebar);

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: mocks.getTranslationSync,
  initI18n: mocks.initI18n,
}));

vi.mock('../../coachmark', () => ({
  showCoachmark: mocks.showCoachmark,
}));

vi.mock('../../sidebarAutoHide', () => ({
  keepSidebarExpanded: mocks.keepSidebarExpanded,
}));

interface CapturedCoachmarkConfig {
  id: string;
  title: string;
  body: string;
  reveal: {
    mount: () => HTMLElement;
    interactive?: boolean;
    unmount: (
      element: HTMLElement | null,
      result: 'confirmed' | 'enabled' | 'advanced' | 'dismissed' | 'skipped',
    ) => void;
  };
  anchor: () => HTMLElement | null;
}

describe('conversation sort coachmark', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    setPageUrl('https://gemini.google.com/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens folder settings and introduces both conversation order modes', async () => {
    const settingsButton = document.createElement('button');
    settingsButton.className = 'gv-folder-settings-btn';
    settingsButton.getBoundingClientRect = () =>
      ({ left: 100, top: 40, right: 124, bottom: 64, width: 24, height: 24 }) as DOMRect;
    settingsButton.addEventListener('click', () => {
      const existing = document.querySelector('.gv-folder-settings-menu');
      if (existing) {
        existing.remove();
        return;
      }
      const menu = document.createElement('div');
      menu.className = 'gv-folder-settings-menu';
      const row = document.createElement('div');
      row.className = 'gv-folder-sort-settings-row';
      row.textContent = 'folder_sort folder_sort_manual folder_sort_recent';
      menu.appendChild(row);
      document.body.appendChild(menu);
    });
    document.body.appendChild(settingsButton);

    const { maybeShowConversationSortCoachmark } = await import('../conversationSortCoachmark');
    const pending = maybeShowConversationSortCoachmark({ force: true });
    await vi.advanceTimersByTimeAsync(320);
    await pending;

    const config = mocks.showCoachmark.mock.calls[0]![0] as CapturedCoachmarkConfig;
    expect(config.id).toBe('folder-conversation-sort-intro-v1');
    expect(config.title).toBe('New: conversation sorting');
    expect(config.body).toContain('Manual order');
    expect(config.body).toContain('Recently opened');
    expect(config.reveal.interactive).toBe(true);

    const menu = config.reveal.mount();
    const row = menu.querySelector<HTMLElement>('.gv-folder-sort-settings-row');
    expect(row?.textContent).toContain('folder_sort_manual');
    expect(row?.textContent).toContain('folder_sort_recent');
    expect(config.anchor()).toBe(menu);
    expect(menu.classList.contains('gv-coach-folder-settings-preview')).toBe(true);

    config.reveal.unmount(menu, 'confirmed');
    expect(document.querySelector('.gv-folder-settings-menu')).not.toBeNull();
    expect(menu.classList.contains('gv-coach-folder-settings-preview')).toBe(false);
    expect(mocks.keepSidebarExpanded).toHaveBeenCalledOnce();
    expect(mocks.releaseSidebar).toHaveBeenCalledOnce();
  });

  it('closes a partially opened settings menu when the sort row is unavailable', async () => {
    const settingsButton = document.createElement('button');
    settingsButton.className = 'gv-folder-settings-btn';
    settingsButton.getBoundingClientRect = () =>
      ({ left: 100, top: 40, right: 124, bottom: 64, width: 24, height: 24 }) as DOMRect;
    settingsButton.addEventListener('click', () => {
      const existing = document.querySelector('.gv-folder-settings-menu');
      if (existing) {
        existing.remove();
        return;
      }
      const menu = document.createElement('div');
      menu.className = 'gv-folder-settings-menu';
      document.body.appendChild(menu);
    });
    document.body.appendChild(settingsButton);

    const { maybeShowConversationSortCoachmark } = await import('../conversationSortCoachmark');
    const pending = maybeShowConversationSortCoachmark({ force: true });
    await vi.advanceTimersByTimeAsync(320);
    await pending;

    const config = mocks.showCoachmark.mock.calls[0]![0] as CapturedCoachmarkConfig;
    expect(() => config.reveal.mount()).toThrow('Conversation sort settings are unavailable');
    expect(document.querySelector('.gv-folder-settings-menu')).not.toBeNull();

    config.reveal.unmount(null, 'skipped');
    expect(document.querySelector('.gv-folder-settings-menu')).toBeNull();
  });
});
