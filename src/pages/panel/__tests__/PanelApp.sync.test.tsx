import { describe, expect, it, vi } from 'vitest';

import { guardDetails } from '@/core/services/cloudSyncNotices';
import { StorageKeys } from '@/core/types/common';

import { click, container, en, extensionApi, local, press } from './panelHarness';
import {
  FOLDER_KEYS,
  PROMPTS_FILE,
  cloudButton,
  conversationIds,
  folders,
  footButton,
  openSheet,
  primary,
  prompt,
  rowStatus,
  rowSwitch,
  sheet,
  startDivergedDevice,
  startSyncBackground,
  syncRow,
  toastText,
  until,
} from './panelSyncHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const SCOPE = StorageKeys.CLOUD_SYNC_SCOPE;
const ids = conversationIds;

describe('the cloud sync sheet', () => {
  it('shows each row and its status from the background, and a switch writes only its row', async () => {
    const bg = await startDivergedDevice();
    await openSheet();

    expect(cloudButton()?.getAttribute('aria-expanded')).toBe('true');
    expect(rowStatus('shared')).toBe('Newer here');
    expect(rowStatus('gemini')).toBe('Synced');
    // Nothing here and nothing in the cloud: nothing to sync.
    expect(rowStatus('aistudio')).toBe('Synced');
    expect(rowStatus('chatgpt')).toBe('Not uploaded');
    expect(rowStatus('claude')).toBe('Newer in cloud');
    expect(primary()?.textContent).toBe('Sync 3');

    await click(rowSwitch('chatgpt'));
    await until(() => primary()?.textContent === 'Sync 2');
    expect(local[SCOPE]).toEqual({ shared: true, sites: { chatgpt: false } });
    expect(syncRow('chatgpt')?.className).toBe('sr off');
    // Opening and switching read metadata only; nothing went up or down.
    expect(bg.transfers()).toEqual([]);
  });

  it('runs each row in its own direction, merging a row changed on both sides before uploading it', async () => {
    const bg = await startDivergedDevice();
    local[SCOPE] = { shared: true, sites: { aistudio: false } };
    await openSheet();

    await click(primary());
    await until(() => toastText().includes('Synced 3'));

    expect(bg.transfers()).toEqual([
      'upload shared',
      'upload chatgpt',
      'download claude',
      'complete',
      'upload claude',
    ]);
    expect(ids(local[FOLDER_KEYS.claude])).toEqual(['c1', 'c2', 'c3']);
    expect(ids(bg.cloudFolders('claude'))).toEqual(['c1', 'c2', 'c3']);
    expect(ids(bg.cloudFolders('chatgpt'))).toEqual(['x1']);
    expect(bg.drive.payload(PROMPTS_FILE)).toMatchObject({
      items: [prompt('local'), prompt('edit')],
    });
    expect(cloudButton()?.classList.contains('done')).toBe(true);
    // Fresh statuses replace the run's optimistic ones; the run's 通用 files now match.
    await until(() => !container.querySelector('.st.pop') && rowStatus('shared') === 'Synced');
  });
});

describe('the shrink guard', () => {
  /** ChatGPT's four folder items synced, then every one deleted here. */
  async function emptiedDevice() {
    const bg = await startSyncBackground();
    local[SCOPE] = { shared: true, sites: { aistudio: false, claude: false } };
    local[FOLDER_KEYS.gemini] = folders('gemini', 'G', ['g1']);
    local[FOLDER_KEYS.chatgpt] = folders('chatgpt', 'X', ['x1', 'x2', 'x3']);
    await bg.fromPopup('gv.sync.upload');
    await bg.fromPopup('gv.sync.upload', { platform: 'chatgpt', selection: 'site' });
    local[FOLDER_KEYS.chatgpt] = { folders: [], folderContents: {} };
    await openSheet();
    expect(rowStatus('chatgpt')).toBe('Newer here');
    const writes = bg.drive.writes.length;
    await click(primary());
    await until(() => container.querySelector('.warn[role="alert"]') !== null);
    return { bg, writes };
  }

  it('stops before the upload and writes nothing on either side until a choice', async () => {
    const { bg, writes } = await emptiedDevice();

    // The shared guard copy, with the zero set in red.
    const refused = {
      kind: 'folders',
      localCount: 0,
      cloudCount: 4,
      reason: 'empty_local',
    } as const;
    expect(container.querySelector('.warn .wl')?.textContent).toBe(
      guardDetails((key) => en[key], 'chatgpt', [refused])[0],
    );
    expect(container.querySelector('.warn .wl')?.textContent).toBe(
      'Folders (ChatGPT): cloud 4 → 0',
    );
    expect(container.querySelector('.warn b.z')?.textContent).toBe('0');
    expect(document.activeElement?.textContent).toBe('Merge from cloud instead');
    expect(bg.transfers()).toEqual(['upload chatgpt']);
    expect(bg.drive.writes).toHaveLength(writes);
    expect(local[FOLDER_KEYS.chatgpt]).toEqual({ folders: [], folderContents: {} });

    // Closing on the warning ends the run, still writing nothing.
    await press('Escape');
    expect(sheet()?.classList.contains('open')).toBe(false);
    await click(cloudButton());
    expect(container.querySelector('.warn')).toBeNull();
    expect(bg.transfers()).toEqual(['upload chatgpt']);
    expect(bg.drive.writes).toHaveLength(writes);
  });

  it('merges the cloud folders back in, then uploads the whole set', async () => {
    const { bg } = await emptiedDevice();
    await click(footButton('Merge from cloud instead'));
    await until(() => toastText().includes('Synced 1'));

    expect(bg.transfers()).toEqual([
      'upload chatgpt',
      'download chatgpt',
      'complete',
      'upload chatgpt',
    ]);
    expect(ids(local[FOLDER_KEYS.chatgpt])).toEqual(['x1', 'x2', 'x3']);
    expect(ids(bg.cloudFolders('chatgpt'))).toEqual(['x1', 'x2', 'x3']);
  });

  it('asks again when the forced retry no longer matches the refusal it answers', async () => {
    const { bg, writes } = await emptiedDevice();
    // An empty folder comes back here before the answer: the background recomputes another refusal.
    local[FOLDER_KEYS.chatgpt] = folders('chatgpt', 'X', []);
    const conversations = local[FOLDER_KEYS.chatgpt];
    await click(footButton('Upload anyway'));
    await until(() => bg.transfers().length === 2 && !!container.querySelector('.warn'));

    expect(bg.transfers()).toEqual(['upload chatgpt', 'upload chatgpt force']);
    expect(container.querySelector('.warn .wl')?.textContent).toBe(
      'Folders (ChatGPT): cloud 4 → 1',
    );
    expect(bg.drive.writes).toHaveLength(writes);
    expect(local[FOLDER_KEYS.chatgpt]).toBe(conversations);
  });

  it('uploads the empty set only after 仍然上传, as a forced retry of the same row', async () => {
    const { bg } = await emptiedDevice();
    await click(footButton('Upload anyway'));
    await until(() => toastText().includes('Synced 1'));

    expect(bg.transfers()).toEqual(['upload chatgpt', 'upload chatgpt force']);
    expect(bg.cloudFolders('chatgpt')).toEqual({ folders: [], folderContents: {} });
  });
});

describe('a panel frame the background has not redeemed', () => {
  it('gets no status and can start no transfer', async () => {
    const bg = await startSyncBackground({ redeemed: false });
    local[FOLDER_KEYS.chatgpt] = folders('chatgpt', 'X', ['x1']);
    await openSheet();

    const status = extensionApi.runtime.sendMessage.mock.calls.findIndex(
      ([message]) => (message as { type?: string }).type === 'gv.sync.getStatus',
    );
    await expect(
      extensionApi.runtime.sendMessage.mock.results[status]?.value,
    ).resolves.toMatchObject({ ok: false, error: 'untrusted_sender' });
    expect(rowStatus('chatgpt')).toBe("Couldn't check");
    expect(primary()?.textContent).toBe("Couldn't check");
    expect(primary()?.disabled).toBe(true);
    expect(bg.transfers()).toEqual([]);
    expect(bg.drive.writes).toEqual([]);
  });
});
