// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/test" }
import { type Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { highlightAnnotationService } from '@/core/services/HighlightAnnotationService';
import { StorageKeys } from '@/core/types/common';
import {
  HIGHLIGHT_STORAGE_NAMESPACE,
  type HighlightAccountScope,
  type HighlightCreateInput,
  type HighlightRecordV1,
} from '@/core/types/highlight';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';
import { timelineAnnotations } from '@/features/timeline/timelineAnnotations';

import { handleHighlightRuntimeMessage } from '../../background/highlightMessages';
import { selectText } from '../highlight/__tests__/fixtures';
import { buildHighlightAnchor } from '../highlight/anchor';
import { activateGeminiHighlight } from '../highlight/pluginHandler';
import { registerBuiltinNativeHandlers } from '../pluginNativeRegistration';
import { createSelectionStartup } from '../selectionStartup';
import { type LifecycleHarness, installLifecycleHarness } from './lifecycleHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  onCachedLanguageChange: () => () => {},
}));
vi.mock('@/core/services/AccountIsolationService', async (original) => ({
  ...(await original<typeof import('@/core/services/AccountIsolationService')>()),
  detectAccountContextFromDocument: () => ({ routeUserId: '0', email: 'me@example.com' }),
  accountIsolationService: { resolveAccountScope: vi.fn() },
}));
// Keep the real background router, serialization, store and schema; only the storage API is a fixture.
vi.mock('@/core/services/HighlightAnnotationService', async (original) => {
  const actual = await original<typeof import('@/core/services/HighlightAnnotationService')>();
  return {
    ...actual,
    highlightAnnotationService: new actual.HighlightAnnotationService({
      storage: {
        async get(keys) {
          return chrome.storage.local.get(
            keys === null || typeof keys === 'string' ? keys : [...keys],
          );
        },
        async set(items) {
          await chrome.storage.local.set(items);
        },
        async remove(keys) {
          await chrome.storage.local.remove(typeof keys === 'string' ? keys : [...keys]);
        },
      },
    }),
  };
});

const ID = OFFICIAL_PLUGIN_IDS.geminiHighlight;
/** Highlight ticks handed to the timeline. */
const ticks = () => timelineAnnotations.snapshot().filter(({ source }) => source === 'highlight');
const CONVERSATION_ID = 'gemini:conv:test';
const SCOPE: HighlightAccountScope = {
  platform: 'gemini',
  accountKey: 'email:me@example.com',
  accountId: 1,
  routeUserId: '0',
};
const RESOLVED_SCOPE = { ...SCOPE, emailHash: 'me@example.com' };
const RECT = {
  x: 100,
  y: 200,
  top: 200,
  bottom: 220,
  left: 100,
  right: 220,
  width: 120,
  height: 20,
};
let harness: LifecycleHarness;
let cleanup: CleanupManager;
let host: PluginHost | null;
const releasePending: Array<() => void> = [];

async function flush(): Promise<void> {
  for (let round = 0; round < 100; round++) await Promise.resolve();
}

function holdScope(): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(accountIsolationService.resolveAccountScope).mockImplementationOnce(async () => {
    await held;
    return RESOLVED_SCOPE;
  });
  releasePending.push(release);
  return release;
}

async function start(enabled?: unknown): Promise<void> {
  if (enabled !== undefined) harness.storage.sync.set(StorageKeys.HIGHLIGHT_ENABLED, enabled);
  const admission = createOfficialAdmission();
  const selection = createSelectionStartup(admission, cleanup);
  await selection.start();
  admission.close();
  host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource()],
    doc: document,
    admission,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  await flush();
}

function flip(enabled: unknown): void {
  harness.storage.sync.set(StorageKeys.HIGHLIGHT_ENABLED, enabled);
  const changes = { [StorageKeys.HIGHLIGHT_ENABLED]: { newValue: enabled } };
  harness.emitStorageChange(changes, 'sync');
}

function selectAnswer(): void {
  const range = selectText(document.getElementById('answer')!, 'target');
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup'));
  vi.advanceTimersByTime(250);
}

function mark(): HTMLElement | null {
  return document.querySelector('.gv-highlight-mark');
}

function annotationData(): Record<string, unknown> {
  return structuredClone(
    Object.fromEntries(
      [...harness.storage.local].filter(([key]) => key.startsWith(HIGHLIGHT_STORAGE_NAMESPACE)),
    ),
  );
}

async function stored(includeDeleted = false): Promise<HighlightRecordV1[]> {
  return highlightAnnotationService.getConversation(SCOPE, CONVERSATION_ID, { includeDeleted });
}

async function seed(): Promise<HighlightRecordV1> {
  const answer = document.getElementById('answer')!;
  const anchor = buildHighlightAnchor(answer, selectText(answer, 'target'));
  if (!anchor) throw new Error('Expected highlight anchor');
  const input: HighlightCreateInput = {
    conversationId: CONVERSATION_ID,
    conversationUrl: location.href,
    turnId: 's-1111111111111111',
    role: 'assistant',
    anchor,
    color: 'pink',
    note: 'Original annotation',
  };
  return (await highlightAnnotationService.add(SCOPE, input)).record;
}

beforeAll(registerBuiltinNativeHandlers);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
  history.replaceState({}, '', '/u/0/app/test');
  document.body.innerHTML = `
    <main><div class="conversation-container" id="1111111111111111">
      <div class="user-query-bubble-with-background">Question</div>
      <model-response><message-content id="answer">Alpha target Omega</message-content></model-response>
    </div></main>`;
  harness = installLifecycleHarness();
  cleanup = new CleanupManager();
  host = null;
  vi.mocked(accountIsolationService.resolveAccountScope)
    .mockReset()
    .mockResolvedValue(RESOLVED_SCOPE);
  (
    chrome.tabs.query as unknown as Mock<
      (query: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>
    >
  ).mockResolvedValue([]);
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    message: unknown,
    callback?: (result: Record<string, unknown> | undefined) => void,
  ) => {
    const response = handleHighlightRuntimeMessage(message, {
      id: 'test-extension-id',
      tab: { id: 7, url: location.href } as chrome.tabs.Tab,
    });
    if (response) void response.then((result) => callback?.(result));
    else callback?.(undefined);
    return response ?? Promise.resolve(undefined);
  }) as never);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT as DOMRect);
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => RECT as DOMRect,
  });
  // The legacy opt-in remains authoritative even if an old plugin backup says enabled.
  harness.storage.local.set(StorageKeys.PLUGINS_STATE, { [ID]: { enabled: true, installedAt: 1 } });
});

afterEach(async () => {
  releasePending.splice(0).forEach((release) => release());
  host?.stop();
  cleanup.executeCleanups();
  await flush();
  await stored(true);
  harness.restore();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.clearAllTimers();
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('Highlight through its registered official plugin', () => {
  it('only true enables highlights and off preserves annotations for re-enable', async () => {
    const original = await seed();
    const before = annotationData();
    await start();
    for (const value of [undefined, false, 'true', 1]) {
      flip(value);
      await flush();
      expect(mark()).toBeNull();
    }
    flip(true);
    await flush();
    expect(mark()?.textContent).toBe('target');
    expect(document.querySelectorAll('.gv-highlight-mark')).toHaveLength(1);
    expect(ticks()).toHaveLength(1);
    mark()!.click();
    expect(document.querySelector<HTMLTextAreaElement>('.gv-highlight-note')?.value).toBe(
      original.note,
    );
    flip(false);
    await flush();
    expect(mark()).toBeNull();
    expect(ticks()).toHaveLength(0);
    expect(document.querySelector('.gv-highlight-popover')).toBeNull();
    expect(annotationData()).toEqual(before);
    selectAnswer();
    expect(document.querySelector('.gv-quote-btn')).not.toBeNull();
    expect(document.querySelector('.gv-highlight-action')).toBeNull();
    flip(true);
    await flush();
    expect(document.querySelectorAll('.gv-highlight-mark')).toHaveLength(1);
    expect(ticks()).toHaveLength(1);
    expect(await stored()).toEqual([original]);
    const status = host!.getStatuses().find((entry) => entry.id === ID)?.kind;
    expect(status).toBe('mounted');
  });

  it('turning Highlight off mid-init attaches nothing when the account lookup arrives late', async () => {
    await seed();
    const release = holdScope();
    await start(true);
    expect(document.getElementById('gv-highlight-style')).not.toBeNull();
    flip(false);
    await flush();
    const before = annotationData();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    release();
    await flush();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('gv-highlight-style')).toBeNull();
    expect(document.querySelector('.gv-highlight-live')).toBeNull();
    expect(mark()).toBeNull();
    expect(annotationData()).toEqual(before);
  });

  it('scope abort removes Highlight immediately while a later effect is still disposing', async () => {
    await start(false);
    const release = holdScope();
    const scope = new PluginScope();
    activateGeminiHighlight(scope);
    let finish!: () => void;
    scope.effect(() => () => new Promise<void>((resolve) => (finish = resolve)));
    selectAnswer();
    expect(document.querySelector('.gv-highlight-action')).not.toBeNull();
    const stopping = scope.dispose();
    try {
      expect(document.querySelector('.gv-highlight-action')).toBeNull();
      expect(document.getElementById('gv-highlight-style')).toBeNull();
      release();
      await flush();
      expect(mark()).toBeNull();
    } finally {
      finish();
      await stopping;
    }
  });

  it.each([
    ['save', '.gv-highlight-popover-button-primary', 'gv.highlight.update'],
    ['delete', '.gv-highlight-popover-button-danger', 'gv.highlight.delete'],
  ])(
    'a retained %s button starts no new write after off, while an already accepted action finishes',
    async (action, selector, messageType) => {
      const original = await seed();
      await start(true);
      mark()!.click();
      const oldButton = document.querySelector<HTMLButtonElement>(selector)!;
      flip(false);
      await flush();
      const before = annotationData();
      vi.mocked(chrome.runtime.sendMessage).mockClear();
      oldButton.click();
      await flush();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(annotationData()).toEqual(before);

      flip(true);
      await flush();
      mark()!.click();
      document.querySelector<HTMLTextAreaElement>('.gv-highlight-note')!.value =
        'Accepted before off';
      const release = holdScope();
      document.querySelector<HTMLButtonElement>(selector)!.click();
      flip(false);
      await flush();
      release();
      await flush();
      const records = await stored(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: messageType }),
        expect.any(Function),
      );
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(original.id);
      if (action === 'save') expect(records[0].note).toBe('Accepted before off');
      else expect(records[0].deletedAt).toEqual(expect.any(Number));
      expect(mark()).toBeNull();
      expect(document.querySelector('.gv-highlight-live')).toBeNull();
      flip(true);
      await flush();
      expect(Boolean(mark())).toBe(action === 'save');
      if (action === 'save') {
        mark()!.click();
        expect(document.querySelector<HTMLTextAreaElement>('.gv-highlight-note')?.value).toBe(
          'Accepted before off',
        );
      }
    },
  );

  it('a highlight accepted before off is saved to the same background store and appears on re-enable', async () => {
    await start(true);
    selectAnswer();
    const release = holdScope();
    document.querySelector<HTMLButtonElement>('.gv-highlight-action')!.click();
    flip(false);
    await flush();
    release();
    await flush();
    const records = await stored();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      conversationId: CONVERSATION_ID,
      conversationUrl: location.href,
      anchor: { quote: { exact: 'target' } },
    });
    expect(mark()).toBeNull();
    expect(document.querySelector('.gv-highlight-live')).toBeNull();
    flip(true);
    await flush();
    expect(mark()?.dataset.gvHighlightId).toBe(records[0].id);
    expect(ticks()).toHaveLength(1);
  });
});
