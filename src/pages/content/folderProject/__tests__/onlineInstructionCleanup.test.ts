// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));
vi.mock('../../folder/folderColors', () => ({
  getFolderColor: () => '#4285f4',
  isDarkMode: () => false,
}));
vi.mock('../../utils/inputHelper', () => ({
  setInputText: (input: HTMLElement, text: string) => {
    input.textContent = text;
  },
}));
const listeners = new Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>();
let retire = () => {};
const settle = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
function disable(): void {
  for (const listener of listeners)
    listener({ [StorageKeys.FOLDER_PROJECT_ENABLED]: { oldValue: true, newValue: false } }, 'sync');
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  listeners.clear();
  document.body.innerHTML =
    '<div class="text-input-field"><section class="remote-input" id="original" contenteditable="true">original draft</section><button type="button" id="send" aria-label="Send"></button></div><div class="model-picker-container"><button type="button"></button></div>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 30,
    width: 300,
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
  const values = {
    [StorageKeys.FOLDER_PROJECT_ENABLED]: true,
    [StorageKeys.CTRL_ENTER_SEND]: false,
  };
  vi.mocked(chrome.storage.sync.get).mockImplementation(((
    keys: unknown,
    callback?: (value: Record<string, unknown>) => void,
  ) => {
    callback?.(values);
    return Promise.resolve(values);
  }) as typeof chrome.storage.sync.get);
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
    listeners.delete(listener);
  });
});
afterEach(async () => {
  disable();
  retire();
  await settle();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

it.each([false, true])(
  'cleanup removes carried instructions after a composer remount (detached=%s)',
  async (detached) => {
    const { startFolderProject } = await import('../index');
    const { installGeminiSelectorPatch } =
      await import('../../__tests__/geminiOnlineSelectorFixture');
    const { buildInstructionBlock } = await import('../instructionBlock');
    startFolderProject({
      ensureDataLoaded: async () => {},
      getFolders: () => [
        {
          id: 'work',
          name: 'Work',
          instructions: 'private instructions',
          parentId: null,
          isExpanded: false,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      addConversationToFolderFromNative: vi.fn(),
    });
    await settle();
    document.querySelector<HTMLButtonElement>('.gv-fp-chip')!.click();
    await settle();
    document.querySelector<HTMLButtonElement>('[data-folder-id="work"]')!.click();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['.remote-input'] });
    document.getElementById('send')!.click();
    const original = document.getElementById('original')!;
    expect(original.textContent).toContain('private instructions');
    const prepared = original.textContent;
    original.classList.remove('remote-input');
    if (detached) original.remove();
    const replacement = document.createElement('div');
    replacement.contentEditable = 'true';
    replacement.setAttribute('contenteditable', 'true');
    replacement.setAttribute('role', 'textbox');
    replacement.className = 'remote-input';
    const replacementText = `${buildInstructionBlock('Work', 'private instructions')}replacement draft`;
    replacement.textContent = replacementText;
    document.querySelector('.text-input-field')!.prepend(replacement);
    disable();
    expect(replacement.textContent).toBe(detached ? 'replacement draft' : replacementText);
    expect(original.textContent).toBe(detached ? prepared : 'original draft');
  },
);

async function selectProject(account: () => string | null = () => 'a'): Promise<void> {
  const { startFolderProject } = await import('../index');
  const { installGeminiSelectorPatch } =
    await import('../../__tests__/geminiOnlineSelectorFixture');
  const folders = [
    {
      id: 'work',
      name: 'Work',
      instructions: 'private instructions',
      parentId: null,
      isExpanded: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  startFolderProject({
    ensureDataLoaded: async () => {},
    getFolders: () => folders,
    folderAccount: account,
    folderSnapshot: () => ({ account: account(), folders }),
    addConversationToFolderFromNative: vi.fn(),
  });
  await settle();
  document.querySelector<HTMLButtonElement>('.gv-fp-chip')!.click();
  await settle();
  document.querySelector<HTMLButtonElement>('[data-folder-id="work"]')!.click();
  retire = await installGeminiSelectorPatch({ 'project.inputs': ['.remote-input'] });
  document.getElementById('send')!.click();
}

it('cleanup follows a later bundled send instead of a previously prepared remote editor', async () => {
  await selectProject();
  const original = document.getElementById('original')!;
  expect(original.textContent).toContain('private instructions');
  const current = document.createElement('div');
  current.setAttribute('contenteditable', 'true');
  current.setAttribute('role', 'textbox');
  current.textContent = 'current draft';
  document.querySelector('.text-input-field')!.prepend(current);
  current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(current.textContent).toContain('private instructions');
  disable();
  expect(current.textContent).toBe('current draft');
  expect(original.textContent).toContain('private instructions');
});

it('a send with an unreadable account cleans its explicit editor instead of an earlier remote editor', async () => {
  let account: string | null = 'a';
  await selectProject(() => account);
  const original = document.getElementById('original')!;
  const current = document.createElement('div');
  current.setAttribute('contenteditable', 'true');
  current.setAttribute('role', 'textbox');
  const { buildInstructionBlock } = await import('../instructionBlock');
  current.textContent = buildInstructionBlock('Work', 'private instructions') + 'current draft';
  document.querySelector('.text-input-field')!.prepend(current);
  account = null;
  current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(current.textContent).toBe('current draft');
  expect(original.textContent).toContain('private instructions');
});
