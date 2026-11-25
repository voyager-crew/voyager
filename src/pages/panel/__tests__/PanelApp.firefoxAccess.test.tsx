import { act } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE } from '@/features/panel/protocol';
import { PROMPT_SWITCH_ID } from '@/pages/popup/hooks/usePromptSwitch';

import {
  CLAUDE,
  SESSION_ID,
  byId,
  click,
  container,
  en,
  extensionApi,
  flush,
  local,
  mount,
  rowSwitch,
  sync,
  tab,
} from './panelHarness';

/**
 * What Firefox gives a moz-extension:// frame inside the host page: no
 * `permissions` and no `scripting`, on a browser that supports both (#1118).
 */
const firefoxFrame = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('webextension-polyfill', async () => {
  const { extensionApi: api } = await import('./panelBrowserApi');
  Object.assign(firefoxFrame, api, { permissions: undefined, scripting: undefined });
  return { default: firefoxFrame };
});

const TIMELINE = 'voyager.claude-timeline';
const READING_WIDTH = 'voyager.claude-reading-width';
const enabledIn = (id: string) =>
  (local[StorageKeys.PLUGINS_STATE] as Record<string, { enabled?: boolean }> | undefined)?.[id]
    ?.enabled === true;
const toastText = () => container.querySelector('[role="status"] .toast.open')?.textContent ?? '';

const FALLBACK = { type: PANEL_MESSAGE.siteAccessFallback, payload: { sessionId: SESSION_ID } };

beforeEach(() => {
  vi.stubGlobal('chrome', firefoxFrame);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  );
  extensionApi.runtime.sendMessage.mockResolvedValue({ ok: true });
});

describe("a feature switch in Firefox's in-page panel", () => {
  it('turns a feature on for the page the panel is open on, without calling it unsupported', async () => {
    await mount(CLAUDE);
    await click(rowSwitch(TIMELINE));

    expect(enabledIn(TIMELINE)).toBe(true);
    expect(rowSwitch(TIMELINE).getAttribute('aria-checked')).toBe('true');
    expect(toastText()).not.toContain(en.pluginUnsupportedPlatform);
  });

  it("opens the popup on site access when the feature also needs Claude's artifact frames", async () => {
    await mount(CLAUDE);
    await click(rowSwitch(READING_WIDTH));

    expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith(FALLBACK);
    expect(enabledIn(READING_WIDTH)).toBe(false);
    expect(toastText()).toBe('');
  });
});

describe("Prompt Manager and websites in Firefox's in-page panel", () => {
  it("covers the page's own host from its row without asking", async () => {
    await mount(CLAUDE);
    await click(byId(PROMPT_SWITCH_ID));

    expect(sync[StorageKeys.PROMPT_CUSTOM_WEBSITES]).toEqual(['claude.ai']);
    expect(byId(PROMPT_SWITCH_ID)?.getAttribute('aria-checked')).toBe('true');
  });

  it('opens the popup on site access to add another website', async () => {
    await mount(CLAUDE);
    await click(tab('sites'));
    const field = byId('panel-add-website') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(field, 'example.com');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      field.form!.requestSubmit();
      await flush();
    });

    expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith(FALLBACK);
    expect(toastText()).toBe('');
  });
});
