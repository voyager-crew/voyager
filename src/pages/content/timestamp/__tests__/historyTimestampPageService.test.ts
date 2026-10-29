import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { FolderStore } from '../../folder/FolderStore';
import type { IFolderStorageAdapter } from '../../folder/storage/FolderStorageAdapter';
import { resolveStoredHighlightTurnId } from '../../highlight/dom';
import { activateGeminiTimeline } from '../../timeline/pluginHandler';
import { TimestampService } from '../TimestampService';
import {
  startHistoryTimestampPageService,
  whenHistoryTimestampsReady,
} from '../historyTimestampPageService';
import { historyTimestampStore } from '../historyTimestamps';

const CID = 'c_26dfc929fd75fe3d';
const NATIVE_ID = '26dfc929fd75fe3d';
const SERVER_TURN_ID = 's-000000006a4c13f1';
const TURN_TIME = 1_783_370_737_262;

function captureBody(): string {
  const turn = [
    [CID, 'r_000000006a4c13f1'],
    [CID, 'r_a23872877afd8022', 'rc_27a9438ecdf0a13d'],
    [['first question', null, null, null, [[]]], 2, null, 1, '56fdd199312815e2'],
    [[['rc_b2d1629d6a044d8a', ['answer'], null]]],
    [1_783_370_737, 261_574_000],
  ];
  const rows = JSON.stringify([
    ['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, null, null]), null, null, null, 'generic'],
  ]);
  return `)]}'\n\n${rows.length}\n${rows}\n`;
}

let captureSequence = 0;
function postCapture(): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        source: 'gv-history-observer',
        type: 'capture',
        payload: { id: `service-capture:${++captureSequence}`, body: captureBody() },
      },
      origin: window.location.origin,
      source: window as unknown as MessageEventSource,
    }),
  );
}

function observerCommands(postMessage: { mock: { calls: unknown[][] } }) {
  return postMessage.mock.calls
    .map(([message]) => message as { source?: string; type?: string; payload?: unknown })
    .filter((message) => message?.source === 'gv-history-observer-cmd');
}

function createFolderStore(): FolderStore {
  const adapter: IFolderStorageAdapter = {
    init: vi.fn(async () => {}),
    loadData: vi.fn(async () => null),
    saveData: vi.fn(async () => true),
    removeData: vi.fn(async () => {}),
    getBackendName: () => 'test-memory',
  };
  return new FolderStore(
    {
      getContext: () => ({ sidebar: null, sortMode: 'manual', enabled: true }),
      onChange: vi.fn(),
      onArchive: vi.fn(),
      onRecovery: vi.fn(),
    },
    adapter,
  );
}

describe('history timestamp page service', () => {
  let stopService: (() => void) | null = null;
  let postMessage: { mock: { calls: unknown[][] }; mockClear(): void };

  beforeEach(() => {
    history.replaceState({}, '', `/app/${NATIVE_ID}`);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
    postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    stopService?.();
    stopService = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('requires the page service for shared data while history still runs without a timeline', async () => {
    await expect(whenHistoryTimestampsReady()).resolves.toBe(true);
    await expect(whenHistoryTimestampsReady(undefined, { requirePageService: true })).resolves.toBe(
      false,
    );
    expect(observerCommands(postMessage)).toEqual([]);
    stopService = startHistoryTimestampPageService();
    await expect(whenHistoryTimestampsReady(undefined, { requirePageService: true })).resolves.toBe(
      true,
    );

    expect(observerCommands(postMessage)).toContainEqual(
      expect.objectContaining({ type: 'configure', payload: { enabled: true } }),
    );
    postCapture();
    expect(historyTimestampStore.resolveCanonicalTurnId(NATIVE_ID, 'u-0')).toBe(SERVER_TURN_ID);
  });

  it('keeps folder and highlight alias lookups working after the timeline stops', async () => {
    stopService = startHistoryTimestampPageService();
    await whenHistoryTimestampsReady();
    document.body.innerHTML = '<main></main>';
    const scope = new PluginScope();
    activateGeminiTimeline(scope, {}, geminiAdapter);
    await scope.dispose();

    postCapture();

    expect(resolveStoredHighlightTurnId('u-0')).toBe(SERVER_TURN_ID);
    expect(createFolderStore().getKnownConversationLastTurnAt(CID)).toBe(TURN_TIME);
  });

  it('a retiring content script does not switch the history observer off for its successor', () => {
    const stopRetiring = startHistoryTimestampPageService();
    postMessage.mockClear();

    stopRetiring();

    expect(observerCommands(postMessage)).not.toContainEqual(
      expect.objectContaining({ type: 'configure', payload: { enabled: false } }),
    );
  });

  it('a folder continuation that resumes after page teardown does not reinstall the history listener', async () => {
    const stopPage = startHistoryTimestampPageService();
    let finishTimestampRead!: () => void;
    vi.spyOn(TimestampService.prototype, 'initialize').mockReturnValue(
      new Promise<void>((resolve) => {
        finishTimestampRead = resolve;
      }),
    );
    const addListener = vi.spyOn(document, 'addEventListener');
    const folders = createFolderStore();
    const tracking = folders.initializeConversationActivityTracking();

    stopPage();
    finishTimestampRead();
    await tracking;
    postCapture();

    expect(historyTimestampStore.getTurns(NATIVE_ID)).toBeNull();
    expect(addListener.mock.calls.filter(([type]) => type === 'click')).toEqual([]);
  });
});
