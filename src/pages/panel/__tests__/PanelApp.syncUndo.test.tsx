import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { includeGrantedSites } from '@/pages/background/siteGrantSyncScope';

import {
  byId,
  click,
  container,
  extensionApi,
  granted,
  local,
  mount,
  tab,
  writeElsewhere,
} from './panelHarness';
import {
  FOLDER_KEYS,
  PROMPTS_FILE,
  conversationIds,
  openSheet,
  primary,
  prompt,
  startDivergedDevice,
  toastText,
  toastUndo,
  until,
} from './panelSyncHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const SCOPE = StorageKeys.CLOUD_SYNC_SCOPE;

/** The diverged device, synced from the sheet: 通用 up, Claude merged down and up, ChatGPT up. */
async function syncedFromSheet() {
  const bg = await startDivergedDevice();
  local[SCOPE] = { shared: true, sites: { aistudio: false } };
  await openSheet();
  await click(primary());
  await until(() => toastText().includes('Synced 3'));
  expect(toastUndo()?.textContent).toBe('Undo');
  return bg;
}

describe('undoing a sync from its toast', () => {
  it("puts back this run's download and the cloud files its uploads replaced", async () => {
    const bg = await syncedFromSheet();

    await click(toastUndo());
    await until(() => toastText().includes('Sync undone'));

    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2']);
    expect(conversationIds(bg.cloudFolders('claude'))).toEqual(['c1', 'c3']);
    expect(bg.drive.payload(PROMPTS_FILE)).toMatchObject({ items: [prompt('local')] });
    // The cloud had no ChatGPT file before this run, so there is no earlier copy to restore.
    expect(conversationIds(bg.cloudFolders('chatgpt'))).toEqual(['x1']);
  });

  it('touches nothing once a later sync owns the undo snapshot', async () => {
    const bg = await syncedFromSheet();
    // Another window merges Gemini down before 撤销 is pressed; its snapshot replaces this one's.
    await bg.fromPopup('gv.sync.download', { selection: 'site' });
    const calls = bg.calls.length;

    await click(toastUndo());
    await until(() => toastText().includes("Can't undo"));

    expect(toastText()).toContain("Can't undo: a later download replaced this one");
    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2', 'c3']);
    expect(conversationIds(bg.cloudFolders('claude'))).toEqual(['c1', 'c2', 'c3']);
    expect(bg.drive.payload(PROMPTS_FILE)).toMatchObject({
      items: [prompt('local'), prompt('edit')],
    });
    expect(bg.calls.slice(calls).map((call) => call.type)).not.toContain('restorePreviousVersion');
  });
});

describe('a sync whose status could not be recorded', () => {
  it('keeps the result and its undo, and says so in the footer', async () => {
    const bg = await startDivergedDevice();
    local[SCOPE] = { shared: true, sites: { aistudio: false } };
    const background = extensionApi.runtime.sendMessage.getMockImplementation();
    extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) =>
      message?.type === 'gv.sync.completeDownload'
        ? { ok: false, error: 'stale_download' }
        : background?.(message),
    );
    await openSheet();
    await click(primary());
    await until(() => toastText().includes('Synced 3'));

    expect(toastUndo()?.textContent).toBe('Undo');
    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2', 'c3']);
    expect(bg.transfers()).toContain('upload claude');
    expect(container.querySelector('#sync-foot .ago')?.textContent).toBe(
      "Sync status couldn't be recorded",
    );
  });
});

describe('a site turned on in the panel', () => {
  const claudeSwitch = () => byId('panel-site-switch-claude') as HTMLButtonElement;

  async function turnClaudeOn(): Promise<void> {
    await mount();
    await click(tab('sites'));
    await click(claudeSwitch());
    await until(() => toastText().includes('Claude now syncs'));
    expect(granted.has('https://claude.ai/*')).toBe(true);
  }

  const turnedOff = { shared: false, sites: { claude: false, chatgpt: false } };

  it('joins sync, and 撤销 puts the scope back exactly', async () => {
    local[SCOPE] = structuredClone(turnedOff);
    await turnClaudeOn();
    expect(local[SCOPE]).toMatchObject({ sites: { claude: true } });

    await click(toastUndo());
    await until(() => (local[SCOPE] as typeof turnedOff).sites.claude === false);
    expect(local[SCOPE]).toEqual(turnedOff);
    expect(claudeSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it("puts the scope back even when the background's grant listener included the site first", async () => {
    local[SCOPE] = structuredClone(turnedOff);
    // The background sees permissions.onAdded before the panel reads the browser's answer.
    extensionApi.permissions.request.mockImplementationOnce(
      async ({ origins }: { origins: string[] }) => {
        for (const origin of origins) granted.add(origin);
        await includeGrantedSites(origins);
        return true;
      },
    );
    await turnClaudeOn();
    expect(local[SCOPE]).toMatchObject({ sites: { claude: true } });

    await click(toastUndo());
    await until(() => (local[SCOPE] as typeof turnedOff).sites.claude === false);
    expect(local[SCOPE]).toEqual(turnedOff);
  });

  it('offers no Undo when the site already synced, and writes nothing', async () => {
    await turnClaudeOn();

    expect(SCOPE in local).toBe(false);
    expect(toastUndo()).toBeNull();
  });

  it('keeps a later change to another row when 撤销 turns the site off again', async () => {
    local[SCOPE] = structuredClone(turnedOff);
    await turnClaudeOn();
    await writeElsewhere('local', {
      [SCOPE]: { shared: true, sites: { claude: true, chatgpt: false } },
    });

    await click(toastUndo());
    await until(() => (local[SCOPE] as typeof turnedOff).sites.claude === false);
    expect(local[SCOPE]).toEqual({ shared: true, sites: { claude: false, chatgpt: false } });
  });
});
