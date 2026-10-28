import { type Mock, afterEach, beforeEach, expect, it, vi } from 'vitest';

import * as sendKeys from '@/core/services/composer/sendKeys/sendKeyCoordinator';
import { CleanupPositions } from '@/core/types/cleanupPositions';
import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { flushDraftsBeforeUnload } from '@/pages/content/draftSave/draftUnloadFlush';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { draftSavePrimitive } from './index';

const adapter = requireBundledSiteAdapter('gemini');
let records: Record<string, unknown>;
let scopes: PluginScope[];
let coordinator: sendKeys.SendKeyCoordinator;
let input: HTMLElement;
let button: HTMLButtonElement;
let height: number;
let loads: Array<(result: Record<string, unknown>) => void>;

function start(): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  draftSavePrimitive.activate(
    scope,
    {},
    {
      pluginId: 'local.test.draft',
      settings: {},
      adapter,
      doc: document,
      setTargetCounter: () => {},
    },
  );
  return scope;
}
function type(text: string): void {
  input.textContent = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function key(modifiers: KeyboardEventInit = {}): void {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers }),
  );
}
function navigate(path: string, sentText?: string): void {
  setPageUrl(path);
  input.textContent = '';
  if (sentText) {
    const turn = document.createElement('user-query');
    const text = document.createElement('p');
    text.className = 'query-text-line';
    text.textContent = sentText;
    turn.append(text);
    document.body.append(turn);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}
const pause = () => vi.advanceTimersByTimeAsync(1100);

beforeEach(() => {
  vi.useFakeTimers();
  records = {};
  scopes = [];
  loads = [];
  setPageUrl('https://gemini.google.com/app');
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  delete document.body.dataset.workspace;
  document.body.innerHTML =
    '<div data-email="first@example.test"></div><div class="text-input-field"><rich-textarea><div id="prompt" contenteditable="true" role="textbox"></div></rich-textarea><button class="send-button submit" aria-label="Send message">Send</button></div>';
  input = document.querySelector('#prompt')!;
  button = document.querySelector('button')!;
  height = 100;
  Object.defineProperty(input, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ height, width: 500 }),
  });
  Object.defineProperty(button, 'offsetParent', { configurable: true, value: document.body });
  (chrome.storage.local.get as unknown as Mock).mockImplementation(
    (keys: string | null, callback?: (value: Record<string, unknown>) => void) => {
      const result = keys === null ? { ...records } : { [keys]: records[keys] };
      callback?.(result);
      return Promise.resolve(result);
    },
  );
  (chrome.storage.local.set as unknown as Mock).mockImplementation(
    (items: Record<string, unknown>, callback?: () => void) => {
      Object.assign(records, items);
      callback?.();
      return Promise.resolve();
    },
  );
  (chrome.storage.local.remove as unknown as Mock).mockImplementation(
    (keys: string | string[], callback?: () => void) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete records[k];
      callback?.();
      return Promise.resolve();
    },
  );
  (chrome.storage.sync.get as unknown as Mock).mockImplementation(
    (defaults: Record<string, unknown>, callback?: (value: Record<string, unknown>) => void) => {
      const value = { ...defaults, [StorageKeys.DRAFT_AUTO_SAVE]: true };
      callback?.(value);
      return Promise.resolve(value);
    },
  );
  coordinator = sendKeys.createSendKeyCoordinator('gemini');
  vi.spyOn(sendKeys, 'getSendKeyCoordinator').mockReturnValue(coordinator);
});
afterEach(async () => {
  await Promise.all(scopes.map((scope) => scope.dispose()));
  coordinator.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetPageUrl();
  document.body.replaceChildren();
});

it.each(['/u/0/app/abc', '/u/1/app/abc', '/u/1/gem/my-gem/abc'])(
  'saves Gemini drafts under gvDraft_ and full pathname %s',
  async (path) => {
    setPageUrl(path);
    start();
    await vi.advanceTimersByTimeAsync(0);
    type('unsent draft');
    await pause();
    expect(records[`gvDraft_${path}`]).toMatchObject({ content: 'unsent draft', path });
    expect(Object.keys(records)).toEqual([`gvDraft_${path}`]);
  },
);

it('drops the new-chat draft only after the first actual send creates a conversation', async () => {
  records['gvDraft_/app'] = { content: 'saved earlier', timestamp: 1, path: '/app' };
  start();
  await vi.advanceTimersByTimeAsync(0);
  type('first sent prompt');
  key();
  navigate('/app/new-conversation', 'first sent prompt');
  await pause();
  expect(records['gvDraft_/app']).toBeUndefined();
});

it('keeps a saved draft when an upload blocks send and the host empties the composer', async () => {
  records['gvDraft_/app'] = { content: 'upload draft' };
  start();
  await vi.advanceTimersByTimeAsync(0);
  button.parentElement!.append(document.createElement('progress'));
  key();
  input.textContent = '';
  await vi.advanceTimersByTimeAsync(500);
  expect(records['gvDraft_/app']).toMatchObject({ content: 'upload draft' });
});

it('restores the main draft without overwriting an edited old question', async () => {
  records['gvDraft_/app'] = { content: 'main draft' };
  const edit = document.createElement('div');
  edit.className = 'user-query-container edit-mode';
  edit.innerHTML =
    '<rich-textarea><div contenteditable="true" role="textbox">old question editing</div></rich-textarea>';
  const editor = edit.querySelector<HTMLElement>('[contenteditable]')!;
  Object.defineProperty(editor, 'getBoundingClientRect', { value: () => ({ height: 100 }) });
  document.body.prepend(edit);
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(input.textContent).toBe('main draft');
  expect(editor.textContent).toBe('old question editing');
});

it('keeps both drafts when a send intent has no evidence before programmatic navigation', async () => {
  records['gvDraft_/app/other'] = { content: 'destination draft' };
  start();
  await vi.advanceTimersByTimeAsync(0);
  type('source unsent tail');
  button.click();
  setPageUrl('/app/other');
  input.textContent = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  window.dispatchEvent(new PopStateEvent('popstate'));
  await pause();
  expect(records['gvDraft_/app']).toMatchObject({ content: 'source unsent tail' });
  expect(records['gvDraft_/app/other']).toMatchObject({ content: 'destination draft' });
  expect(input.textContent).toBe('destination draft');
});

it('saves the captured source draft when switching account slots before its debounce', async () => {
  setPageUrl('/u/0/app/first');
  start();
  await vi.advanceTimersByTimeAsync(0);
  type('first account tail');
  navigate('/u/1/app/second');
  await pause();
  expect(records['gvDraft_/u/0/app/first']).toMatchObject({ content: 'first account tail' });
  expect(records['gvDraft_/u/1/app/second']).toBeUndefined();
});

it.each([true, false])(
  'keeps the source draft on sidebar navigation even with upload blocked=%s',
  async (uploading) => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    type('keep this source');
    if (uploading) button.parentElement!.append(document.createElement('progress'));
    button.click();
    const link = document.createElement('a');
    link.href = '/app/other';
    document.body.append(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    navigate('/app/other');
    await pause();
    expect(records['gvDraft_/app']).toMatchObject({ content: 'keep this source' });
  },
);

it.each([{ isComposing: true }, { key: 'Process' }, { keyCode: 229 }, {}])(
  'does not drop a draft on IME or a newline in Ctrl+Enter mode: %j',
  async (modifiers) => {
    coordinator.registerMainMode({ source: 'test', mode: 'ctrlEnterSends' });
    records['gvDraft_/app'] = { content: 'keep draft' };
    start();
    await vi.advanceTimersByTimeAsync(0);
    key(modifiers);
    input.textContent = '';
    await vi.advanceTimersByTimeAsync(500);
    expect(records['gvDraft_/app']).toMatchObject({ content: 'keep draft' });
  },
);

it('two draft owners survive out-of-order loads after the user types and sends', async () => {
  (chrome.storage.local.get as unknown as Mock).mockImplementation((_key, callback) => {
    loads.push(callback);
  });
  start();
  start();
  type('new prompt');
  button.click();
  input.textContent = '';
  await vi.advanceTimersByTimeAsync(250);
  for (const load of [...loads].reverse()) load({ 'gvDraft_/app': { content: 'stale draft' } });
  await pause();
  expect(input.textContent).toBe('');
  expect(records['gvDraft_/app']).toBeUndefined();
});

it.each([false, true])(
  'drops a late restore when the same pathname changes email, retry=%s',
  async (retry) => {
    records['gvDraft_/app'] = { content: 'first account draft' };
    (chrome.storage.local.get as unknown as Mock).mockImplementation((_key, callback) => {
      loads.push(callback);
    });
    if (retry) height = 0;
    start();
    if (retry) {
      loads.shift()!({ 'gvDraft_/app': records['gvDraft_/app'] });
      await vi.advanceTimersByTimeAsync(0);
    }
    document.querySelector('[data-email]')!.setAttribute('data-email', 'second@example.test');
    height = 100;
    if (!retry) loads.shift()!({ 'gvDraft_/app': records['gvDraft_/app'] });
    await pause();
    expect(input.textContent).toBe('');
    expect(records['gvDraft_/app']).toMatchObject({ content: 'first account draft' });
  },
);

it('stopping one owner keeps the other pending save', async () => {
  const first = start();
  start();
  await vi.advanceTimersByTimeAsync(0);
  type('second owner saves');
  await first.dispose();
  await pause();
  expect(Object.keys(records)).toEqual(['gvDraft_/app']);
  expect(records['gvDraft_/app']).toMatchObject({ content: 'second owner saves' });
});

it('two draft owners agree on an actual send followed by navigation', async () => {
  start();
  start();
  await vi.advanceTimersByTimeAsync(0);
  type('shared first send');
  button.click();
  navigate('/app/new', 'shared first send');
  await pause();
  expect(Object.keys(records)).toEqual([]);
});

it('flushes the last keystrokes before plugin teardown but ordinary off keeps saved drafts', async () => {
  const scope = start();
  await vi.advanceTimersByTimeAsync(0);
  type('last keystrokes');
  const cleanup = new CleanupManager();
  cleanup.registerCleanupFunction(() => {
    void scope.dispose();
  }, CleanupPositions.CleanupPluginHost);
  cleanup.registerCleanupFunction(
    flushDraftsBeforeUnload,
    CleanupPositions.FlushDraftsBeforeUnload,
  );
  cleanup.executeCleanups();
  await scope.dispose();
  window.dispatchEvent(new Event('pagehide'));
  expect(records['gvDraft_/app']).toMatchObject({ content: 'last keystrokes' });
  const reopened = start();
  await vi.advanceTimersByTimeAsync(0);
  type('unsaved after reopening');
  button.click();
  const closing = reopened.dispose();
  input.textContent = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await closing;
  flushDraftsBeforeUnload();
  await pause();
  expect(records['gvDraft_/app']).toMatchObject({ content: 'last keystrokes' });
});

it('reads existing native drafts and reopens records written in the same format', async () => {
  records['gvDraft_/app'] = { content: 'native saved this', timestamp: 1, path: '/app' };
  const scope = start();
  await vi.advanceTimersByTimeAsync(0);
  expect(input.textContent).toBe('native saved this');
  type('plugin saved this');
  await pause();
  expect(records['gvDraft_/app']).toEqual({
    content: 'plugin saved this',
    timestamp: expect.any(Number),
    path: '/app',
  });
  await scope.dispose();
  input.textContent = '';
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(input.textContent).toBe('plugin saved this');
});

it.each(['host', 'url', 'dom'])('writes no draft on Gemini Enterprise by %s hint', async (hint) => {
  if (hint === 'host') setPageUrl('https://business.gemini.google/app');
  if (hint === 'url') setPageUrl('?workspace=true');
  if (hint === 'dom') document.body.dataset.workspace = 'business';
  start();
  type('must not be stored');
  await pause();
  expect(Object.keys(records)).toEqual([]);
});
