// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
/**
 * A user's Gemini folders as the folder manager left them, before the folders
 * primitive: `fixtures/geminiFolderData.json` holds the shapes a real profile
 * stores (nested and coloured folders, a root bucket, `c_<hex>` and legacy bare
 * `<hex>` ids, one conversation filed under both, gem chats, stars) with ids,
 * titles and times replaced, and what that build did with them. The update
 * must open them as they are, never rewrite them, upload and export the same
 * folders and import that file into an empty store as the same folders.
 *
 * Only `openGemini` knows how the page starts its folders; every assertion
 * reads storage, the messages sent, the downloaded file or the rendered tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { FolderManager } from '@/pages/content/folder/__tests__/geminiFolderManager';
import { mountSidebar } from '@/pages/content/folder/__tests__/sidebarRuntimeHarness';
import { sidebarTree, sidebarTreeRoot } from '@/pages/content/folder/__tests__/sidebarTreeDriver';
import { historyTimestampStore } from '@/pages/content/timestamp/historyTimestamps';

import fixture from './fixtures/geminiFolderData.json';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const STORED = fixture.stored as FolderData;
const KEY = StorageKeys.FOLDER_DATA;
const PRIMARY_BACKUP = 'gvBackup_gemini-folders_primary';

/** The fixture's outputs with each `"$stored"` replaced by the stored folders. */
function expand(value: unknown): unknown {
  if (value === '$stored') return STORED;
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
}

const local: Record<string, unknown> = {};
const sync: Record<string, unknown> = {};
const localWrites: Record<string, unknown>[] = [];
const managers: FolderManager[] = [];

function pick(values: Record<string, unknown>, keys: unknown): Record<string, unknown> {
  if (typeof keys === 'string') return structuredClone({ [keys]: values[keys] });
  if (Array.isArray(keys)) {
    return structuredClone(Object.fromEntries(keys.map((key) => [key, values[key]])));
  }
  if (keys && typeof keys === 'object') {
    return structuredClone(
      Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [key, values[key] ?? fallback]),
      ),
    );
  }
  return structuredClone(values);
}

function serve(values: Record<string, unknown>) {
  return (keys: unknown, callback?: (items: Record<string, unknown>) => void) => {
    const items = pick(values, keys);
    callback?.(items);
    return Promise.resolve(items);
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

type GeminiPage = {
  upload(): Promise<void>;
  /** The file the export downloads, parsed. */
  exportFile(): Promise<unknown>;
  importText(text: string): Promise<boolean>;
};

/** Opens Gemini's folders on whatever `local` holds, as the page does. */
async function openGemini(): Promise<GeminiPage> {
  mountSidebar();
  const manager = new FolderManager();
  managers.push(manager);
  await manager.init();
  await flush();
  const { transfer } = manager as unknown as {
    transfer: {
      upload(): Promise<void>;
      exportFolders(): void;
      import(source: { text: string }, strategy: 'merge', anchor: HTMLElement): Promise<boolean>;
    };
  };
  return {
    upload: () => transfer.upload(),
    exportFile: async () => {
      let file: Blob | null = null;
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        file = blob as Blob;
        return 'blob:gemini-folders';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      // jsdom cannot follow the download link; the file is read from the blob instead.
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      transfer.exportFolders();
      if (!file) throw new Error('nothing was downloaded');
      return JSON.parse(await readBlob(file));
    },
    importText: async (text) => {
      const imported = await transfer.import({ text }, 'merge', document.body);
      await flush();
      return imported;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(sync)) delete sync[key];
  Object.assign(sync, {
    [StorageKeys.LANGUAGE]: 'en',
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
    geminiFolderEnabled: true,
  });
  localWrites.length = 0;
  vi.mocked(chrome.storage.local.get).mockImplementation(serve(local) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation((async (
    values: Record<string, unknown>,
  ) => {
    localWrites.push(structuredClone(values));
    Object.assign(local, structuredClone(values));
  }) as never);
  vi.mocked(chrome.storage.sync.get).mockImplementation(serve(sync) as never);
  vi.mocked(chrome.storage.sync.set).mockImplementation((async (
    values: Record<string, unknown>,
  ) => {
    Object.assign(sync, structuredClone(values));
  }) as never);
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true } as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  historyTimestampStore.stop();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("a Gemini user's folders from the folder manager", () => {
  it('open as they were, nested, gem and legacy ids kept, and are never rewritten', async () => {
    local[KEY] = structuredClone(STORED);
    await openGemini();

    // Root conversations first, then folders; collapsed folders hide their chats.
    expect(sidebarTree(document).outline()).toEqual([
      '· 会话 2',
      '· 会话 4',
      '· 会话 1',
      '· 会话 5',
      '· 会话 3',
      'Voyager 测试 1',
      'Voyager 测试 2',
      'Voyager 测试 3',
      '  · 会话 16',
      '  · 会话 17',
      '  · 会话 15',
      '  Voyager 测试 4',
      '  Voyager 测试 5',
      '    · 会话 23',
      '    · 会话 25',
      '    · 会话 24',
      '    · 会话 26',
    ]);
    // A gem chat keeps its gem path, a legacy bare id its /app/ link.
    const links = [
      ...sidebarTreeRoot(document).querySelectorAll('[data-conversation-id] a[dir="auto"]'),
    ].map((link) => link.getAttribute('href'));
    const urls = new Map(
      Object.values(STORED.folderContents)
        .flat()
        .map((conversation) => [conversation.title, conversation.url]),
    );
    expect(links).toEqual(
      ['2', '4', '1', '5', '3', '16', '17', '15', '23', '25', '24', '26'].map((n) =>
        urls.get(`会话 ${n}`),
      ),
    );
    expect(links[5]).toMatch(/^https:\/\/gemini\.google\.com\/gem\/learning-coach\/[0-9a-f]{16}$/);

    const opened = expand(fixture.opened) as Record<string, unknown>;
    expect(local[KEY]).toEqual(opened.gvFolderData);
    expect(localWrites.filter((values) => KEY in values)).toEqual([]);
    // The page's localStorage copy is written on open, byte for byte what storage holds.
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(opened.localStorageMirror));
    expect(JSON.parse(localStorage.getItem(PRIMARY_BACKUP) ?? 'null')).toMatchObject({
      data: opened.primaryBackup,
    });
  });

  it('requests only this site and keeps stored folders intact', async () => {
    local[KEY] = structuredClone(STORED);
    const page = await openGemini();
    vi.mocked(chrome.runtime.sendMessage).mockClear();

    await page.upload();

    const upload = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.map(([message]: unknown[]) => message as { type: string; payload?: unknown })
      .find((message) => message.type === 'gv.sync.upload');
    expect(upload?.payload).toMatchObject({
      platform: 'gemini',
      selection: 'site',
    });
    expect(upload?.payload).not.toHaveProperty('prompts');
    expect(local[KEY]).toEqual(STORED);
  });

  it('export as the same file', async () => {
    local[KEY] = structuredClone(STORED);
    const page = await openGemini();

    const {
      exportedAt: _exportedAt,
      version: _version,
      ...file
    } = expand(fixture.exported) as Record<string, unknown>;
    expect(await page.exportFile()).toEqual({
      ...file,
      exportedAt: expect.any(String),
      version: expect.any(String),
    });
  });

  it('import from its file into an empty store as the same folders', async () => {
    const page = await openGemini();

    await expect(page.importText(JSON.stringify(expand(fixture.exported)))).resolves.toBe(true);

    expect(local[KEY]).toEqual(expand(fixture.imported));
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(expand(fixture.imported));
  });
});
