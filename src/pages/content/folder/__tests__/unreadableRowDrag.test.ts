import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FolderManager } from './geminiFolderManager';
import { mountSidebar } from './sidebarRuntimeHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
  initI18n: () => Promise.resolve(),
}));

let manager: FolderManager | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  // Storage is empty; callers use both the callback and the promise form.
  const empty = (_keys: unknown, callback?: (items: object) => void) => {
    callback?.({});
    return Promise.resolve({});
  };
  vi.mocked(chrome.storage.sync.get).mockImplementation(empty as never);
  vi.mocked(chrome.storage.local.get).mockImplementation(empty as never);
});

afterEach(() => {
  manager?.destroy();
  manager = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function dragStart(row: HTMLElement): { event: DragEvent; setData: ReturnType<typeof vi.fn> } {
  const setData = vi.fn();
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { setData, setDragImage: vi.fn(), effectAllowed: 'all' },
  });
  row.dispatchEvent(event);
  return { event, setData };
}

it('starts no folder drag from a sidebar row whose conversation id cannot be read', async () => {
  const { recentsSection } = mountSidebar();
  const unreadable = document.createElement('div');
  unreadable.setAttribute('data-test-id', 'conversation');
  unreadable.innerHTML = '<span class="conversation-title">Still loading</span>';
  const readable = document.createElement('div');
  readable.setAttribute('data-test-id', 'conversation');
  readable.setAttribute('jslog', '["c_abcdef0123456789"]');
  readable.innerHTML = '<a href="/app/abcdef0123456789">Readable</a>';
  recentsSection.append(unreadable, readable);
  manager = new FolderManager();
  await manager.init();
  await vi.waitFor(() => expect(readable.draggable).toBe(true));

  // Older builds filed such rows under a random id that named nothing and changed each read.
  const refused = dragStart(unreadable);
  expect(refused.event.defaultPrevented).toBe(true);
  expect(refused.setData).not.toHaveBeenCalled();

  const started = dragStart(readable);
  expect(started.event.defaultPrevented).toBe(false);
  expect(JSON.parse(started.setData.mock.calls[0][1])).toMatchObject({
    conversationId: 'c_abcdef0123456789',
  });
});
