import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  type PromptLibraryOp,
  createPromptLibraryOwner,
} from '@/features/prompt/library/promptLibraryOwner';
import { confirmDriver } from '@/tests/confirmDriver';
import { toastDriver } from '@/tests/toastDriver';

import { startPromptManager } from '../index';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./ballClicks'));

const prompts = [
  { id: 'a', name: 'Alpha', text: 'Alpha body', tags: [], createdAt: 2 },
  { id: 'b', name: 'Beta', text: 'Beta body', tags: [], createdAt: 1 },
];

let manager: Awaited<ReturnType<typeof startPromptManager>> | undefined;

function storageGet(values: Record<string, unknown>): typeof chrome.storage.sync.get {
  const get = (
    keys: string | string[] | Record<string, unknown> | null = null,
    callback?: (items: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const names =
      keys === null
        ? Object.keys(values)
        : typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
    const result = Object.fromEntries(
      names
        .filter((key) => values[key] !== undefined)
        .map((key) => [key, structuredClone(values[key])]),
    );
    callback?.(result);
    return Promise.resolve(result);
  };
  return get as typeof chrome.storage.sync.get;
}

/** Tells every `storage.onChanged` listener Prompt Manager registered about a library value. */
function emitLibrary(value: unknown): void {
  for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
    (listener as (changes: object, area: string) => void)(
      { [StorageKeys.PROMPT_ITEMS]: { newValue: structuredClone(value) } },
      'local',
    );
  }
}

/**
 * Backs the library with storage and a real owner: each write reaches the page
 * as a change before the owner replies. `beforeApply` runs as an op arrives;
 * `reply` stands between the write and its reply.
 */
function useLibrary(
  options: {
    beforeApply?: (op: PromptLibraryOp) => void;
    reply?: () => Promise<void>;
  } = {},
) {
  const disk: Record<string, unknown> = { [StorageKeys.PROMPT_ITEMS]: prompts };
  vi.mocked(chrome.storage.local.get).mockImplementation(storageGet(disk));
  const owner = createPromptLibraryOwner({
    area: {
      get: async () => ({ [StorageKeys.PROMPT_ITEMS]: structuredClone(disk.gvPromptItems) }),
      set: async (items) => {
        disk.gvPromptItems = structuredClone(items[StorageKeys.PROMPT_ITEMS]);
        emitLibrary(disk.gvPromptItems);
      },
    },
  });
  const ops: PromptLibraryOp[] = [];
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (message: {
    type?: string;
    op?: PromptLibraryOp;
  }) => {
    if (message.type !== 'gv.promptLibrary.apply' || !message.op) return undefined;
    ops.push(message.op);
    options.beforeApply?.(message.op);
    const result = await owner.apply(message.op);
    await options.reply?.();
    return { ok: true, result };
  }) as never);
  return {
    ops,
    /** Another tab writes the library. */
    write: (value: unknown) => {
      disk.gvPromptItems = structuredClone(value);
      emitLibrary(value);
    },
  };
}

async function openPanel(): Promise<void> {
  manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
  document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();
}

/** The prompts listed, by name. */
const rowIds = () =>
  [...document.querySelectorAll<HTMLElement>('.gv-pm-item')].map(
    (row) => ['Alpha', 'Beta', 'Gamma'].find((name) => row.textContent?.includes(name)) ?? '?',
  );

async function deleteFirstPrompt(): Promise<void> {
  document.querySelector<HTMLButtonElement>('.gv-pm-item .gv-pm-del')!.click();
  confirmDriver.answer('Delete');
  await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.mocked(chrome.storage.sync.get).mockImplementation(
    storageGet({ [StorageKeys.LANGUAGE]: 'en' }),
  );
  vi.mocked(chrome.storage.local.get).mockImplementation(
    storageGet({ [StorageKeys.PROMPT_ITEMS]: prompts }),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn');
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Prompt Manager write notices', () => {
  it('says "Deleted" only once the owner has removed the prompt', async () => {
    let reply!: () => void;
    useLibrary({ reply: () => new Promise((resolve) => (reply = resolve)) });
    await openPanel();
    expect(rowIds()).toEqual(['Alpha', 'Beta']);

    await deleteFirstPrompt();
    expect(rowIds()).toEqual(['Beta']);
    expect(toastDriver.messages()).toEqual([]);

    reply();
    await vi.advanceTimersByTimeAsync(1);
    expect(toastDriver.messages()).toEqual(['Deleted']);
    expect(rowIds()).toEqual(['Beta']);
  });

  it('puts the prompt back and says the change was undone when the delete fails', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    await openPanel();

    await deleteFirstPrompt();

    expect(rowIds()).toEqual(['Alpha', 'Beta']);
    expect(toastDriver.messages()).toEqual(["Couldn't save your change. It was undone."]);
  });

  it('keeps the form open with what was typed when an add fails', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false, error: 'quota' } as never);
    await openPanel();

    document.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    const form = document.querySelector<HTMLFormElement>('.gv-pm-add-form')!;
    form.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Gamma';
    form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value = 'Gamma body';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);

    expect(rowIds()).toEqual(['Alpha', 'Beta']);
    expect(toastDriver.messages()).toEqual(["Couldn't save your change. It was undone."]);
    expect(form.classList.contains('gv-hidden')).toBe(false);
    expect(form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value).toBe('Gamma body');
  });

  it('keeps an edit whose prompt another tab deleted, and saves it as a new prompt', async () => {
    const library = useLibrary({
      // Another tab deleted Alpha just before this edit arrived.
      beforeApply: (op) => op.kind === 'update' && library.write([prompts[1]]),
    });
    const { ops } = library;
    await openPanel();

    document.querySelector<HTMLButtonElement>('.gv-pm-item .gv-pm-edit')!.click();
    const form = document.querySelector<HTMLFormElement>('.gv-pm-add-form')!;
    const text = form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!;
    text.value = 'Alpha body, edited';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);

    expect(ops.map((op) => op.kind)).toEqual(['update']);
    expect(form.classList.contains('gv-hidden')).toBe(false);
    expect(text.value).toBe('Alpha body, edited');
    expect(form.querySelector('.gv-pm-inline-hint')!.textContent).toBe(
      'This prompt was deleted elsewhere. Save again to keep it as a new prompt.',
    );
    expect(rowIds()).toEqual(['Beta']);

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);

    expect(ops.map((op) => op.kind)).toEqual(['update', 'add']);
    expect(ops[1]).toMatchObject({
      items: [expect.objectContaining({ name: 'Alpha', text: 'Alpha body, edited' })],
    });
    expect(form.classList.contains('gv-hidden')).toBe(true);
    expect(rowIds()).toEqual(['Alpha', 'Beta']);
  });

  it("shows another tab's change that lands while a delete awaits its reply", async () => {
    let reply!: () => void;
    const gamma = { id: 'g', name: 'Gamma', text: 'Gamma body', tags: [], createdAt: 3 };
    const { write } = useLibrary({ reply: () => new Promise((resolve) => (reply = resolve)) });
    await openPanel();

    await deleteFirstPrompt();
    write([gamma, prompts[1]]);
    expect(rowIds()).toEqual(['Gamma', 'Beta']);
    expect(toastDriver.messages()).toEqual(['Synced successfully']);
    // Nothing is read back: a read failing now cannot blank the list.
    vi.mocked(chrome.storage.local.get).mockRejectedValue(
      new Error('Extension context invalidated.'),
    );
    reply();
    await vi.advanceTimersByTimeAsync(1);

    expect(rowIds()).toEqual(['Gamma', 'Beta']);
    expect(toastDriver.messages()).toEqual(['Deleted']);
  });

  it('keeps a change another tab made while the library was first being read', async () => {
    let finishRead!: () => void;
    const read = storageGet({ [StorageKeys.PROMPT_ITEMS]: prompts });
    vi.mocked(chrome.storage.local.get).mockImplementation(((
      keys: string | string[] | Record<string, unknown> | null,
      callback?: (items: Record<string, unknown>) => void,
    ) => {
      const value = (read as (k: typeof keys, cb?: typeof callback) => Promise<unknown>)(
        keys,
        callback,
      );
      if (keys !== StorageKeys.PROMPT_ITEMS) return value;
      // The read has its value; another tab's change lands before it returns.
      emitLibrary([prompts[1]]);
      return new Promise((resolve) => (finishRead = () => resolve(value)));
    }) as never);

    const starting = startPromptManager(resolvePromptSiteAdapter(location.href));
    await vi.advanceTimersByTimeAsync(1);
    finishRead();
    manager = await starting;
    document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();

    expect(rowIds()).toEqual(['Beta']);
  });

  it('says the library is not responding and refuses edits while a reply is overdue', async () => {
    const { ops } = useLibrary({ reply: () => new Promise(() => {}) });
    await openPanel();

    await deleteFirstPrompt();
    await vi.advanceTimersByTimeAsync(15_000);
    const unavailable =
      'Prompts are not responding. Your last change is still being saved; try again shortly.';
    expect(toastDriver.messages()).toEqual([unavailable]);

    await deleteFirstPrompt();
    expect(rowIds()).toEqual(['Beta']);
    expect(ops.map((op) => op.kind)).toEqual(['delete']);
    expect(toastDriver.messages()).toEqual([unavailable]);

    document.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    const form = document.querySelector<HTMLFormElement>('.gv-pm-add-form')!;
    form.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Gamma';
    form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value = 'Gamma body';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);

    expect(ops.map((op) => op.kind)).toEqual(['delete']);
    expect(form.classList.contains('gv-hidden')).toBe(false);
    expect(form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value).toBe('Gamma body');
  });

  it('refuses edits until the library loads, and shows it once it can be read', async () => {
    const { ops } = useLibrary();
    const read = vi.mocked(chrome.storage.local.get).getMockImplementation()!;
    let readFails = true;
    vi.mocked(chrome.storage.local.get).mockImplementation(((keys: unknown, callback?: never) =>
      readFails && keys === StorageKeys.PROMPT_ITEMS
        ? Promise.reject(new Error('Extension context invalidated.'))
        : (read as (k: unknown, cb?: never) => Promise<unknown>)(keys, callback)) as never);
    await openPanel();
    expect(rowIds()).toEqual([]);

    document.querySelector<HTMLButtonElement>('.gv-pm-add')!.click();
    const form = document.querySelector<HTMLFormElement>('.gv-pm-add-form')!;
    form.querySelector<HTMLInputElement>('.gv-pm-input-name')!.value = 'Alpha';
    form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value = 'Alpha body';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(ops).toEqual([]);
    expect(toastDriver.messages()).toEqual([
      "Couldn't load your prompts. Trying again; retry in a moment.",
    ]);
    expect(form.querySelector<HTMLTextAreaElement>('.gv-pm-input-text')!.value).toBe('Alpha body');

    // Opening the panel again reads it again.
    readFails = false;
    const trigger = document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!;
    trigger.click();
    trigger.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(rowIds()).toEqual(['Alpha', 'Beta']);
  });

  it('shows and says nothing after teardown, though a reply and the watchdog come later', async () => {
    let reply!: () => void;
    useLibrary({ reply: () => new Promise((resolve) => (reply = resolve)) });
    await openPanel();
    await deleteFirstPrompt();
    const list = document.querySelector('.gv-pm-list')!;
    const rendered = vi.fn();
    new MutationObserver(rendered).observe(list, { childList: true, subtree: true });

    manager!.destroy();
    manager = undefined;
    await vi.advanceTimersByTimeAsync(15_000);
    reply();
    await vi.advanceTimersByTimeAsync(1);

    expect(toastDriver.messages()).toEqual([]);
    expect(rendered).not.toHaveBeenCalled();
  });
});
