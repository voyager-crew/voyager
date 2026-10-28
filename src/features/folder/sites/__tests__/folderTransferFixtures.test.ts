/**
 * The folder files each site writes and reads, pinned. Exports are compared
 * with committed files made at a fixed time, and each committed file is read
 * back by its own site and refused by the others, so moving a reader or the
 * folder table can never change what users' saved files mean.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXTENSION_VERSION } from '@/core/utils/version';
import { readAIStudioImportFile } from '@/features/folder/model/aistudioImport';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import type { FolderData } from '@/pages/content/folder/types';

import { exportChatGptFolders } from '../chatgptTransfer';
import { CLAUDE_TRANSFER } from '../claudeIdentity';
import { DEEPSEEK_TRANSFER } from '../deepseekIdentity';
import files from './fixtures/folderTransferFiles.json';

type Site = keyof typeof files;
const SITES = Object.keys(files) as Site[];
const EXPORTED_AT = new Date('2026-01-02T03:04:05.000Z');
const VERSION = '<extension version>';

/** One folder holding one conversation as the site stores it. */
function folders(conversationId: string, url: string): FolderData {
  return {
    folders: [
      {
        id: 'folder_1',
        name: 'Research',
        parentId: null,
        isExpanded: true,
        sortIndex: 0,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    ],
    folderContents: {
      folder_1: [{ conversationId, title: 'Notes', url, addedAt: 1_700_000_000_000, sortIndex: 0 }],
    },
  };
}

const DATA: Record<Site, FolderData> = {
  gemini: folders('c_abc123', 'https://gemini.google.com/app/abc123'),
  aistudio: folders('abc123', 'https://aistudio.google.com/prompts/abc123'),
  chatgpt: folders('chatgpt:conv:abc123', 'https://chatgpt.com/c/abc123'),
  claude: folders('claude:conv:abc123', 'https://claude.ai/chat/abc123'),
  deepseek: folders('deepseek:conv:abc123', 'https://chat.deepseek.com/a/chat/s/abc123'),
};

/** Each site's file export; AI Studio offers none. */
const EXPORT: Partial<Record<Site, (data: FolderData) => unknown>> = {
  gemini: (data) => FolderImportExportService.exportToPayload(data),
  chatgpt: exportChatGptFolders,
  claude: CLAUDE_TRANSFER.export,
  deepseek: DEEPSEEK_TRANSFER.export,
};

/** Whether `site`'s import accepts `file`, and the folders it reads. */
function read(site: Site, file: unknown): FolderData | null {
  if (site === 'aistudio') {
    const result = readAIStudioImportFile(file);
    return result.ok ? result.data : null;
  }
  if (site === 'gemini') {
    if (FolderImportExportService.exportedPlatform(file) !== null) return null;
    const result = FolderImportExportService.validatePayload(file);
    return result.success ? result.data.data : null;
  }
  const result = FOLDER_PLATFORMS[site].folderExport.read(file);
  return result.ok ? result.payload.data : null;
}

const withVersion = (file: unknown) => ({ ...(file as object), version: EXTENSION_VERSION });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EXPORTED_AT);
});
afterEach(() => vi.useRealTimers());

describe('five-site folder files', () => {
  it.each(SITES.filter((site) => EXPORT[site]))('%s exports the pinned file', (site) => {
    const exported = EXPORT[site]?.(DATA[site]) as { version: string };
    expect(exported.version).toBe(EXTENSION_VERSION);
    expect({ ...exported, version: VERSION }).toEqual(files[site]);
  });

  it.each(SITES)('%s reads its pinned file back to the same folders', (site) => {
    expect(read(site, withVersion(files[site]))).toEqual(DATA[site]);
  });

  it.each(SITES)('a pinned %s file is refused by every site that cannot open it', (site) => {
    const file = withVersion(files[site]);
    const readers = SITES.filter((other) => other !== site && read(other, file) !== null);
    // Gemini and AI Studio files carry no site tag, so each still reads the other's.
    const untagged: Partial<Record<Site, Site[]>> = { gemini: ['aistudio'], aistudio: ['gemini'] };
    expect(readers).toEqual(untagged[site] ?? []);
  });
});
