import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import { QUIET_FOCUS_ATTRIBUTE } from '../hooks/useOpeningFocus';
import {
  GEMINI,
  click,
  container,
  flush,
  mount,
  postedKinds,
  press,
  query,
  rowNames,
  tab,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const zh = await loadTranslations('zh');
const switcher = () => query<HTMLButtonElement>('.siteBtn')!;
const searchButton = () => query<HTMLButtonElement>('.search button')!;
const searchField = () => query<HTMLInputElement>('.search input')!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')!;
const closes = () => postedKinds().filter((kind) => kind === PANEL_SHELL_MESSAGE.close).length;
const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function openSearch(): Promise<void> {
  await click(searchButton());
  // The field takes focus once it has started to open.
  await vi.waitFor(async () => {
    await act(flush);
    expect(document.activeElement).toBe(searchField());
  });
}

async function type(text: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(searchField(), text);
    searchField().dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

const quiet = (element: Element) => element.hasAttribute(QUIET_FOCUS_ATTRIBUTE);

describe('keyboard', () => {
  it('focuses the active tab without a ring until a key is pressed', async () => {
    await mount();
    await frame();
    expect(document.activeElement).toBe(tab('features'));
    expect(quiet(tab('features'))).toBe(true);

    await press('Shift');
    expect(quiet(tab('features'))).toBe(false);
  });

  it('Esc closes an open menu, then search, then asks the shell to close the panel', async () => {
    await mount();
    await openSearch();
    await click(switcher());
    expect(menu().hidden).toBe(false);

    await press('Escape');
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(switcher());
    expect(container.querySelector('.search.open')).not.toBeNull();

    searchField().focus();
    await press('Escape');
    expect(container.querySelector('.search.open')).toBeNull();
    expect(document.activeElement).toBe(searchButton());
    expect(closes()).toBe(0);

    await press('Escape');
    expect(closes()).toBe(1);
  });

  it('Esc closes the panel when search is open but focus is elsewhere', async () => {
    await mount();
    await openSearch();
    tab('features').focus();
    await press('Escape');

    expect(closes()).toBe(1);
  });

  it('the panel shortcut inside the frame closes the panel and types nothing, except while composing', async () => {
    await mount();
    await openSearch();
    const composing = new KeyboardEvent('keydown', {
      key: 'Process',
      code: 'KeyV',
      altKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      searchField().dispatchEvent(composing);
    });
    expect(closes()).toBe(0);

    // macOS reports Option+V as "√"; the physical key is what matches.
    const shortcut = new KeyboardEvent('keydown', {
      key: '√',
      code: 'KeyV',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      searchField().dispatchEvent(shortcut);
    });
    expect(closes()).toBe(1);
    expect(shortcut.defaultPrevented).toBe(true);
  });

  it('arrow keys move between the two tabs', async () => {
    await mount();
    tab('features').focus();
    await press('ArrowRight');

    expect(tab('sites').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('sites'));
  });
});

describe('search', () => {
  it('matches the localized name and the English name', async () => {
    await mount(GEMINI, 'zh');
    await openSearch();

    await type('悬浮');
    expect(rowNames()).toContain(zh.panelFloatingButton);
    expect(
      container.querySelector(`[data-row="${OFFICIAL_PLUGIN_IDS.geminiChatWidth}"]`),
    ).toBeNull();

    // The manifest's English name, while the row reads in Chinese.
    await type('chat width');
    const width = container.querySelector(
      `[data-row="${OFFICIAL_PLUGIN_IDS.geminiChatWidth}"] .rn`,
    );
    expect(width?.textContent).not.toBe('Chat Width');
    expect(rowNames()).not.toContain(zh.panelFloatingButton);

    await type('mermaid');
    expect(
      container.querySelector(`[data-row="${OFFICIAL_PLUGIN_IDS.geminiMermaid}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-row="${OFFICIAL_PLUGIN_IDS.geminiChatWidth}"]`),
    ).toBeNull();

    await type('zzzz');
    expect(container.querySelector('.empty')?.textContent).toBe(zh.panelNoMatches);
  });

  it('is hidden on the sites tab and starts empty again', async () => {
    await mount();
    await openSearch();
    await type('width');
    await click(tab('sites'));

    expect(container.querySelector('.tools.dim')).not.toBeNull();
    await click(tab('features'));
    expect(container.querySelector('.search.open')).toBeNull();
    expect(searchField().value).toBe('');
  });
});
