import { act } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { container, en, extensionApi, local, mount, sync } from './popupHarness';

const CLAUDE_URL = 'https://claude.ai/new';
const DRAFT_SAVE = 'Claude · Draft auto-save';
const READING_WIDTH = 'Claude · Comfortable Reading Width';
const CLAUDE_COVERAGE = ['https://*.claude.ai/*', 'http://*.claude.ai/*'];

/**
 * The browser's grants, with Chrome's meaning of a match pattern: `*.x`
 * covers x itself and every subdomain, and `*` covers both schemes.
 */
let granted: Set<string>;
const listeners = { added: [] as (() => void)[], removed: [] as (() => void)[] };

function covers(grant: string, wanted: string): boolean {
  const parse = (pattern: string) => /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
  const [have, want] = [parse(grant), parse(wanted)];
  if (!have || !want) return grant === wanted;
  if (have[1] !== '*' && have[1] !== want[1]) return false;
  if (have[2] === want[2]) return true;
  if (!have[2].startsWith('*.')) return false;
  const domain = have[2].slice(2);
  const host = want[2].replace(/^\*\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

const holds = (origin: string) => [...granted].some((grant) => covers(grant, origin));
const coverage = () => sync[StorageKeys.PROMPT_CUSTOM_WEBSITES];
const siteRow = (id: string) => container.querySelector<HTMLElement>(`[data-site-access="${id}"]`)!;
const pluginSwitch = (name: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const buttonWithText = (text: string, within: ParentNode = container) =>
  Array.from(within.querySelectorAll('button')).find((button) => button.textContent === text);
const otherWebsites = () =>
  Array.from(
    container.querySelectorAll<HTMLElement>(`section[aria-labelledby] li > bdi`),
    (entry) => entry.textContent,
  );

describe('Popup site access', () => {
  beforeEach(() => {
    granted = new Set();
    listeners.added = [];
    listeners.removed = [];
    // Dynamic registration is what lets a plugin be granted and injected at all.
    vi.stubGlobal('chrome', {
      ...extensionApi,
      scripting: { registerContentScripts: vi.fn(), unregisterContentScripts: vi.fn() },
    });
    const { permissions } = extensionApi;
    permissions.contains.mockImplementation(async ({ origins }: { origins: string[] }) =>
      origins.every(holds),
    );
    permissions.request.mockImplementation(async ({ origins }: { origins: string[] }) => {
      for (const origin of origins) granted.add(origin);
      for (const listener of listeners.added) listener();
      return true;
    });
    permissions.remove.mockImplementation(async ({ origins }: { origins: string[] }) => {
      for (const origin of origins) granted.delete(origin);
      for (const listener of listeners.removed) listener();
      return true;
    });
    permissions.getAll.mockImplementation(async () => ({ origins: [...granted], permissions: [] }));
    permissions.onAdded.addListener.mockImplementation((listener: () => void) =>
      listeners.added.push(listener),
    );
    permissions.onRemoved.addListener.mockImplementation((listener: () => void) =>
      listeners.removed.push(listener),
    );
  });

  describe('on Claude', () => {
    beforeEach(() => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 9, url: CLAUDE_URL }]);
    });

    it('asks for the site once when Prompt Manager is its first feature, and a plugin reuses it', async () => {
      await mount();
      await act(async () =>
        container.querySelector<HTMLInputElement>('#prompt-manager-site-enabled')!.click(),
      );

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

      const prompt = container.querySelector<HTMLInputElement>('#prompt-manager-site-enabled')!;
      await act(async () => prompt.click());

      expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
      expect(prompt.checked).toBe(true);
      expect(coverage()).toEqual(['claude.ai']);
    });

    it('a later plugin missing only its companion frame turns on without a prompt and offers the repair', async () => {
      granted.add('https://claude.ai/*');
      await mount();
      await act(async () => pluginSwitch(READING_WIDTH).click());

      expect(extensionApi.permissions.request).not.toHaveBeenCalled();
      expect(pluginSwitch(READING_WIDTH).checked).toBe(true);
      expect(buttonWithText(en.pluginGrantRequiredAccess)).toBeDefined();
    });

    it('revoking the site from its own popup leaves its plugins asking for access again', async () => {
      granted.add('https://claude.ai/*');
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

  it('shows the old DeepSeek quick choice as on there, and switching it off takes it out', async () => {
    // The old quick choice stored the bare domain, which covers chat.deepseek.com.
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['deepseek.com', 'qwen.ai'];
    granted = new Set([
      'https://*.deepseek.com/*',
      'http://*.deepseek.com/*',
      'https://*.qwen.ai/*',
      'http://*.qwen.ai/*',
    ]);
    extensionApi.tabs.query.mockResolvedValue([
      { id: 11, url: 'https://chat.deepseek.com/a/chat' },
    ]);
    await mount();
    const prompt = container.querySelector<HTMLInputElement>('#prompt-manager-site-enabled')!;
    expect(prompt.checked).toBe(true);

    await act(async () => prompt.click());

    expect(prompt.checked).toBe(false);
    expect(coverage()).toEqual(['qwen.ai']);
    expect(siteRow('deepseek').textContent).not.toContain(en.promptManagerOptions);
  });

  describe('on Gemini', () => {
    it('revoking a site removes every grant that reaches it and its coverage, and undo restores both', async () => {
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai', 'qwen.ai'];
      const claudeGrants = [
        ...CLAUDE_COVERAGE,
        'https://claude.ai/*',
        'https://*.frame.claudeusercontent.com/*',
      ];
      granted = new Set([...claudeGrants, 'https://*.qwen.ai/*', 'http://*.qwen.ai/*']);
      await mount();
      expect(siteRow('claude').textContent).toContain(en.siteAccessAllowed);

      await act(async () => buttonWithText(en.siteAccessRemove, siteRow('claude'))!.click());

      expect(extensionApi.permissions.remove).toHaveBeenCalledOnce();
      expect([...extensionApi.permissions.remove.mock.calls[0][0].origins].sort()).toEqual(
        [...claudeGrants].sort(),
      );
      expect(coverage()).toEqual(['qwen.ai']);
      expect([...granted].sort()).toEqual(['http://*.qwen.ai/*', 'https://*.qwen.ai/*']);
      expect(siteRow('claude').textContent).toContain(en.siteAccessNotAllowed);

      await act(async () => buttonWithText(en.pluginToggleUndo)!.click());

      expect(extensionApi.permissions.request).toHaveBeenCalledOnce();
      expect([...extensionApi.permissions.request.mock.calls[0][0].origins].sort()).toEqual(
        [...claudeGrants].sort(),
      );
      expect(coverage()).toEqual(expect.arrayContaining(['claude.ai', 'qwen.ai']));
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
      granted = new Set(stored.flatMap((site) => [`https://*.${site}/*`, `http://*.${site}/*`]));
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
      granted = new Set([...CLAUDE_COVERAGE, 'https://*.example.org/*', 'http://*.example.org/*']);
      await mount();

      expect(otherWebsites()).toEqual(['example.org']);
      const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-site-access]'));
      expect(rows.some((row) => row.textContent?.includes('example.org'))).toBe(false);
      expect(siteRow('claude').textContent).toContain(en.promptManagerOptions);
    });
  });
});
