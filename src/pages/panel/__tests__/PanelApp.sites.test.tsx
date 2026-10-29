import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE } from '@/features/panel/protocol';
import { PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE } from '@/features/plugins/runtime/messages';

import {
  SESSION_ID,
  byId,
  click,
  container,
  en,
  extensionApi,
  flush,
  granted,
  mount,
  rowNames,
  sync,
  tab,
  writeElsewhere,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const CLAUDE_ACCESS = ['https://claude.ai/*'];
const claudeSwitch = () => byId('panel-site-switch-claude') as HTMLButtonElement;
const claudeRow = () => container.querySelector<HTMLElement>('[data-site-row="claude"]')!;
const toastText = () => container.querySelector('[role="status"] .toast.open')?.textContent ?? '';
const WEBSITES = StorageKeys.PROMPT_CUSTOM_WEBSITES;
const FALLBACK = { type: PANEL_MESSAGE.siteAccessFallback, payload: { sessionId: SESSION_ID } };
const undoButton = () =>
  container.querySelector<HTMLButtonElement>('[role="status"] .toast.open button');
const addField = () => byId('panel-add-website') as HTMLInputElement;
const removeButton = (website: string) => container.querySelector(`[data-website="${website}"] .x`);
/** Another popup or tab saved this, and the panel has not heard of it yet. */
const savedUnheard = (website: string) => {
  sync[WEBSITES] = [...((sync[WEBSITES] as string[] | undefined) ?? []), website];
};
const noGesture = () => {
  throw new Error('permissions.request may only be called from a user input handler');
};
const sentTypes = () =>
  extensionApi.runtime.sendMessage.mock.calls.map(
    ([message]) => (message as { type?: string } | undefined)?.type,
  );

async function openSites(): Promise<void> {
  await mount();
  await click(tab('sites'));
}

describe('turning a supported site on', () => {
  it('asks the browser once, inside the click, then starts the site scripts', async () => {
    await openSites();
    expect(claudeSwitch().getAttribute('aria-checked')).toBe('false');

    // Nothing may be awaited before the request, or the browser drops the gesture.
    act(() => claudeSwitch().click());
    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: CLAUDE_ACCESS,
    });

    await act(flush);
    expect(claudeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(claudeRow().textContent).toContain('0 on');
    expect(sentTypes()).toContain(PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE);
  });

  it.each([
    ['joins cloud sync, even after being turned off there', true],
    ['leaves cloud sync alone when the browser says no', false],
  ])('%s', async (_, allow) => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [StorageKeys.CLOUD_SYNC_SCOPE]: { version: 1, shared: true, sites: { claude: false } },
    } as never);
    extensionApi.permissions.request.mockResolvedValueOnce(allow);
    await openSites();
    act(() => claudeSwitch().click());
    await act(flush);

    const scopes = vi
      .mocked(chrome.storage.local.set)
      .mock.calls.flatMap(([items]) =>
        StorageKeys.CLOUD_SYNC_SCOPE in items ? [items[StorageKeys.CLOUD_SYNC_SCOPE]] : [],
      );
    expect(scopes).toEqual(
      allow ? [expect.objectContaining({ sites: expect.objectContaining({ claude: true }) })] : [],
    );
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('permissions.request may only be called from a user input handler');
      },
    ],
    ['reports no gesture', () => Promise.reject(new Error('must be called during a user gesture'))],
  ])('opens the popup on site access when the browser %s', async (_, refuse) => {
    extensionApi.permissions.request.mockImplementation(refuse);
    await openSites();
    await click(claudeSwitch());

    expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
    expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE.siteAccessFallback,
      payload: { sessionId: SESSION_ID },
    });
    expect(toastText()).toBe('');
    expect(claudeSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('says so when the popup cannot open either', async () => {
    extensionApi.permissions.request.mockImplementation(() => {
      throw new Error('no gesture');
    });
    extensionApi.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'popup_unavailable' });
    await openSites();
    await click(claudeSwitch());

    expect(toastText()).toContain(en.permissionRequestFailed);
  });
});

describe('a site Voyager can reach', () => {
  it('removes its access with 撤销, which gives the access back', async () => {
    granted.add(CLAUDE_ACCESS[0]);
    await openSites();
    expect(claudeSwitch().getAttribute('aria-checked')).toBe('true');

    await click(claudeSwitch());
    expect(granted.has(CLAUDE_ACCESS[0])).toBe(false);
    expect(toastText()).toContain(en.siteAccessRemoved.replace('{site}', 'Claude'));

    const undo = container.querySelector<HTMLButtonElement>('[role="status"] .toast button');
    expect(undo?.textContent).toBe(en.pluginToggleUndo);
    await click(undo);
    expect(granted.has(CLAUDE_ACCESS[0])).toBe(true);
    expect(claudeSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it("opens that site's features when its row is clicked", async () => {
    granted.add(CLAUDE_ACCESS[0]);
    await openSites();
    await click(claudeRow().querySelector('.rs'));

    expect(tab('features').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.siteBtn')?.getAttribute('title')).toBe(
      en.panelNotThisPage.replace('{site}', 'Claude'),
    );
    expect(rowNames()).toContain('Draft auto-save');
  });
});

async function addWebsite(text: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(addField(), text);
    addField().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    addField().form!.requestSubmit();
    await flush();
  });
}

describe('other websites', () => {
  it('adds a website as Prompt Manager stores it, without scheme, path or www', async () => {
    await openSites();
    await addWebsite('https://www.example.com/some/path');

    expect(sync[WEBSITES]).toEqual(['example.com']);
    expect(container.querySelector('[data-website="example.com"]')).not.toBeNull();
  });

  it('shows a website another page adds while the panel is open', async () => {
    await openSites();
    await writeElsewhere('sync', { [WEBSITES]: ['example.org'] });

    expect(container.querySelector('[data-website="example.org"]')).not.toBeNull();
  });

  it('keeps websites saved elsewhere while open through an add, a remove and its undo', async () => {
    sync[WEBSITES] = ['keep.example'];
    granted.add('https://*.keep.example/*');
    await openSites();

    savedUnheard('other.example');
    await addWebsite('example.com');
    expect(sync[WEBSITES]).toEqual(['keep.example', 'other.example', 'example.com']);

    savedUnheard('late.example');
    await click(removeButton('keep.example'));
    expect(sync[WEBSITES]).toEqual(['other.example', 'example.com', 'late.example']);

    savedUnheard('later.example');
    await click(undoButton());
    // Back where it stood, with everything saved since.
    expect(sync[WEBSITES]).toEqual([
      'keep.example',
      'other.example',
      'example.com',
      'late.example',
      'later.example',
    ]);
  });

  it('opens the popup on site access when the browser will not ask here, keeping the typed text', async () => {
    extensionApi.permissions.request.mockImplementation(noGesture);
    await openSites();
    await addWebsite('https://www.example.com/path');

    expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith(FALLBACK);
    expect(addField().value).toBe('https://www.example.com/path');
    expect(toastText()).toBe('');
    // Nothing is kept without access; the popup adds it once the browser allows it.
    expect(sync[WEBSITES] ?? []).toEqual([]);
  });

  it('says so when neither the panel nor the popup can ask for the website', async () => {
    extensionApi.permissions.request.mockImplementation(noGesture);
    extensionApi.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'popup_unavailable' });
    await openSites();
    await addWebsite('example.com');

    expect(toastText()).toContain(en.permissionRequestFailed);
  });

  it("opens the popup on site access when an undo's request is refused here", async () => {
    sync[WEBSITES] = ['example.org'];
    granted.add('https://*.example.org/*');
    await openSites();
    await click(removeButton('example.org'));
    extensionApi.permissions.request.mockImplementation(noGesture);
    await click(undoButton());

    expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith(FALLBACK);
    expect(toastText()).not.toContain(en.siteAccessRestoreFailed.replace('{site}', 'example.org'));
    expect(sync[WEBSITES]).toEqual([]);
  });
});
