import { act } from 'react';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { VISUAL_EFFECTS_MANIFEST } from '@/features/plugins/builtin/visualEffectsManifest';

import { container, en, extensionApi, local, mount, sync, unmount } from './popupHarness';
import {
  buttonWithText,
  coverage,
  coverageGrants,
  grant,
  pluginSwitch,
  promptSwitch,
  siteRow,
  toast,
} from './siteAccessHarness';

const PROMPT_MANAGER = 'Prompt Manager';
const READING_WIDTH = 'Claude · Comfortable Reading Width';
const openTab = (url: string) => extensionApi.tabs.query.mockResolvedValue([{ id: 9, url }]);
const times = (text: string | null | undefined, part: string) =>
  (text ?? '').split(part).length - 1;
/** The plugin card: the closest block around its title that holds a switch. */
const pluginCard = () => {
  const title = Array.from(container.querySelectorAll('h3')).find(
    (heading) => heading.textContent === en.pluginsTitle,
  )!;
  let card = title.parentElement!;
  while (!card.querySelector('input')) card = card.parentElement!;
  return card;
};
/** Lets every pending browser answer and storage write land. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe('Prompt Manager on a supported site', () => {
  it('is one row, its catalog plugin, first in the site’s features, and counted once for the site', async () => {
    openTab('https://claude.ai/new');
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai'];
    sync[StorageKeys.GV_VISUAL_EFFECT] = 'rain';
    grant(...coverageGrants('claude.ai'));
    await mount();

    expect(times(pluginCard().textContent, PROMPT_MANAGER)).toBe(1);
    expect(pluginCard().querySelector('input')).toBe(pluginSwitch(PROMPT_MANAGER));
    expect(promptSwitch()).toBe(pluginSwitch(PROMPT_MANAGER));
    expect(pluginSwitch(PROMPT_MANAGER).checked).toBe(true);
    // An effect for every site is on there too, riding on Prompt Manager's page script.
    expect(siteRow('claude').textContent).toContain(
      `${PROMPT_MANAGER} and ${VISUAL_EFFECTS_MANIFEST.name}`,
    );
    expect(times(siteRow('claude').textContent, PROMPT_MANAGER)).toBe(1);
  });

  it('on an alias host writes that host’s own entry', async () => {
    openTab('https://chat.openai.com/c/1');
    await mount();

    await act(async () => pluginSwitch(PROMPT_MANAGER).click());

    expect(coverage()).toEqual(['chat.openai.com']);
    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: coverageGrants('chat.openai.com'),
    });
    expect(pluginSwitch(PROMPT_MANAGER).checked).toBe(true);
  });

  it('shows the page host’s coverage, not a plugin-state entry', async () => {
    // A restored plugins backup can carry an entry the switch never reads.
    local[StorageKeys.PLUGINS_STATE] = {
      'voyager.chatgpt-prompt-manager': { enabled: true, installedAt: 1 },
    };
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['chat.openai.com'];
    grant(...coverageGrants('chat.openai.com'));
    openTab('https://chatgpt.com/');
    await mount();
    expect(pluginSwitch(PROMPT_MANAGER).checked).toBe(false);

    await unmount();
    openTab('https://chat.openai.com/c/1');
    await mount();
    expect(pluginSwitch(PROMPT_MANAGER).checked).toBe(true);
  });

  it('off on a host covered by a parent domain removes every covering entry, and undo puts them back in place', async () => {
    const stored = ['qwen.ai', 'deepseek.com', 'notebooklm.google.com', 'chat.deepseek.com'];
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = stored;
    grant(...stored.flatMap(coverageGrants));
    openTab('https://chat.deepseek.com/a/chat');
    await mount();
    expect(promptSwitch().checked).toBe(true);

    await act(async () => promptSwitch().click());

    expect(coverage()).toEqual(['qwen.ai', 'notebooklm.google.com']);
    expect(promptSwitch().checked).toBe(false);
    expect(toast().textContent).toContain(
      en.pluginToggleToastOff.replace('{name}', PROMPT_MANAGER),
    );
    expect(siteRow('deepseek').textContent).not.toContain(PROMPT_MANAGER);

    await act(async () => buttonWithText(en.pluginToggleUndo, toast())!.click());

    expect(coverage()).toEqual(stored);
    expect(promptSwitch().checked).toBe(true);
    expect(extensionApi.permissions.request).not.toHaveBeenCalled();
    expect(extensionApi.permissions.remove).not.toHaveBeenCalled();
  });

  it('keeps at startup only the entries a granted pattern covers', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = [
      'chat.openai.com',
      'claude.ai',
      'kimi.com',
      'qwen.ai',
    ];
    // Plugin grants for the page hosts (kimi.com's page is www.kimi.com), and
    // Prompt Manager's own for qwen.ai. Nothing grants chat.openai.com.
    grant(
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://www.kimi.com/*',
      ...coverageGrants('qwen.ai'),
    );
    await mount();
    await settle();

    expect(coverage()).toEqual(['claude.ai', 'kimi.com', 'qwen.ai']);
    expect(siteRow('chatgpt').textContent).not.toContain(PROMPT_MANAGER);
    expect(siteRow('claude').textContent).toContain(PROMPT_MANAGER);
  });
});

describe('Firefox', () => {
  let userAgent: { mockRestore: () => void } | undefined;
  afterEach(() => userAgent?.mockRestore());

  it('asks inside the click for the first feature, and a later plugin missing only its companion reuses the site', async () => {
    userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Macintosh; rv:128.0) Gecko/20100101 Firefox/128.0');
    openTab('https://claude.ai/new');
    await mount();

    // The prompt has to be the gesture's first await, so it starts before the click returns.
    act(() => promptSwitch().click());
    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: coverageGrants('claude.ai'),
    });
    await settle();
    expect(coverage()).toEqual(['claude.ai']);

    await act(async () => pluginSwitch(READING_WIDTH).click());

    expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
    expect(pluginSwitch(READING_WIDTH).checked).toBe(true);
    expect(buttonWithText(en.pluginGrantRequiredAccess)).toBeDefined();
  });
});
