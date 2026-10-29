import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { BundledCatalogPluginSource } from '../sources/BundledCatalogPluginSource';
import { effectivePluginView } from './effectivePluginView';
import { loadLegacySettingSnapshot, resolveEffectiveEnabled } from './legacySettingBindings';
import { loadPluginState, setPluginEnabled } from './pluginState';
import {
  type PromptCoverageBinding,
  promptCoverageBindingFor,
  promptCoverageBindingForUrl,
  setPromptCoverageEnabled,
} from './promptCoverageBinding';

const COVERAGE = StorageKeys.PROMPT_CUSTOM_WEBSITES;
const PLUGINS = StorageKeys.PLUGINS_STATE;
const CHATGPT = 'voyager.chatgpt-prompt-manager';
const CLAUDE = 'voyager.claude-prompt-manager';
const CHATGPT_URL = 'https://chatgpt.com/c/one';
const CHATGPT_ALIAS = 'https://chat.openai.com/c/one';
const INITIAL_PLUGINS = {
  [CHATGPT]: { enabled: true, installedAt: 2, settings: { stray: 'ignored' } },
  'untouched.plugin': { enabled: false, installedAt: 7, settings: { width: 80 } },
};

let memory: MemoryStorage;
let previousStorage: typeof chrome.storage;

beforeEach(() => {
  previousStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  memory.values.local.set(PLUGINS, structuredClone(INITIAL_PLUGINS));
});

afterEach(() => {
  vi.restoreAllMocks();
  chrome.storage = previousStorage;
});

function bindingFor(id: string, url?: string): PromptCoverageBinding {
  const binding = promptCoverageBindingFor(id, url);
  if (!binding) throw new Error(`Missing Prompt Manager coverage binding for ${id}`);
  return binding;
}

describe('stored Prompt Manager coverage', () => {
  it.each([
    [CHATGPT, CHATGPT_URL, 'chatgpt.com', 'chatgpt.com'],
    [CHATGPT, CHATGPT_ALIAS, 'chat.openai.com', 'chat.openai.com'],
    [CLAUDE, 'https://claude.ai/chat/one', 'claude.ai', 'claude.ai'],
    [
      CLAUDE,
      'https://artifact.frame.claudeusercontent.com/index.html',
      'artifact.frame.claudeusercontent.com',
      'frame.claudeusercontent.com',
    ],
    [
      'voyager.deepseek-prompt-manager',
      'https://chat.deepseek.com/a/chat/s/one',
      'chat.deepseek.com',
      'deepseek.com',
    ],
    ['voyager.kimi-prompt-manager', 'https://www.kimi.com/chat/one', 'www.kimi.com', 'kimi.com'],
  ])('reads existing coverage for %s on %s without migration', async (id, url, host, entry) => {
    memory.values.sync.set(COVERAGE, ['keep.example', entry]);
    const binding = bindingFor(id, url);
    const snapshot = await loadLegacySettingSnapshot();
    const state = await loadPluginState();

    expect(binding.host).toBe(host);
    expect(promptCoverageBindingForUrl(url)?.pluginId).toBe(id);
    expect(binding.read(snapshot[COVERAGE])).toBe(true);
    expect(resolveEffectiveEnabled(state, snapshot, id, undefined, url)).toBe(true);
    expect(memory.writes).toEqual([]);
    expect(memory.values.sync.get(COVERAGE)).toEqual(['keep.example', entry]);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it.each([
    { label: 'undefined', stored: undefined },
    { label: 'null', stored: null },
    { label: 'boolean', stored: false },
    { label: 'string', stored: 'chatgpt.com' },
    { label: 'object', stored: { 'chatgpt.com': true } },
    { label: 'invalid array entries', stored: [null, 5, '<all_urls>', 'not-a-host'] },
  ])('defaults $label coverage to off', async ({ stored }) => {
    memory.values.sync.set(COVERAGE, stored);
    const snapshot = await loadLegacySettingSnapshot();

    expect(bindingFor(CHATGPT).read(snapshot[COVERAGE])).toBe(false);
    expect(resolveEffectiveEnabled(INITIAL_PLUGINS, snapshot, CHATGPT)).toBe(false);
    expect(memory.writes).toEqual([]);
  });

  it('returns to off after the coverage key is removed', async () => {
    memory.values.sync.set(COVERAGE, ['chatgpt.com']);
    expect(bindingFor(CHATGPT).read((await chrome.storage.sync.get(COVERAGE))[COVERAGE])).toBe(
      true,
    );

    await chrome.storage.sync.remove(COVERAGE);
    memory.writes.length = 0;
    const snapshot = await loadLegacySettingSnapshot();

    expect(resolveEffectiveEnabled(INITIAL_PLUGINS, snapshot, CHATGPT)).toBe(false);
    expect(memory.values.sync.has(COVERAGE)).toBe(false);
    expect(memory.writes).toEqual([]);
  });

  it('keeps page aliases independent when switching coverage', async () => {
    memory.values.sync.set(COVERAGE, ['keep.example', 'chat.openai.com']);
    expect(bindingFor(CHATGPT).read(memory.values.sync.get(COVERAGE))).toBe(false);
    expect(bindingFor(CHATGPT, CHATGPT_ALIAS).read(memory.values.sync.get(COVERAGE))).toBe(true);

    await setPluginEnabled(CHATGPT, true);
    await setPluginEnabled(CHATGPT, false, CHATGPT_ALIAS);

    const snapshot = await loadLegacySettingSnapshot();
    expect(snapshot[COVERAGE]).toEqual(['keep.example', 'chatgpt.com']);
    expect(resolveEffectiveEnabled(INITIAL_PLUGINS, snapshot, CHATGPT)).toBe(true);
    expect(
      resolveEffectiveEnabled(INITIAL_PLUGINS, snapshot, CHATGPT, undefined, CHATGPT_ALIAS),
    ).toBe(false);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('round trips normalized string arrays while preserving unrelated coverage and plugin data', async () => {
    memory.values.sync.set(COVERAGE, [
      ' HTTPS://WWW.Keep.Example/some/path ',
      'www.keep.example',
      'localhost:3000',
      'https://other.example/path',
      null,
      '<all_urls>',
    ]);
    const prompts = [{ id: 'saved', text: 'Keep this prompt.', name: 'Saved', tags: [] }];
    memory.values.local.set(StorageKeys.PROMPT_ITEMS, prompts);
    const binding = bindingFor(CHATGPT, CHATGPT_URL);

    await setPromptCoverageEnabled(binding, true);
    expect((await chrome.storage.sync.get(COVERAGE))[COVERAGE]).toEqual([
      'keep.example',
      'localhost:3000',
      'other.example',
      'chatgpt.com',
    ]);
    await setPromptCoverageEnabled(binding, false);

    expect((await chrome.storage.sync.get(COVERAGE))[COVERAGE]).toEqual([
      'keep.example',
      'localhost:3000',
      'other.example',
    ]);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
    expect(memory.values.local.get(StorageKeys.PROMPT_ITEMS)).toEqual(prompts);
    expect(memory.writes.every(({ area, key }) => area === 'sync' && key === COVERAGE)).toBe(true);
  });

  it('keeps coverage authoritative in the effective view, including a concrete alias URL', async () => {
    const manifest = (await new BundledCatalogPluginSource().list()).find(
      (plugin) => plugin.id === CHATGPT,
    );
    if (!manifest) throw new Error('The bundled ChatGPT Prompt Manager manifest is missing');
    memory.values.sync.set(COVERAGE, ['chat.openai.com']);
    const snapshot = await loadLegacySettingSnapshot();
    const state = await loadPluginState();

    expect(effectivePluginView(manifest, state, snapshot)).toEqual({
      enabled: false,
      settings: {},
      authority: 'legacy',
    });
    expect(effectivePluginView(manifest, state, snapshot, CHATGPT_ALIAS)).toEqual({
      enabled: true,
      settings: {},
      authority: 'legacy',
    });
    expect(
      effectivePluginView(manifest, state, snapshot, 'https://claude.ai/chat/one').enabled,
    ).toBe(false);
    expect(memory.writes).toEqual([]);
  });
});

describe('coverage write boundaries', () => {
  it('writes nothing when the current coverage cannot be read', async () => {
    const original = ['keep.example', 'claude.ai'];
    memory.values.sync.set(COVERAGE, original);
    const failure = new Error('sync read failed');
    vi.spyOn(chrome.storage.sync, 'get').mockImplementationOnce(async () => {
      throw failure;
    });

    await expect(setPromptCoverageEnabled(bindingFor(CHATGPT), true)).rejects.toBe(failure);

    expect(memory.writes).toEqual([]);
    expect(memory.values.sync.get(COVERAGE)).toEqual(original);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('retains both hosts when independent enable operations overlap', async () => {
    memory.values.sync.set(COVERAGE, ['keep.example']);
    const read = chrome.storage.sync.get.bind(chrome.storage.sync);
    let arrived = () => {};
    let release = () => {};
    const seen = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A browser reply can arrive after another enable starts; it contains the older snapshot.
    vi.spyOn(chrome.storage.sync, 'get').mockImplementationOnce(async () => {
      const snapshot = await read(COVERAGE);
      arrived();
      await held;
      return snapshot;
    });
    const chatgpt = setPluginEnabled(CHATGPT, true);
    await seen;
    const claude = setPluginEnabled(CLAUDE, true);
    release();
    await Promise.all([chatgpt, claude]);

    expect((await chrome.storage.sync.get(COVERAGE))[COVERAGE]).toEqual([
      'keep.example',
      'chatgpt.com',
      'claude.ai',
    ]);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
    expect(memory.writes.every(({ area, key }) => area === 'sync' && key === COVERAGE)).toBe(true);
  });

  it('turns off a host covered through a parent domain by removing every entry that covers it', async () => {
    const original = ['keep.example', 'deepseek.com', 'chat.deepseek.com', 'api.deepseek.com'];
    memory.values.sync.set(COVERAGE, original);
    const binding = bindingFor('voyager.deepseek-prompt-manager', 'https://chat.deepseek.com/a');

    // The caller gets both lists, so an undo can put the removed entries back where they were.
    await expect(setPromptCoverageEnabled(binding, false)).resolves.toEqual({
      before: original,
      after: ['keep.example', 'api.deepseek.com'],
    });

    expect(memory.values.sync.get(COVERAGE)).toEqual(['keep.example', 'api.deepseek.com']);
    expect(binding.read(memory.values.sync.get(COVERAGE))).toBe(false);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
  });

  it('rejects a mismatching page URL without falling back to plugin-state storage', async () => {
    memory.values.sync.set(COVERAGE, ['keep.example']);

    await expect(setPluginEnabled(CHATGPT, true, 'https://claude.ai/chat/one')).rejects.toThrow();

    expect(memory.values.sync.get(COVERAGE)).toEqual(['keep.example']);
    expect(memory.values.local.get(PLUGINS)).toEqual(INITIAL_PLUGINS);
    expect(memory.writes).toEqual([]);
  });
});

describe('coverage binding scope', () => {
  it.each([
    'voyager.gemini-prompt-manager',
    'voyager.aistudio-prompt-manager',
    'voyager.chatgpt-prompt-manager-extra',
    'local.voyager.chatgpt-prompt-manager',
    'toString',
    '__proto__',
  ])('does not bind the unrecognized or native plugin id %s', (id) => {
    expect(promptCoverageBindingFor(id)).toBeNull();
    expect(promptCoverageBindingFor(id, CHATGPT_URL)).toBeNull();
    expect(memory.writes).toEqual([]);
  });

  it.each([
    'not a URL',
    'http://chatgpt.com/',
    'https://chatgpt.com.evil.example/',
    'https://claude.ai.evil.example/',
    'https://frame.claudeusercontent.com/',
    'https://gemini.google.com/u/1/app/one',
    'https://aistudio.google.com/prompts/one',
    'https://aistudio.google.cn/prompts/one',
    'https://custom.example/',
  ])('does not bind a native, non-catalog or invalid page: %s', (url) => {
    expect(promptCoverageBindingForUrl(url)).toBeNull();
    expect(promptCoverageBindingFor(CHATGPT, url)).toBeNull();
    expect(memory.writes).toEqual([]);
  });
});
