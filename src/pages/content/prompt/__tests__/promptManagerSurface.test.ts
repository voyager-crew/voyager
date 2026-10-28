import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import { toastDriver } from '@/tests/toastDriver';

import { ensureScheme, stopScheme } from '../../platformTheme/scheme';
import {
  emitStorageChange,
  openManager,
  prompt,
  setupPromptManagerTests,
  storageGet,
} from './promptManagerHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));

setupPromptManagerTests();

describe('prompt manager footer', () => {
  it('keeps the secondary footer row to settings and the sponsor link', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);

    const secondary = panel.querySelector('.gv-pm-footer-secondary')!;
    expect(Array.from(secondary.children).map((child) => child.className)).toEqual([
      'gv-pm-settings',
      'gv-pm-support',
    ]);
  });

  it('renders the sponsor link as an icon plus a text label', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);

    const support = panel.querySelector<HTMLAnchorElement>('.gv-pm-support')!;
    expect(support.querySelector('svg')).not.toBeNull();
    const label = support.querySelector('.gv-pm-support-label');
    expect(label?.textContent?.trim()).toBeTruthy();
    expect(support.textContent).toBe(label?.textContent);
  });

  it('gives the Saved Library a back action and an export menu with two formats', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);

    const savedFooter = panel.querySelector('.gv-pm-saved-footer-actions')!;
    expect(savedFooter.querySelector('.gv-pm-saved-footer-primary svg')).not.toBeNull();
    const exportTrigger = savedFooter.querySelector('.gv-pm-saved-export-trigger')!;
    expect(exportTrigger.getAttribute('aria-haspopup')).toBe('menu');
    const options = Array.from(
      savedFooter.querySelectorAll<HTMLButtonElement>('.gv-pm-saved-export-option'),
    );
    expect(options.map((option) => option.textContent)).toEqual(['JSON', 'Markdown']);
    expect(options.every((option) => option.querySelector('svg'))).toBe(true);
    // Filters sit above the list; the saved footer offers no import.
    const toolbar = panel.querySelector('.gv-pm-saved-toolbar')!;
    const list = panel.querySelector('.gv-pm-list')!;
    expect(toolbar.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(savedFooter.querySelectorAll('button')).toHaveLength(4);
  });

  it('draws its controls with icons rather than emoji', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);

    expect(panel.querySelector('.gv-pm-lock svg')).not.toBeNull();
    expect(panel.querySelector('.gv-pm-backup-btn svg')).not.toBeNull();
    expect(panel.textContent).not.toMatch(/[💬★🔒🔓]/u);
  });
});

describe('prompt manager list', () => {
  it('marks every prompt of a duplicate-name group with a non-blocking badge', async () => {
    const panel = await openManager([
      prompt('a', 'Same'),
      prompt('b', 'same '),
      prompt('c', 'Unique'),
    ]);

    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.gv-pm-item'));
    expect(rows).toHaveLength(3);
    const flagged = rows.map((row) => row.classList.contains('gv-pm-item-name-conflict'));
    expect(flagged.filter(Boolean)).toHaveLength(2);
    for (const row of rows) {
      const badge = row.querySelector('.gv-pm-name-conflict');
      expect(Boolean(badge)).toBe(row.classList.contains('gv-pm-item-name-conflict'));
      if (badge) expect(badge.textContent?.trim()).toBeTruthy();
    }
  });

  it('opens links in the hover preview in a new tab', async () => {
    vi.useFakeTimers();
    const panel = await openManager([
      prompt('a', 'Linked', 'Read [the docs](https://example.com/docs) first'),
    ]);

    const row = panel.querySelector<HTMLElement>('.gv-pm-item-text')!;
    row.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(300);

    const link = await vi.waitFor(() => {
      const found = document.querySelector<HTMLAnchorElement>('.gv-pm-tooltip a[href]');
      if (!found) throw new Error('preview not rendered yet');
      return found;
    });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('prompt manager settings', () => {
  it('is not hidden by the slash completion setting', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);
    const trigger = document.querySelector<HTMLElement>('#gv-pm-trigger')!;

    emitStorageChange(
      { [StorageKeys.SLASH_PROMPT_ENABLED]: { oldValue: true, newValue: false } },
      'sync',
    );

    expect(trigger.style.display).not.toBe('none');
    expect(panel.classList.contains('gv-hidden')).toBe(false);
  });
});

describe('prompt row press', () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn(async (_text: string) => {});

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  function pressFirstRow(panel: HTMLElement): void {
    panel
      .querySelector<HTMLElement>('.gv-pm-item-text')!
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  }

  function mountVisibleTextarea(): HTMLTextAreaElement {
    const composer = document.createElement('textarea');
    // jsdom lays nothing out; the composer lookup only takes a visible input.
    composer.getBoundingClientRect = () => new DOMRect(0, 600, 600, 48);
    document.body.appendChild(composer);
    return composer;
  }

  it('inserts the whole multi-line body into the composer when insert-on-click is on', async () => {
    vi.mocked(chrome.storage.sync.get).mockImplementation(
      storageGet({ [StorageKeys.LANGUAGE]: 'en', [StorageKeys.PROMPT_INSERT_ON_CLICK]: true }),
    );
    const composer = mountVisibleTextarea();
    const panel = await openManager([prompt('a', 'Alpha', 'line one\nline two')]);

    pressFirstRow(panel);

    await vi.waitFor(() => expect(toastDriver.messages()).toEqual(['Inserted']));
    expect(composer.value).toBe('line one\nline two');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the body when insert-on-click is on but the page has no composer', async () => {
    vi.mocked(chrome.storage.sync.get).mockImplementation(
      storageGet({ [StorageKeys.LANGUAGE]: 'en', [StorageKeys.PROMPT_INSERT_ON_CLICK]: true }),
    );
    const panel = await openManager([prompt('a', 'Alpha', 'line one\nline two')]);

    pressFirstRow(panel);

    await vi.waitFor(() => expect(toastDriver.messages()).toEqual(['Copied']));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('line one\nline two');
  });

  it('copies rather than inserts while insert-on-click is off', async () => {
    const composer = mountVisibleTextarea();
    const panel = await openManager([prompt('a', 'Alpha')]);

    pressFirstRow(panel);

    await vi.waitFor(() => expect(toastDriver.messages()).toEqual(['Copied']));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Alpha body');
    expect(composer.value).toBe('');
  });
});

describe('prompt manager starting theme', () => {
  function stubOsDark(dark: boolean): void {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: dark && query.includes('dark'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
  }

  it("starts in Gemini's dark theme even when the OS is light", async () => {
    stubOsDark(false);
    document.body.insertAdjacentHTML('afterbegin', '<div class="theme-host dark-theme"></div>');

    const panel = await openManager([prompt('a', 'Alpha')]);

    expect(panel.getAttribute('data-gv-theme')).toBe('dark');
  });

  it("starts in Gemini's light theme even when the OS is dark", async () => {
    stubOsDark(true);
    document.body.insertAdjacentHTML('afterbegin', '<div class="theme-host light-theme"></div>');

    const panel = await openManager([prompt('a', 'Alpha')]);

    expect(panel.getAttribute('data-gv-theme')).toBe('light');
  });

  it('follows the OS on a page that marks no theme', async () => {
    stubOsDark(true);

    const panel = await openManager([prompt('a', 'Alpha')]);

    expect(panel.getAttribute('data-gv-theme')).toBe('dark');
  });

  it('takes the saved panel theme over the page theme', async () => {
    stubOsDark(false);
    vi.mocked(chrome.storage.sync.get).mockImplementation(
      storageGet({ [StorageKeys.LANGUAGE]: 'en', [StorageKeys.PROMPT_THEME]: 'dark' }),
    );
    document.body.insertAdjacentHTML('afterbegin', '<div class="theme-host light-theme"></div>');

    const panel = await openManager([prompt('a', 'Alpha')]);

    await vi.waitFor(() => expect(panel.getAttribute('data-gv-theme')).toBe('dark'));
  });

  it("starts in DeepSeek's dark theme even when the OS is light", async () => {
    stubOsDark(false);
    const url = 'https://chat.deepseek.com/';
    vi.stubGlobal('location', new URL(url));
    document.body.classList.add('dark');
    ensureScheme(SiteRegistry.createDefault().resolveByUrl(url)?.theme ?? null);

    try {
      const panel = await openManager([prompt('a', 'Alpha')]);

      expect(panel.getAttribute('data-gv-theme')).toBe('dark');
    } finally {
      stopScheme();
      document.body.classList.remove('dark');
      document.documentElement.removeAttribute('data-gv-scheme');
    }
  });

  it('follows page theme changes until the switch fixes a theme, and again after auto', async () => {
    const url = 'https://gemini.google.com/app';
    vi.stubGlobal('location', new URL(url));
    document.body.insertAdjacentHTML('afterbegin', '<div class="theme-host light-theme"></div>');
    const themeHost = document.querySelector('.theme-host')!;
    const setPageTheme = (scheme: 'light' | 'dark') => {
      themeHost.className = `theme-host ${scheme}-theme`;
    };
    ensureScheme(SiteRegistry.createDefault().resolveByUrl(url)?.theme ?? null);

    try {
      const panel = await openManager([prompt('a', 'Alpha')]);
      setPageTheme('dark');
      await vi.waitFor(() => expect(panel.getAttribute('data-gv-theme')).toBe('dark'));

      panel.querySelector<HTMLButtonElement>('.gv-pm-theme-toggle')!.click();
      setPageTheme('light');
      setPageTheme('dark');
      await vi.waitFor(() => expect(document.documentElement.dataset.gvScheme).toBe('dark'));
      expect(panel.getAttribute('data-gv-theme')).toBe('light');

      emitStorageChange({ [StorageKeys.PROMPT_THEME]: { newValue: 'auto' } }, 'sync');
      expect(panel.getAttribute('data-gv-theme')).toBe('dark');
    } finally {
      stopScheme();
      document.documentElement.removeAttribute('data-gv-scheme');
    }
  });
});

describe('Saved Library highlight scope', () => {
  function answerRuntimeMessages(): ReturnType<typeof vi.fn> {
    const sendMessage = vi.fn((message: { type: string }, callback?: (r: unknown) => void) => {
      const response =
        message.type === 'gv.highlight.list'
          ? { ok: true, records: [] }
          : { ok: true, messages: [], data: { messages: {} } };
      callback?.(response);
      return Promise.resolve(response);
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(sendMessage as never);
    return sendMessage;
  }

  async function requestedHighlightPlatform(url: string): Promise<unknown> {
    vi.stubGlobal('location', new URL(url));
    const sendMessage = answerRuntimeMessages();
    const panel = await openManager([prompt('a', 'Alpha')]);
    panel.querySelector<HTMLButtonElement>('.gv-pm-backup-btn')!.click();
    const call = await vi.waitFor(() => {
      const found = sendMessage.mock.calls.find(
        ([message]) => message.type === 'gv.highlight.list',
      );
      if (!found) throw new Error('highlights not requested yet');
      return found;
    });
    return (call[0] as { payload: { scope: { platform: unknown } } }).payload.scope.platform;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['https://gemini.google.com/app', 'gemini'],
    ['https://gemini.google.com/u/1/app', 'gemini'],
    ['https://aistudio.google.com/prompts/new_chat', 'aistudio'],
    ['https://aistudio.google.cn/prompts/new_chat', 'aistudio'],
    ['https://chatgpt.com/', 'gemini'],
    ['https://chat.deepseek.com/', 'gemini'],
  ])('asks for highlights of %s under platform %s', async (url, platform) => {
    expect(await requestedHighlightPlatform(url)).toBe(platform);
  });
});
