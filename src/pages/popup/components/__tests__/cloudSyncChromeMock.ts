import { act } from 'react';

import { vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { DEFAULT_SYNC_STATE, type SyncState } from '@/core/types/sync';
import {
  handlePromptLibraryApplyMessage,
  isPromptLibraryApplyMessage,
} from '@/features/prompt/library/promptLibraryMessages';
import { createPromptLibraryOwner } from '@/features/prompt/library/promptLibraryOwner';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { createForkMessagesOwner } from '@/pages/background/forkMessages';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

type RuntimeRequest = { type?: string; payload?: unknown };

/** The sync state the popup starts from in these tests: manual mode, not signed in to Drive. */
export const baseState: SyncState = {
  ...DEFAULT_SYNC_STATE,
  mode: 'manual',
  isAuthenticated: false,
};

/** Lets the promises the popup started on mount or on a click settle. */
export async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function createCloudSyncChromeMock(
  sendSyncMessage: (message: RuntimeRequest) => unknown,
  initial: { local?: Record<string, unknown>; sync?: Record<string, unknown> } = {},
): typeof chrome {
  const stored: Record<string, unknown> = {
    [StorageKeys.FOLDER_DATA]: { folders: [], folderContents: {} },
    [StorageKeys.PROMPT_ITEMS]: [],
    [StorageKeys.TIMELINE_STARRED_MESSAGES]: { messages: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    ...structuredClone(initial.local ?? {}),
  };
  const area = (values: Record<string, unknown>) => ({
    get: vi.fn(async (keys: unknown) => {
      const names =
        keys === null || keys === undefined
          ? Object.keys(values)
          : typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : Object.keys(keys);
      const defaults =
        keys && typeof keys === 'object' && !Array.isArray(keys)
          ? (keys as Record<string, unknown>)
          : {};
      return Object.fromEntries(
        names.flatMap((name) =>
          Object.prototype.hasOwnProperty.call(values, name)
            ? [[name, structuredClone(values[name])]]
            : Object.prototype.hasOwnProperty.call(defaults, name)
              ? [[name, structuredClone(defaults[name])]]
              : [],
        ),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(values)) delete values[key];
    }),
  });
  const local = area(stored);
  const sync = area(structuredClone(initial.sync ?? {}));
  const owner = createStarStore({
    get: (keys) => local.get(keys),
    set: (items) => local.set(items),
  });
  const starHandler = createStarredMessagesHandler(owner);
  const prompts = createPromptLibraryOwner({
    area: { get: (key) => local.get(key), set: (items) => local.set(items) },
  });
  const forkOwner = createForkMessagesOwner(local);
  return {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      lastError: null,
      sendMessage: vi.fn((message: RuntimeRequest, reply?: (response: unknown) => void) => {
        if (message.type?.startsWith('gv.starred.') && reply) {
          const result = starHandler(message, {
            id: 'test-extension-id',
            url: 'chrome-extension://test-extension-id/popup.html',
          });
          if (result)
            void result.then(reply, (error: Error) => reply({ ok: false, error: error.message }));
          return;
        }
        if (isPromptLibraryApplyMessage(message)) {
          return handlePromptLibraryApplyMessage(message, prompts);
        }
        const forkResponse = forkOwner.handle(message);
        if (forkResponse && reply) {
          void forkResponse.then(reply, (error: Error) =>
            reply({ ok: false, error: error.message }),
          );
          return;
        }
        return sendSyncMessage(message);
      }),
    },
    tabs: {
      get: vi.fn().mockResolvedValue({ id: 1, url: 'https://gemini.google.com/app' }),
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app' }]),
      sendMessage: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { folders: [], folderContents: {} } }),
    },
    storage: {
      local,
      sync,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  } as unknown as typeof chrome;
}
