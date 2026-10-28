import { act } from 'react';

import { beforeEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  container,
  en,
  extensionApi,
  local,
  MERMAID_SWITCH,
  mount,
  openRailOptions,
  sync,
  unmount,
} from './popupHarness';

describe('Popup settings on plugin-site tabs', () => {
  describe('the rail options on a ChatGPT tab', () => {
    const PLUGIN_ID = 'voyager.chatgpt-timeline';
    const shownButton = (label: string) =>
      [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label && !candidate.closest('[hidden]'),
      );
    const chatGptTimelineSettings = () =>
      (
        local[StorageKeys.PLUGINS_STATE] as Record<string, { settings?: Record<string, unknown> }>
      )?.[PLUGIN_ID]?.settings;

    const mountWithOptions = async () => {
      await mount();
      await openRailOptions('ChatGPT · Timeline');
    };

    beforeEach(() => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
      local[StorageKeys.PLUGINS_STATE] = { [PLUGIN_ID]: { enabled: true, installedAt: 1 } };
    });

    it('changing the timeline style changes the ChatGPT rail, not Gemini’s', async () => {
      sync[StorageKeys.GV_TIMELINE_ENABLED] = false;
      await mountWithOptions();

      expect(
        container
          .querySelector('[role="group"][aria-label="ChatGPT · Timeline"]')
          ?.querySelector('select'),
      ).toBeFalsy();
      // The plugin row is the rail's only switch.
      expect(container.querySelector('#timeline-enabled')).toBeNull();

      await act(async () => shownButton(en.timelineStyleCompact)!.click());

      expect(chatGptTimelineSettings()).toEqual(
        expect.objectContaining({ timelineStyle: 'compact' }),
      );
      expect(sync).not.toHaveProperty(StorageKeys.TIMELINE_STYLE);
      expect(sync[StorageKeys.GV_TIMELINE_ENABLED]).toBe(false);
    });

    it('choosing compact in the popup also compacts a page still running the older timeline manifest', async () => {
      await mountWithOptions();

      await act(async () => shownButton(en.timelineStyleCompact)!.click());

      // The older manifest's rail reads `compactView`, not `timelineStyle`, until the page reloads.
      expect(chatGptTimelineSettings()).toEqual(expect.objectContaining({ compactView: true }));
    });

    it('turning on node levels puts the ChatGPT rail back on dots', async () => {
      local[StorageKeys.PLUGINS_STATE] = {
        [PLUGIN_ID]: { enabled: true, installedAt: 1, settings: { timelineStyle: 'compact' } },
      };
      await mountWithOptions();
      const levels = container.querySelector<HTMLInputElement>('#marker-level-enabled')!;
      expect(container.querySelector(`input[aria-label="${en.enableMarkerLevel}"]`)).toBeNull();
      expect(levels.closest('[hidden]')).toBeNull();
      expect(levels.checked).toBe(false);

      await act(async () => levels.click());

      expect(levels.checked).toBe(true);
      expect(chatGptTimelineSettings()).toEqual(
        expect.objectContaining({ timelineStyle: 'dots', markerLevel: true }),
      );
      expect(sync).not.toHaveProperty('geminiTimelineMarkerLevel');
    });

    it('a ChatGPT send can show its time: the rail options offer the message-times switch on ChatGPT', async () => {
      await mountWithOptions();
      const times = container.querySelector<HTMLInputElement>('#show-message-timestamps')!;
      expect(times.closest('[hidden]')).toBeNull();
      expect(times.checked).toBe(false);

      await act(async () => times.click());

      expect(times.checked).toBe(true);
      // The rail records and shows send times only while this shared setting is on.
      expect(sync[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]).toBe(true);
    });

    it('a timeline site that cannot record sends does not offer the message-times switch', async () => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://claude.ai/chat/abc' }]);
      local[StorageKeys.PLUGINS_STATE] = {
        'voyager.claude-timeline': { enabled: true, installedAt: 1 },
      };
      await mount();
      await openRailOptions('Claude · Timeline');

      const times = container.querySelector<HTMLInputElement>('#show-message-timestamps');
      expect(!times || !!times.closest('[hidden]')).toBe(true);
    });

    it('a local rail keeps its own style control and gets no second one', async () => {
      const IMPORTED_ID = 'local.me.chatgpt-rail';
      local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
        [IMPORTED_ID]: {
          importedAt: 1,
          updatedAt: 1,
          manifest: {
            id: IMPORTED_ID,
            name: 'My ChatGPT rail',
            version: '1.0.0',
            description: 'A timeline for ChatGPT',
            author: 'Me',
            category: 'productivity',
            license: 'MIT',
            engine: '>=1.6.0',
            tier: 'declarative',
            matches: ['https://chatgpt.com/*'],
            contributes: {
              settings: {
                timelineStyle: {
                  type: 'select',
                  label: 'Timeline style',
                  default: 'dots',
                  options: [
                    { value: 'dots', label: 'Nodes' },
                    { value: 'compact', label: 'Compact' },
                  ],
                },
              },
              domOps: [{ op: 'native', target: 'body', handler: 'turnNavigator', params: {} }],
            },
          },
        },
      };
      local[StorageKeys.PLUGINS_STATE] = {
        [PLUGIN_ID]: { enabled: false, installedAt: 1 },
        [IMPORTED_ID]: { enabled: true, installedAt: 1 },
      };
      await mount();
      await openRailOptions('My ChatGPT rail');

      const select = container
        .querySelector('[role="group"][aria-label="My ChatGPT rail"]')
        ?.querySelector<HTMLSelectElement>('select');
      expect(select).toBeTruthy();
      expect(shownButton(en.timelineStyleCompact)).toBeUndefined();
      // Its options still hold what the rail does not declare.
      expect(shownButton(en.resetTimelinePosition)).toBeTruthy();
      await act(async () => {
        select!.value = 'compact';
        select!.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const state = local[StorageKeys.PLUGINS_STATE] as Record<
        string,
        { settings?: Record<string, unknown> }
      >;
      expect(state[IMPORTED_ID]?.settings).toEqual(
        expect.objectContaining({ timelineStyle: 'compact' }),
      );
      expect(state[PLUGIN_ID]?.settings).toBeUndefined();
    });

    it('resetting the position moves the ChatGPT rail home and leaves Gemini’s where it is', async () => {
      const placed = { version: 2, topPercent: 30, leftPercent: 80 };
      sync['gvTimeline:chatgpt:Position'] = placed;
      sync[StorageKeys.TIMELINE_POSITION] = placed;
      await mountWithOptions();

      await act(async () => shownButton(en.resetTimelinePosition)!.click());

      expect(sync['gvTimeline:chatgpt:Position']).toBeNull();
      expect(sync[StorageKeys.TIMELINE_POSITION]).toEqual(placed);
    });
  });

  it.each([
    ['https://claude.ai/chat/abc', 'voyager.claude-timeline', 'Claude · Timeline', true],
    [
      'https://chat.deepseek.com/a/chat/s/abc',
      'voyager.deepseek-timeline',
      'DeepSeek · Timeline',
      false,
    ],
  ] as const)(
    'offers one timeline settings entry on %s and keeps its stored values',
    async (url, id, name, levels) => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 10, url }]);
      local[StorageKeys.PLUGINS_STATE] = {
        [id]: { enabled: true, installedAt: 1, settings: { timelineStyle: 'ruler' } },
      };
      await mount();
      await openRailOptions(name);
      const group = container.querySelector(`[role="group"][aria-label="${name}"]`);
      expect(group?.querySelector('select')).toBeFalsy();
      expect(group?.querySelector('input[type="checkbox"]')).toBeFalsy();
      const levelSwitch = container.querySelector('#marker-level-enabled');
      expect(!!levelSwitch && !levelSwitch.closest('[hidden]')).toBe(levels);
      const compact = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === en.timelineStyleCompact && !button.closest('[hidden]'),
      );
      expect(compact).toBeTruthy();
      await act(async () => compact!.click());
      const state = local[StorageKeys.PLUGINS_STATE] as Record<
        string,
        { settings?: Record<string, unknown> }
      >;
      expect(state[id]?.settings).toEqual(
        expect.objectContaining({ timelineStyle: 'compact', compactView: true }),
      );
      expect(sync).not.toHaveProperty(StorageKeys.TIMELINE_STYLE);
    },
  );

  it('a timeline plugin site lets the user switch off the shortcuts its rail responds to', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    await mount();
    const toggle = container.querySelector<HTMLInputElement>('#shortcuts-enabled');
    expect(toggle && !toggle.closest('[hidden]')).toBeTruthy();

    await act(async () => toggle!.click());

    expect(sync[StorageKeys.TIMELINE_SHORTCUTS]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('shows ChatGPT Cloud Sync while keeping Gemini folders and isolation off the tab', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    local[StorageKeys.FOLDER_DATA] = { folders: [], folderContents: {} };
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI] = true;
    await mount();
    expect(container.querySelector('#prompt-manager-site-enabled')).not.toBeNull();
    expect(container.textContent).toContain(en.cloudSync);
    // Flex order, then DOM order, decides what the user sees first.
    const promptCard = container
      .querySelector('#prompt-manager-site-enabled')!
      .closest('[style*="order"]')!;
    const blocks = Array.from(promptCard.parentElement!.children) as HTMLElement[];
    const shownBefore = (a: HTMLElement, b: HTMLElement) =>
      Number(a.style.order || 0) < Number(b.style.order || 0) ||
      (a.style.order === b.style.order && blocks.indexOf(a) < blocks.indexOf(b));
    const syncBlock = blocks.find(
      (block) => block !== promptCard && block.textContent?.includes(en.cloudSync),
    )!;
    const pluginList = blocks.find((block) => block.style.order === '-1')!;
    expect(shownBefore(syncBlock, promptCard as HTMLElement)).toBe(true);
    expect(shownBefore(syncBlock, pluginList)).toBe(true);
    expect(container.querySelector('#account-isolation-enabled')).toBeNull();
    expect(container.querySelector('#folder-enabled')).toBeNull();
    const requestedLocalKeys = extensionApi.storage.local.get.mock.calls.flatMap(([keys]) =>
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {}),
    );
    expect(requestedLocalKeys).not.toContain(StorageKeys.FOLDER_DATA);
    const messageTypes = extensionApi.runtime.sendMessage.mock.calls.map(
      ([message]) => (message as { type?: string } | undefined)?.type,
    );
    expect(messageTypes).not.toContain('gv.sync.upload');
    expect(messageTypes).not.toContain('gv.sync.download');
    expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
  });

  it('keeps ChatGPT Cloud Sync visible when a remembered native search has no clear control', async () => {
    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = 'Mermaid';
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe(
      'Mermaid',
    );
    expect(container.querySelector(MERMAID_SWITCH)).not.toBeNull();
    expect(container.textContent).not.toContain(en.cloudSync);

    await unmount();
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    await mount();
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(
      container.querySelector(`button[aria-label="${en.popupSettingsSearchClear}"]`),
    ).toBeNull();
    expect(container.querySelector('#prompt-manager-site-enabled')).not.toBeNull();
    expect(container.textContent).toContain(en.cloudSync);
    expect(container.querySelector(MERMAID_SWITCH)).toBeNull();

    await unmount();
    extensionApi.tabs.query.mockResolvedValue([{ id: 7, url: 'https://gemini.google.com/app' }]);
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe(
      'Mermaid',
    );
    expect(container.textContent).not.toContain(en.cloudSync);
    const clear = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${en.popupSettingsSearchClear}"]`,
    )!;
    await act(async () => clear.click());
    expect(container.textContent).toContain(en.cloudSync);
    expect(local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]).toBe('');
  });
});
