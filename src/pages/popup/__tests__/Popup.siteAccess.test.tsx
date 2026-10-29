import { act } from 'react';

import { beforeEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';

import { BUILT_IN_SITES, CATALOG_SITES } from '../utils/siteAccessSites';
import { container, en, extensionApi, local, mount, sync, unmount } from './popupHarness';
import {
  buttonWithText,
  coverage,
  coverageGrants,
  grant,
  granted,
  otherWebsites,
  pluginSwitch,
  promptSwitch,
  siteRow,
} from './siteAccessHarness';

const CLAUDE_URL = 'https://claude.ai/new';
const DRAFT_SAVE = 'Claude · Draft auto-save';
const READING_WIDTH = 'Claude · Comfortable Reading Width';
const CLAUDE_COVERAGE = coverageGrants('claude.ai');

describe('Popup site access', () => {
  describe('on Claude', () => {
    beforeEach(() => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 9, url: CLAUDE_URL }]);
    });

    it('asks for the site once when Prompt Manager is its first feature, and a plugin reuses it', async () => {
      await mount();
      await act(async () => promptSwitch().click());

      expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
        origins: CLAUDE_COVERAGE,
      });
      expect(coverage()).toEqual(['claude.ai']);

      await act(async () => pluginSwitch(DRAFT_SAVE).click());

      expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
      expect(pluginSwitch(DRAFT_SAVE).checked).toBe(true);
    });

    it('turns Prompt Manager on without asking again when a plugin was the first feature', async () => {
      await mount();
      await act(async () => pluginSwitch(DRAFT_SAVE).click());
      expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
        origins: ['https://claude.ai/*'],
      });

      await act(async () => promptSwitch().click());

      expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
      expect(promptSwitch().checked).toBe(true);
      expect(coverage()).toEqual(['claude.ai']);
    });

    it('a later plugin missing only its companion frame turns on without a prompt and offers the repair', async () => {
      grant('https://claude.ai/*');
      await mount();
      await act(async () => pluginSwitch(READING_WIDTH).click());

      expect(extensionApi.permissions.request).not.toHaveBeenCalled();
      expect(pluginSwitch(READING_WIDTH).checked).toBe(true);
      expect(buttonWithText(en.pluginGrantRequiredAccess)).toBeDefined();
    });

    it('revoking the site from its own popup leaves its plugins asking for access again', async () => {
      grant('https://claude.ai/*');
      local[StorageKeys.PLUGINS_STATE] = {
        'voyager.claude-draft-save': { enabled: true, installedAt: 1 },
      };
      await mount();
      expect(buttonWithText(en.pluginGrantRequiredAccess)).toBeUndefined();

      await act(async () => buttonWithText(en.siteAccessRemove, siteRow('claude'))!.click());

      expect(granted.size).toBe(0);
      expect(pluginSwitch(DRAFT_SAVE).checked).toBe(true);
      expect(buttonWithText(en.pluginGrantRequiredAccess)).toBeDefined();
    });
  });

  describe('on Gemini', () => {
    it('revoking a site removes every grant that reaches it and its coverage, and undo restores both in place', async () => {
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai', 'qwen.ai'];
      const claudeGrants = [
        ...CLAUDE_COVERAGE,
        'https://claude.ai/*',
        'https://*.frame.claudeusercontent.com/*',
      ];
      grant(...claudeGrants, ...coverageGrants('qwen.ai'));
      await mount();
      expect(siteRow('claude').textContent).toContain(en.siteAccessAllowed);

      await act(async () => buttonWithText(en.siteAccessRemove, siteRow('claude'))!.click());

      expect(extensionApi.permissions.remove).toHaveBeenCalledOnce();
      expect([...extensionApi.permissions.remove.mock.calls[0][0].origins].sort()).toEqual(
        [...claudeGrants].sort(),
      );
      expect(coverage()).toEqual(['qwen.ai']);
      expect([...granted].sort()).toEqual([...coverageGrants('qwen.ai')].sort());
      expect(siteRow('claude').textContent).toContain(en.siteAccessNotAllowed);

      await act(async () => buttonWithText(en.pluginToggleUndo)!.click());

      expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
      expect([...extensionApi.permissions.request.mock.calls[0][0].origins].sort()).toEqual(
        [...claudeGrants].sort(),
      );
      expect(coverage()).toEqual(['claude.ai', 'qwen.ai']);
      expect(siteRow('claude').textContent).toContain(en.siteAccessAllowed);
    });

    it('a coverage list saved by the previous popup shows the same sites as on, unchanged', async () => {
      // What the old quick chips wrote, each with the grant its chip asked for.
      const stored = [
        'chatgpt.com',
        'claude.ai',
        'deepseek.com',
        'kimi.com',
        'qwen.ai',
        'notebooklm.google.com',
      ];
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = stored;
      grant(...stored.flatMap(coverageGrants));
      await mount();

      for (const id of ['chatgpt', 'claude', 'deepseek', 'kimi']) {
        expect(siteRow(id).textContent).toContain(en.siteAccessAllowed);
        expect(siteRow(id).textContent).toContain(en.promptManagerOptions);
      }
      expect(otherWebsites().sort()).toEqual(['notebooklm.google.com', 'qwen.ai']);
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      expect(coverage()).toEqual(stored);
    });

    it('lists a website outside the catalog only under other websites', async () => {
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai', 'example.org'];
      grant(...CLAUDE_COVERAGE, ...coverageGrants('example.org'));
      await mount();

      expect(otherWebsites()).toEqual(['example.org']);
      const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-site-access]'));
      expect(rows.some((row) => row.textContent?.includes('example.org'))).toBe(false);
      expect(siteRow('claude').textContent).toContain(en.promptManagerOptions);
    });
  });

  describe('on another website', () => {
    /** The websites the add group offers, by address. */
    const offered = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          `[role="group"][aria-label="${en.addWebsite}"] button`,
        ),
        (chip) => chip.title,
      );
    const pageChip = (website: string) =>
      container.querySelector<HTMLButtonElement>(
        `[role="group"][aria-label="${en.addWebsite}"] button[title="${website}"]`,
      );
    const openTab = async (url: string) => {
      await unmount();
      extensionApi.tabs.query.mockResolvedValue([{ id: 9, url }]);
      await mount();
    };

    it('offers the open page once, then lists it like any added website', async () => {
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['qwen.ai'];
      grant(...coverageGrants('qwen.ai'));
      await openTab('https://www.poe.com/chat/1');

      expect(offered().filter((website) => website === 'poe.com')).toHaveLength(1);
      expect(offered().filter((website) => customWebsitesIncludeHost(coverage(), website))).toEqual(
        [],
      );

      await act(async () => pageChip('poe.com')!.click());

      expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
        origins: coverageGrants('poe.com'),
      });
      expect(coverage()).toEqual(['qwen.ai', 'poe.com']);
      expect(otherWebsites()).toEqual(['qwen.ai', 'poe.com']);
      expect(offered()).not.toContain('poe.com');
    });

    it('offers a local web UI with its port, and a page that only shares a supported site’s domain', async () => {
      for (const [url, website] of [
        ['http://localhost:3080/', 'localhost:3080'],
        ['https://console.claude.ai/settings', 'console.claude.ai'],
        ['https://claude.ai:8443/', 'claude.ai:8443'],
      ]) {
        await openTab(url);
        await act(async () => pageChip(website)!.click());
        expect(otherWebsites()).toContain(website);
      }
      expect(coverage()).toEqual(['localhost:3080', 'console.claude.ai', 'claude.ai:8443']);
    });

    it('never offers a supported or built-in site, the open one included', async () => {
      for (const url of [CLAUDE_URL, 'https://gemini.google.com/app']) {
        await openTab(url);
        for (const host of [...CATALOG_SITES, ...BUILT_IN_SITES].flatMap((site) => site.hosts)) {
          expect(customWebsitesIncludeHost(offered(), host)).toBe(false);
        }
      }
    });
  });
});
