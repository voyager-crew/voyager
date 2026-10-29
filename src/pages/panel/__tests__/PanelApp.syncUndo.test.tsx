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
  FOLDER_FILES,
  PROMPTS_FILE,
  conversationIds,
  folders,
  openSheet,
  primary,
  prompt,
  startDivergedDevice,
  startSyncBackground,
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
    // The run created this file, so a complete Undo returns the cloud to no file.
    expect(bg.drive.trashed.has(FOLDER_FILES.chatgpt)).toBe(true);
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

  it('keeps another device update made after upload but before its reply reaches the sheet', async () => {
    const bg = await startDivergedDevice();
    local[SCOPE] = { shared: true, sites: { aistudio: false } };
    const background = extensionApi.runtime.sendMessage.getMockImplementation();
    let updatedElsewhere = false;
    extensionApi.runtime.sendMessage.mockImplementation(
      async (message: { type?: string; payload?: { selection?: string } }) => {
        const reply = await background?.(message);
        if (
          message.type === 'gv.sync.upload' &&
          message.payload?.selection === 'shared' &&
          !updatedElsewhere
        ) {
          updatedElsewhere = true;
          const localPrompts = local[StorageKeys.PROMPT_ITEMS];
          local[StorageKeys.PROMPT_ITEMS] = [prompt('other-device')];
          try {
            await bg.fromPopup('gv.sync.upload', { selection: 'shared' });
          } finally {
            local[StorageKeys.PROMPT_ITEMS] = localPrompts;
          }
        }
        return reply;
      },
    );
    await openSheet();
    await click(primary());
    await until(() => toastText().includes('Synced 3'));
    expect(bg.drive.payload(PROMPTS_FILE)).toMatchObject({ items: [prompt('other-device')] });

    await click(toastUndo());
    await until(() => toastText().includes('Sync undone') || toastText().includes('changed since'));

    expect(bg.drive.payload(PROMPTS_FILE)).toMatchObject({ items: [prompt('other-device')] });
    expect(toastText()).toContain('kept');
    expect(bg.drive.trashed.has(FOLDER_FILES.chatgpt)).toBe(true);
  });

  it('offers no Undo when one upload in a mixed run lacks a complete receipt', async () => {
    const bg = await startDivergedDevice();
    local[SCOPE] = { shared: true, sites: { aistudio: false } };
    const background = extensionApi.runtime.sendMessage.getMockImplementation();
    extensionApi.runtime.sendMessage.mockImplementation(
      async (message: { type?: string; payload?: { platform?: string } }) => {
        const reply: unknown = await background?.(message);
        return message.type === 'gv.sync.upload' &&
          message.payload?.platform === 'chatgpt' &&
          reply &&
          typeof reply === 'object'
          ? { ...reply, uploadReceipt: { files: [], complete: false } }
          : reply;
      },
    );
    await openSheet();
    await click(primary());
    await until(() => toastText().includes('Synced 3'));

    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2', 'c3']);
    expect(conversationIds(bg.cloudFolders('chatgpt'))).toEqual(['x1']);
    expect(toastUndo()).toBeNull();
  });

  it.each(['missing', 'incomplete'])(
    'offers no snapshot-only Undo after a partial upload has a %s receipt',
    async (receipt) => {
      const bg = await startDivergedDevice();
      local[SCOPE] = {
        shared: false,
        sites: { gemini: false, aistudio: false, chatgpt: false },
      };
      const background = extensionApi.runtime.sendMessage.getMockImplementation();
      extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
        const reply: unknown = await background?.(message);
        return message.type === 'gv.sync.upload' && reply && typeof reply === 'object'
          ? {
              ...reply,
              ok: false,
              error: 'sync_failed',
              partial: true,
              uploadReceipt: receipt === 'missing' ? undefined : { files: [], complete: false },
            }
          : reply;
      });
      await openSheet('claude');
      await click(primary());
      await until(() => toastText() !== '');

      expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2', 'c3']);
      expect(conversationIds(bg.cloudFolders('claude'))).toEqual(['c1', 'c2', 'c3']);
      expect(toastUndo()).toBeNull();
    },
  );

  it('undoes the download and all receipted writes when a later upload phase fails', async () => {
    const bg = await startDivergedDevice();
    local[SCOPE] = {
      shared: false,
      sites: { gemini: false, aistudio: false, chatgpt: false },
    };
    const background = extensionApi.runtime.sendMessage.getMockImplementation();
    extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
      const reply: unknown = await background?.(message);
      return message.type === 'gv.sync.upload' && reply && typeof reply === 'object'
        ? { ...reply, ok: false, error: 'sync_failed', partial: true }
        : reply;
    });
    await openSheet('claude');
    await click(primary());
    await until(() => toastText() !== '');
    expect(toastUndo()?.textContent).toBe('Undo');

    await click(toastUndo());
    await until(() => toastText().includes('Sync undone'));

    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2']);
    expect(conversationIds(bg.cloudFolders('claude'))).toEqual(['c1', 'c3']);
  });
});

describe('a first cloud upload', () => {
  async function firstUpload() {
    const bg = await startSyncBackground();
    local[SCOPE] = {
      shared: false,
      sites: { gemini: false, aistudio: false, claude: false },
    };
    local[FOLDER_KEYS.chatgpt] = folders('chatgpt', 'X', ['x1']);
    return bg;
  }

  it('removes every file it created when Undo is pressed', async () => {
    const bg = await firstUpload();
    await openSheet();
    await click(primary());
    await until(() => toastText().includes('Synced 1'));
    expect(conversationIds(bg.cloudFolders('chatgpt'))).toEqual(['x1']);

    await click(toastUndo());
    await until(
      () => toastText().includes('Sync undone') || toastText().includes('Nothing to undo'),
    );

    expect(bg.drive.trashed.has(FOLDER_FILES.chatgpt)).toBe(true);
    expect(conversationIds(local[FOLDER_KEYS.chatgpt])).toEqual(['x1']);
  });

  it.each(['missing', 'incomplete', 'no undo target'])(
    'offers no Undo with a %s upload receipt',
    async (receipt) => {
      const bg = await firstUpload();
      const background = extensionApi.runtime.sendMessage.getMockImplementation();
      extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
        const reply: unknown = await background?.(message);
        const uploadReceipt =
          receipt === 'missing'
            ? undefined
            : receipt === 'incomplete'
              ? { files: [], complete: false }
              : {
                  complete: true,
                  files: [
                    { name: FOLDER_FILES.chatgpt, fileId: 'created', md5Checksum: 'written' },
                  ],
                };
        return message.type === 'gv.sync.upload' && reply && typeof reply === 'object'
          ? { ...reply, uploadReceipt }
          : reply;
      });
      await openSheet();
      await click(primary());
      await until(() => toastText().includes('Synced 1'));

      expect(conversationIds(bg.cloudFolders('chatgpt'))).toEqual(['x1']);
      expect(toastUndo()).toBeNull();
    },
  );
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

  it('keeps the upload write receipts when only bookkeeping failed', async () => {
    const bg = await startDivergedDevice();
    local[SCOPE] = { shared: true, sites: { aistudio: false } };
    const background = extensionApi.runtime.sendMessage.getMockImplementation();
    extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
      const reply: unknown = await background?.(message);
      return message.type === 'gv.sync.upload' && reply && typeof reply === 'object'
        ? { ...reply, ok: false, error: 'sync_metadata_unavailable' }
        : reply;
    });
    await openSheet();
    await click(primary());
    await until(() => toastText().includes('Synced 3'));
    expect(toastUndo()?.textContent).toBe('Undo');
    expect(container.querySelector('#sync-foot .ago')?.textContent).toBe(
      "Sync status couldn't be recorded",
    );

    await click(toastUndo());
    await until(() => toastText().includes('Sync undone'));

    expect(conversationIds(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2']);
    expect(conversationIds(bg.cloudFolders('claude'))).toEqual(['c1', 'c3']);
    expect(bg.drive.payload(PROMPTS_FILE)).toMatchObject({ items: [prompt('local')] });
    expect(bg.drive.trashed.has(FOLDER_FILES.chatgpt)).toBe(true);
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
