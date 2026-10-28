// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/1111111111111111" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';

import { HighlightClient } from '../highlight/client';
import { collapseInput } from '../inputCollapse';
import { COLLAPSED_CLASS } from '../inputCollapse/dom';
import { createGeminiInputStartup } from '../inputStartup';
import { registerBuiltinNativeHandlers } from '../pluginNativeRegistration';
import { activateGeminiQuoteReply } from '../quoteReply/pluginHandler';
import { createSelectionStartup } from '../selectionStartup';
import { type LifecycleHarness, installLifecycleHarness } from './lifecycleHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  onCachedLanguageChange: () => () => {},
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiQuoteReply;
const RECT = {
  x: 100,
  y: 200,
  left: 100,
  top: 200,
  right: 220,
  bottom: 220,
  width: 120,
  height: 20,
};
let harness: LifecycleHarness;
let cleanup: CleanupManager;
let host: PluginHost | null;
let routeStorage: ((changes: Record<string, chrome.storage.StorageChange>) => void) | undefined;

async function flush(): Promise<void> {
  for (let round = 0; round < 60; round++) await Promise.resolve();
}

async function start(quote = true, collapse = false, highlight = false): Promise<void> {
  harness.storage.sync.set(StorageKeys.QUOTE_REPLY_ENABLED, quote);
  harness.storage.sync.set(StorageKeys.INPUT_COLLAPSE_ENABLED, collapse);
  harness.storage.sync.set(StorageKeys.HIGHLIGHT_ENABLED, highlight);
  const admission = createOfficialAdmission();
  const selection = createSelectionStartup(admission, cleanup);
  const input = createGeminiInputStartup(admission, cleanup);
  routeStorage = (changes) => {
    input.handleStorageChange(changes, 'sync');
  };
  await selection.start();
  await input.startInputCollapse();
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

function flipQuote(enabled: boolean): void {
  harness.storage.sync.set(StorageKeys.QUOTE_REPLY_ENABLED, enabled);
  const changes = { [StorageKeys.QUOTE_REPLY_ENABLED]: { newValue: enabled } };
  routeStorage?.(changes);
  harness.emitStorageChange(changes, 'sync');
}

function select(id: string): void {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById(id)!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup'));
  vi.advanceTimersByTime(250);
}

function quoteButton(): HTMLButtonElement | null {
  return document.querySelector('.gv-quote-btn');
}

function editor(): HTMLElement {
  return document.querySelector('.ql-editor')!;
}

beforeAll(registerBuiltinNativeHandlers);
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/u/0/app/1111111111111111');
  document.body.innerHTML = `
    <main><div class="conversation-container" id="1111111111111111">
      <div class="user-query-bubble-with-background"><p id="question">Question text</p></div>
      <model-response><message-content><p id="answer">Answer text</p></message-content></model-response>
    </div></main>
    <div class="composer" style="display:flex;background:rgb(240,244,249)">
      <rich-textarea><div class="ql-editor ql-blank" role="textbox" contenteditable="true"><p><br></p></div></rich-textarea>
    </div>`;
  harness = installLifecycleHarness();
  cleanup = new CleanupManager();
  host = null;
  routeStorage = undefined;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (this.closest(`.${COLLAPSED_CLASS}`) ? { ...RECT, height: 0 } : RECT) as DOMRect;
    },
  );
  editor().scrollIntoView = vi.fn();
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => RECT as DOMRect,
  });
  vi.spyOn(HighlightClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(HighlightClient.prototype, 'create').mockImplementation(async (_scope, input) => ({
    ...input,
    id: 'saved-highlight',
    schemaVersion: 1,
    platform: 'gemini',
    accountHash: 'test-account',
    color: input.color ?? 'yellow',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: { counter: 1, deviceId: 'test-device' },
  }));
});

afterEach(async () => {
  host?.stop();
  cleanup.executeCleanups();
  await flush();
  harness.restore();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Quote through its registered official plugin', () => {
  it('turning Quote off keeps Highlight usable and sent quotes styled', async () => {
    document.getElementById('question')!.classList.add('query-text-line');
    document.getElementById('question')!.textContent = '> Sent quote';
    await start(true, false, true);
    select('answer');
    expect(host!.getStatuses().find((entry) => entry.id === ID)?.kind).toBe('mounted');
    expect(document.querySelectorAll('.gv-selection-toolbar')).toHaveLength(1);
    flipQuote(false);
    await flush();
    expect(quoteButton()).toBeNull();
    expect(document.querySelector('.gv-rendered-quote')).not.toBeNull();
    const highlight = document.querySelector<HTMLButtonElement>('.gv-highlight-action')!;
    expect(highlight.classList.contains('gv-hidden')).toBe(false);
    highlight.click();
    await flush();
    expect(HighlightClient.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({ routeUserId: '0' }),
      expect.objectContaining({
        anchor: expect.objectContaining({
          quote: expect.objectContaining({ exact: 'Answer text' }),
        }),
      }),
    );
    expect(document.querySelector('.gv-highlight-mark')?.textContent).toBe('Answer text');
  });

  it('quoting expands the composer collapsed by its real input-collapse plugin and inserts the text', async () => {
    await start(true, true);
    expect(
      host!.getStatuses().find((entry) => entry.id === OFFICIAL_PLUGIN_IDS.geminiInputCollapse)
        ?.kind,
    ).toBe('mounted');
    collapseInput();
    const container = document.querySelector('.composer')!;
    expect(container.classList.contains(COLLAPSED_CLASS)).toBe(true);
    expect(getComputedStyle(document.querySelector('rich-textarea')!).visibility).toBe('hidden');
    select('answer');
    quoteButton()!.click();
    expect(container.classList.contains(COLLAPSED_CLASS)).toBe(false);
    vi.advanceTimersByTime(200);
    expect(editor().textContent).toBe('> Answer text\n');
  });

  it('a quote accepted before its plugin turns off still lands in the same chat', async () => {
    await start();
    select('question');
    quoteButton()!.click();
    flipQuote(false);
    await flush();
    expect(quoteButton()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(editor().textContent).toBe('> Question text\n');
  });

  it('scope abort removes Quote before a later effect finishes disposing', async () => {
    await start(false);
    const scope = new PluginScope();
    activateGeminiQuoteReply(scope);
    let finish!: () => void;
    scope.effect(
      () => () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    select('answer');
    expect(quoteButton()).not.toBeNull();
    const stopped = scope.dispose();
    try {
      expect(quoteButton()).toBeNull();
    } finally {
      finish();
      await stopped;
    }
  });
});
