import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';
import { mergeAIStudioImport } from '@/features/folder/model/aistudioImport';
import enMessages from '@/locales/en/messages.json';
import { confirmDriver } from '@/tests/confirmDriver';
import { toastDriver } from '@/tests/toastDriver';

import type { TreeActions } from '../floatingTree/shared';
import type { ConversationReference, FolderData } from '../types';
import { AIStudioFolderManager } from './aistudioFolderManager';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      sync: { get: vi.fn(), set: vi.fn() },
      local: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(),
    },
  },
}));

const FOLDER_SOURCES = resolve(__dirname, '..');
// A translation key the translator returned unchanged, or a placeholder left unfilled.
const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b/;
const PLACEHOLDER = /\{\w+\}/;

function expectRendered(message: unknown): void {
  expect(typeof message).toBe('string');
  expect(message).not.toMatch(RAW_KEY);
  expect(message).not.toMatch(PLACEHOLDER);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('folder translation keys', () => {
  it('exist in the English locale for every literal key the folder UI translates', () => {
    const missing = sourceFiles(FOLDER_SOURCES).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)]
        .map((match) => match[1])
        .filter((key) => !Object.hasOwn(enMessages, key))
        .map((key) => `${key} (${path.slice(FOLDER_SOURCES.length + 1)})`),
    );
    expect(missing).toEqual([]);
  });
});

function folder(id: string) {
  return { id, name: `Folder ${id}`, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 };
}

function prompt(id: string): ConversationReference {
  return { conversationId: id, title: `Prompt ${id}`, url: `/prompts/${id}`, addedAt: 10 };
}

describe('mergeAIStudioImport', () => {
  it('counts new folders and every prompt the merge adds', () => {
    const current: FolderData = {
      folders: [folder('a')],
      folderContents: { a: [prompt('p1')], x: [prompt('old')] },
    };
    const before = structuredClone(current);
    const result = mergeAIStudioImport(current, {
      folders: [folder('a'), folder('x'), folder('e')],
      folderContents: {
        a: [prompt('p1'), prompt('p2')],
        x: [prompt('p3'), prompt('p4')],
        [AISTUDIO_ROOT_BUCKET_ID]: [prompt('p5')],
      },
    });

    expect(result.stats.foldersImported).toBe(2);
    expect(result.stats.conversationsImported).toBe(3);
    expect(result.data.folderContents).toEqual({
      a: [prompt('p1'), prompt('p2')],
      x: [prompt('p3'), prompt('p4')],
      e: [],
    });
    expect(current).toEqual(before);
  });
});

type Internals = {
  dataSession: { ready: boolean };
  data: FolderData;
  save: () => Promise<boolean>;
  render: () => void;
  replaceData: (data: FolderData) => Promise<boolean>;
  library: { mountDropZone: () => void };
  transfer: { importFile: () => void };
  treeActions: () => TreeActions;
  destroy: () => void;
};

describe('AI Studio folder messages', () => {
  const managers: Internals[] = [];

  function createManager(initial: FolderData): Internals {
    const internals = new AIStudioFolderManager() as unknown as Internals;
    internals.dataSession.ready = true;
    internals.data = structuredClone(initial);
    internals.save = vi.fn().mockResolvedValue(true);
    internals.render = vi.fn();
    internals.replaceData = vi.fn().mockResolvedValue(true);
    managers.push(internals);
    return internals;
  }

  async function showLibraryZone(manager: Internals): Promise<void> {
    const table = document.createElement('table');
    table.className = 'mat-mdc-table';
    table.innerHTML = '<tr class="mat-mdc-row"><td><a href="/prompts/row">Row</a></td></tr>';
    document.body.appendChild(table);
    manager.library.mountDropZone();
    table.querySelector('tr')!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  }

  async function dropOn(item: Element, conversationId: string): Promise<void> {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    const json = JSON.stringify({ type: 'conversation', conversationId, title: conversationId });
    Object.defineProperty(event, 'dataTransfer', {
      value: { getData: (type: string) => (type === 'application/json' ? json : '') },
    });
    item.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(0);
  }

  /** The latest notice's level and message. */
  function lastNotification(): { level: string; message: string } {
    const toast = toastDriver.all().at(-1);
    return { level: toast?.tone ?? '', message: toast?.message ?? '' };
  }

  async function importText(manager: Internals, text: string): Promise<void> {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const createElement = vi.spyOn(document, 'createElement');
    manager.transfer.importFile();
    const input = createElement.mock.results
      .map((result) => result.value as HTMLElement)
      .find((element): element is HTMLInputElement => element instanceof HTMLInputElement)!;
    createElement.mockRestore();
    Object.defineProperty(input, 'files', { value: [{ text: async () => text }] });
    input.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const internals of managers.splice(0)) {
      try {
        internals.destroy();
      } catch {}
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('confirms library drops in words', async () => {
    const manager = createManager({ folders: [folder('b')], folderContents: { b: [] } });
    await showLibraryZone(manager);

    await dropOn(document.querySelector('.gv-library-folder-item[data-folder-id="b"]')!, 'p1');
    const added = lastNotification();
    expect(added).toEqual({ level: 'info', message: 'Added to "Folder b"' });

    await dropOn(document.querySelector('.gv-library-root-item')!, 'p1');
    const saved = lastNotification();
    expect(saved).toEqual({ level: 'info', message: 'Saved to Uncategorized' });

    // `$` sequences in a folder name are not replacement patterns.
    manager.data.folders[0].name = "Cost $& Benefit $'";
    await showLibraryZone(manager);
    await dropOn(document.querySelector('.gv-library-folder-item[data-folder-id="b"]')!, 'p2');
    expect(lastNotification()).toEqual({
      level: 'info',
      message: 'Added to "Cost $& Benefit $\'"',
    });

    for (const { message } of [added, saved]) expectRendered(message);
  });

  it('quotes a conversation title verbatim when confirming its removal', () => {
    const manager = createManager({
      folders: [folder('a')],
      folderContents: { a: [prompt('p1')] },
    });
    manager.treeActions().confirmConversationRemoval!("Cost $& Benefit $'", document.body, vi.fn());
    const message = confirmDriver.message() ?? '';
    expect(message).toContain("Cost $& Benefit $'");
    expectRendered(message);
  });

  it('shows library drop targets with folder names as text, not markup', async () => {
    const name = '<img src=x onerror="alert(1)">';
    const manager = createManager({
      folders: [{ ...folder('b'), name }],
      folderContents: { b: [] },
    });
    await showLibraryZone(manager);
    const item = document.querySelector('.gv-library-folder-item[data-folder-id="b"]')!;
    expect(item.textContent).toContain(name);
    expect(item.querySelector('img')).toBeNull();
  });

  it('names the folder it creates for an empty library', async () => {
    const manager = createManager({ folders: [], folderContents: {} });
    await showLibraryZone(manager);
    expect(manager.data.folders.map((f) => f.name)).toEqual(['My Folder']);
  });

  it('reports import results and failures with their values filled in', async () => {
    const manager = createManager({
      folders: [folder('a')],
      folderContents: { a: [prompt('p1')] },
    });
    await importText(
      manager,
      JSON.stringify({
        folders: [folder('a'), folder('n')],
        folderContents: { a: [prompt('p1'), prompt('p2')], n: [prompt('p3')] },
      }),
    );
    expect(lastNotification()).toEqual({
      level: 'success',
      message: 'Imported 1 folders, 2 conversations',
    });

    await importText(manager, 'not json');
    const failure = lastNotification();
    expect(failure.level).toBe('error');
    expect(failure.message).toMatch(/^Import failed: SyntaxError/);
    for (const message of toastDriver.messages()) expectRendered(message);

    // The parser quotes the bad input; `$&` in it is not a replacement pattern.
    await importText(manager, '$& oops');
    expect(lastNotification().message).toContain('$& oops');
  });
});
