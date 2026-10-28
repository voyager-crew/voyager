import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { PageRetiredError, createPageSteps } from '../../pageInitSteps';
import { type PromptManagerEngine, createPromptManagerEngine } from '../promptManagerEngine';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));

type Values = Record<string, unknown>;
type LooseGet = (keys: unknown, callback?: (items: Values) => void) => Promise<Values>;

let sync: Values;
let local: Values;
let cleanup: CleanupManager;

function storageGet(area: () => Values): typeof chrome.storage.sync.get {
  const get = (
    keys: string | string[] | Values | null = null,
    callback?: (items: Values) => void,
  ): Promise<Values> => {
    const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const names =
      keys === null
        ? Object.keys(area())
        : typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
    const result = Object.fromEntries(names.map((key) => [key, area()[key] ?? defaults[key]]));
    callback?.(result);
    return Promise.resolve(result);
  };
  return get as typeof chrome.storage.sync.get;
}

/** Holds the next read of `key` until `release` is called with what it should return. */
function holdSyncRead(key: string): (value: unknown) => void {
  const read = vi.mocked(chrome.storage.sync.get).getMockImplementation() as unknown as LooseGet;
  let release!: (value: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(((
    keys: unknown,
    callback?: (items: Values) => void,
  ) => {
    if (keys && typeof keys === 'object' && key in keys) {
      return held.then((value) => ({ [key]: value }));
    }
    return read(keys, callback);
  }) as typeof chrome.storage.sync.get);
  return release;
}

function emit(changes: Record<string, unknown>, area: 'sync' | 'local'): void {
  for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
    (listener as (changes: object, area: string) => void)(changes, area);
  }
}

const setting = (key: string, newValue: unknown) => ({ [key]: { newValue } });

function engineFor(url: string): PromptManagerEngine {
  setPageUrl(url);
  return createPromptManagerEngine(resolvePromptSiteAdapter(url), cleanup);
}

const slashRoot = () => document.getElementById('gv-pm-slash-root');
const triggers = () => document.querySelectorAll('#gv-pm-trigger');
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
  sync = { [StorageKeys.LANGUAGE]: 'en' };
  local = { [StorageKeys.PROMPT_ITEMS]: [] };
  vi.mocked(chrome.storage.sync.get).mockImplementation(storageGet(() => sync));
  vi.mocked(chrome.storage.local.get).mockImplementation(storageGet(() => local));
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true } as never);
  cleanup = new CleanupManager();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The panel wraps console.warn for KaTeX; restoreAllMocks undoes it.
  vi.spyOn(console, 'warn');
});

afterEach(() => {
  cleanup.executeCleanups();
  resetPageUrl();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('slash completion', () => {
  it.each(['https://gemini.google.com/app', 'https://business.gemini.google/app'])(
    'starts on %s',
    async (url) => {
      await engineFor(url).startComposerFeatures();

      expect(slashRoot()).not.toBeNull();
    },
  );

  it.each([
    'https://aistudio.google.com/prompts/new_chat',
    'https://chatgpt.com/',
    'https://chat.deepseek.com/',
    'http://localhost:5173/',
  ])('stays out of %s without listening to storage', async (url) => {
    await engineFor(url).startComposerFeatures();

    expect(slashRoot()).toBeNull();
    expect(chrome.storage.onChanged.addListener).not.toHaveBeenCalled();
  });

  it('follows the synced setting live on Gemini Enterprise and ignores local writes', async () => {
    sync[StorageKeys.SLASH_PROMPT_ENABLED] = false;
    await engineFor('https://business.gemini.google/app').startComposerFeatures();
    expect(slashRoot()).toBeNull();

    emit(setting(StorageKeys.SLASH_PROMPT_ENABLED, true), 'sync');
    await vi.waitFor(() => expect(slashRoot()).not.toBeNull());

    emit(setting(StorageKeys.SLASH_PROMPT_ENABLED, false), 'sync');
    await vi.waitFor(() => expect(slashRoot()).toBeNull());

    emit(setting(StorageKeys.SLASH_PROMPT_ENABLED, true), 'local');
    await settle();
    expect(slashRoot()).toBeNull();
  });

  it('treats removing the setting as restoring the enabled default', async () => {
    sync[StorageKeys.SLASH_PROMPT_ENABLED] = false;
    await engineFor('https://gemini.google.com/app').startComposerFeatures();

    emit(setting(StorageKeys.SLASH_PROMPT_ENABLED, undefined), 'sync');

    await vi.waitFor(() => expect(slashRoot()).not.toBeNull());
  });

  it('does not let a stale startup read overwrite a newer change', async () => {
    const release = holdSyncRead(StorageKeys.SLASH_PROMPT_ENABLED);
    const starting = engineFor('https://gemini.google.com/app').startComposerFeatures();
    await vi.waitFor(() => expect(chrome.storage.onChanged.addListener).toHaveBeenCalled());

    emit(setting(StorageKeys.SLASH_PROMPT_ENABLED, false), 'sync');
    release(true);
    await starting;
    await settle();

    expect(slashRoot()).toBeNull();
  });

  it('keeps collapsing sent prompts after slash completion is turned off', async () => {
    const review = { id: 'review', name: 'Review', text: 'Review this change' };
    local[StorageKeys.PROMPT_ITEMS] = [review];
    await engineFor('https://gemini.google.com/app').startComposerFeatures();

    emit(setting(StorageKeys.SLASH_PROMPT_ENABLED, false), 'sync');
    await vi.waitFor(() => expect(slashRoot()).toBeNull());
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span class="user-query-bubble-with-background"><div class="query-text">' +
        '<p class="query-text-line">Review this change</p></div></span>',
    );

    await vi.waitFor(() =>
      expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review'),
    );
  });

  it('still lets the panel mount when slash completion fails to start', async () => {
    const read = vi.mocked(chrome.storage.sync.get).getMockImplementation() as unknown as LooseGet;
    vi.mocked(chrome.storage.sync.get).mockImplementation(((
      keys: unknown,
      callback?: (items: Values) => void,
    ) => {
      if (keys && typeof keys === 'object' && StorageKeys.CTRL_ENTER_SEND in keys) {
        throw new Error('storage unavailable');
      }
      return read(keys, callback);
    }) as typeof chrome.storage.sync.get);
    const engine = engineFor('https://gemini.google.com/app');

    await expect(engine.startComposerFeatures()).resolves.toBeUndefined();
    await engine.startPanel();

    expect(slashRoot()).toBeNull();
    expect(triggers()).toHaveLength(1);
  });
});

describe('panel coverage', () => {
  const URL_ = 'https://chatgpt.com/';
  const HOST = 'chatgpt.com';
  const covered = (websites: string[]) => setting(StorageKeys.PROMPT_CUSTOM_WEBSITES, websites);

  it('mounts while the custom-website list covers the host and follows it live', async () => {
    await engineFor(URL_).followCoverage(HOST);
    expect(triggers()).toHaveLength(0);

    emit(covered([HOST]), 'sync');
    await vi.waitFor(() => expect(triggers()).toHaveLength(1));

    emit(covered([]), 'sync');
    await vi.waitFor(() => expect(triggers()).toHaveLength(0));

    emit(covered([HOST]), 'sync');
    await vi.waitFor(() => expect(triggers()).toHaveLength(1));
  });

  it('never leaves two panels when on, off and on land during one mount', async () => {
    await engineFor(URL_).followCoverage(HOST);

    emit(covered([HOST]), 'sync');
    emit(covered([]), 'sync');
    emit(covered([HOST]), 'sync');

    await vi.waitFor(() => expect(triggers()).toHaveLength(1));
    await settle();
    expect(triggers()).toHaveLength(1);
  });

  it('unmounts when the site is switched off while the startup mount is in flight', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = [HOST];
    const following = engineFor(URL_).followCoverage(HOST);
    await vi.waitFor(() =>
      expect(chrome.storage.sync.get).toHaveBeenCalledWith({ gvHidePromptManager: false }),
    );

    emit(covered([]), 'sync');
    await following;

    await vi.waitFor(() => expect(triggers()).toHaveLength(0));
    await settle();
    expect(triggers()).toHaveLength(0);
  });

  it('ignores a startup read older than a change already handled', async () => {
    const release = holdSyncRead(StorageKeys.PROMPT_CUSTOM_WEBSITES);
    const following = engineFor(URL_).followCoverage(HOST);
    await vi.waitFor(() => expect(chrome.storage.onChanged.addListener).toHaveBeenCalled());

    emit(covered([]), 'sync');
    release([HOST]);
    await following;
    await settle();

    expect(triggers()).toHaveLength(0);
  });

  it('keeps the mounted panel through local writes and changes that leave coverage alone', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = [HOST];
    await engineFor(URL_).followCoverage(HOST);
    await vi.waitFor(() => expect(triggers()).toHaveLength(1));
    const mounted = triggers()[0];

    emit(covered([]), 'local');
    emit(covered([HOST, 'example.com']), 'sync');
    await settle();

    expect(triggers()).toHaveLength(1);
    expect(triggers()[0]).toBe(mounted);
  });

  it('stops a panel whose mount finishes after page teardown', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = [HOST];
    const following = engineFor(URL_).followCoverage(HOST);
    await vi.waitFor(() =>
      expect(chrome.storage.sync.get).toHaveBeenCalledWith({ gvHidePromptManager: false }),
    );

    cleanup.executeCleanups();
    await following;

    await vi.waitFor(() => expect(triggers()).toHaveLength(0));
    await settle();
    expect(triggers()).toHaveLength(0);
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled();
  });
});

describe('a content script that retired during startup', () => {
  const GEMINI = 'https://gemini.google.com/app';

  function retiringPage(url: string) {
    setPageUrl(url);
    const lifetime = new AbortController();
    const { settle: step } = createPageSteps(lifetime.signal);
    const engine = createPromptManagerEngine(
      resolvePromptSiteAdapter(url),
      cleanup,
      lifetime.signal,
    );
    const retire = (): void => {
      lifetime.abort();
      cleanup.executeCleanups();
    };
    return { engine, step, retire };
  }

  it('starts no slash completion or sent-prompt chips and leaves no cleanup behind when it retires during the slash setting read', async () => {
    const release = holdSyncRead(StorageKeys.SLASH_PROMPT_ENABLED);
    const { engine, step, retire } = retiringPage(GEMINI);

    const started = step(engine.startComposerFeatures());
    retire();
    release(true);

    await expect(started).rejects.toBeInstanceOf(PageRetiredError);
    await settle();
    expect(slashRoot()).toBeNull();
    expect(cleanup.list()).toEqual([]);
  });

  it('stops a panel whose mount finishes after it retired, leaving no cleanup behind', async () => {
    const { engine, step, retire } = retiringPage(GEMINI);

    const started = step(engine.startPanel());
    await vi.waitFor(() =>
      expect(chrome.storage.sync.get).toHaveBeenCalledWith({ gvHidePromptManager: false }),
    );
    retire();

    await expect(started).rejects.toBeInstanceOf(PageRetiredError);
    await settle();
    expect(triggers()).toHaveLength(0);
    expect(cleanup.list()).toEqual([]);
  });
});
