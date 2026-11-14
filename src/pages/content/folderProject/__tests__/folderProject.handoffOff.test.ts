/**
 * "New chat in this folder" with Folder-as-Project switched off: the handoff
 * alone runs the picker and the filing for that one chat.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

vi.mock('../../utils/inputHelper', () => ({
  setInputText: (input: HTMLElement, text: string) => {
    input.textContent = text;
  },
}));

vi.mock('../../chatInput/index', () => ({
  findChatInput: () => document.querySelector<HTMLElement>('#test-chat-input'),
}));

const chip = () => document.querySelector<HTMLButtonElement>('.gv-fp-chip');

function mountComposer(): HTMLElement {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div id="test-chat-input" contenteditable="true" role="textbox"></div>' +
      '<div class="model-picker-container"><button></button></div>',
  );
  const anchor = document.querySelector<HTMLElement>('.model-picker-container')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect);
  return document.getElementById('test-chat-input')!;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/app');
  (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_defaults: Record<string, unknown>, callback: (result: Record<string, unknown>) => void) => {
      callback({ [StorageKeys.FOLDER_PROJECT_ENABLED]: false });
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

it('files the handed-off chat without its instructions, then stops watching', async () => {
  const { handOffNewChatFolder, clearNewChatFolder } = await import('../pendingFolder');
  const { startFolderProject } = await import('../index');
  const addConversationToFolderFromNative = vi.fn();
  const folders = {
    getFolders: () => [{ id: 'f1', name: 'Thesis', parentId: null, instructions: 'Be terse.' }],
    ensureDataLoaded: vi.fn().mockResolvedValue(undefined),
    addConversationToFolderFromNative,
  };
  try {
    const input = mountComposer();
    startFolderProject(folders as unknown as Parameters<typeof startFolderProject>[0]);
    await vi.advanceTimersByTimeAsync(50);
    // Switched off, a new chat gets no picker of its own.
    expect(chip()).toBeNull();

    handOffNewChatFolder('f1');
    await vi.advanceTimersByTimeAsync(50);
    expect(chip()?.dataset.selected).toBe('f1');

    input.textContent = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Instructions belong to Folder-as-Project; the send goes out as typed.
    expect(input.textContent).toBe('hello');
    window.history.pushState({}, '', '/app/abc123');
    await vi.advanceTimersByTimeAsync(800);

    expect(addConversationToFolderFromNative).toHaveBeenCalledOnce();
    expect(addConversationToFolderFromNative.mock.calls[0].slice(0, 2)).toEqual(['f1', 'abc123']);
    expect(chip()).toBeNull();

    // The watch ended with the handoff: the next new chat is plain again.
    window.history.pushState({}, '', '/app');
    await vi.advanceTimersByTimeAsync(800);
    expect(chip()).toBeNull();
  } finally {
    clearNewChatFolder();
  }
});
