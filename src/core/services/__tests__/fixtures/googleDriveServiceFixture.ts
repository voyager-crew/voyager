import { vi } from 'vitest';

import type { HighlightExportPayload, SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

export type MockedChrome = typeof chrome;

export function createChromeMock(): MockedChrome {
  const localStorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const syncStorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };

  const runtime = {
    lastError: null as chrome.runtime.LastError | null,
    id: 'test-extension-id',
    getManifest: vi.fn(() => ({
      oauth2: {
        client_id: 'test-client-id',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    })),
  };

  const identity = {
    getAuthToken: vi.fn(),
    removeCachedAuthToken: vi.fn((_details: { token: string }, callback?: () => void) => {
      callback?.();
    }),
    launchWebAuthFlow: vi.fn(),
    getRedirectURL: vi.fn(() => 'https://test-extension.chromiumapp.org/'),
  };

  return {
    storage: {
      local: localStorageArea,
      sync: syncStorageArea,
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime,
    identity,
  } as unknown as MockedChrome;
}

export async function loadServiceClass() {
  vi.resetModules();
  const mod = await import('../../GoogleDriveSyncService');
  return mod.GoogleDriveSyncService;
}

export function createHighlightPayload(
  accountScope: SyncAccountScope,
  exact: string = 'A highlighted answer',
): HighlightExportPayload {
  const accountHash = hashString(accountScope.accountKey);
  return {
    format: 'gemini-voyager.annotations.v1',
    exportedAt: '2026-07-12T20:00:00.000Z',
    version: '1.2.3',
    accountScope: { platform: 'gemini', accountHash },
    items: [
      {
        id: 'highlight-1',
        schemaVersion: 1,
        platform: 'gemini',
        accountHash,
        conversationId: 'conversation-1',
        conversationUrl: 'https://gemini.google.com/u/2/app/conversation-1',
        conversationTitle: 'Conversation title',
        turnId: 'turn-1',
        role: 'assistant',
        anchor: {
          quote: { exact, prefix: 'before ', suffix: ' after' },
          position: { start: 7, end: 7 + exact.length },
          sourceTextHash: 'source-text-hash',
        },
        note: 'Keep this exact quote intact.',
        color: 'yellow',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        revision: { counter: 1, deviceId: 'device-1' },
      },
    ],
  };
}

export function responseJson(data: unknown, status: number = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}
