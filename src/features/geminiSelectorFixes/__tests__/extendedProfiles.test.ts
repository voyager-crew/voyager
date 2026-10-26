import { afterEach, describe, expect, it } from 'vitest';

import { getBundledGeminiSelectorView } from '@/core/gemini/selectors/bundle';

import { geminiSelectorCacheKey, readCachedGeminiSelectorFile } from '../cache';
import { GeminiSelectorRefresher } from '../refresh';
import { HOST, VERSION, cacheEntry, jsonResponse, memoryStorage, selectorFile } from './testKit';

afterEach(() => document.body.replaceChildren());

function cachedRows(value: unknown): string[] {
  const file = readCachedGeminiSelectorFile(value, HOST, VERSION);
  if (!file) throw new Error('Expected an accepted cache');
  const rows =
    file.selectors['sidebar.row'] ?? getBundledGeminiSelectorView().profiles['sidebar.row'];
  return Array.from(document.querySelectorAll(rows.join(','))).map((row) => row.id);
}

describe('Gemini refresh for newly migrated surfaces', () => {
  it('asks for a refresh on sidebar-only changes and keeps the accepted row IDs', async () => {
    document.body.innerHTML = `
      <div id="packaged-row" data-test-id="conversation"></div>
      <div id="online-row" class="new-row"></div>`;
    const boundary = memoryStorage({ [geminiSelectorCacheKey(HOST)]: cacheEntry() });
    const next = selectorFile(12, {
      'turn.user': ['.fixed-user'],
      'sidebar.row': ['.new-row'],
    });
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl: async () => jsonResponse(next),
      extensionVersion: VERSION,
      bundledRevision: 10,
    });
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'updated', cachedRevision: 12 });
    expect(cachedRows(boundary.values[geminiSelectorCacheKey(HOST)])).toEqual(['online-row']);
  });

  it('keeps equivalent picker data up to date and the existing sidebar fix usable', async () => {
    document.body.innerHTML = '<div id="chat" class="new-row"></div>';
    const previous = selectorFile(11, { 'sidebar.row': ['.new-row'] });
    const next = selectorFile(12, {
      ...previous.selectors,
      'modelPicker.items': getBundledGeminiSelectorView().profiles['modelPicker.items'],
    });
    const boundary = memoryStorage({ [geminiSelectorCacheKey(HOST)]: cacheEntry(previous) });
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl: async () => jsonResponse(next),
      extensionVersion: VERSION,
      bundledRevision: 10,
    });
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'upToDate', cachedRevision: 12 });
    expect(cachedRows(boundary.values[geminiSelectorCacheKey(HOST)])).toEqual(['chat']);
  });

  it('withdraws a sidebar override at a higher revision and restores packaged rows', async () => {
    document.body.innerHTML = `
      <div id="existing" data-test-id="conversation"></div>
      <div id="online" class="new-row"></div>`;
    const boundary = memoryStorage({
      [geminiSelectorCacheKey(HOST)]: cacheEntry(selectorFile(11, { 'sidebar.row': ['.new-row'] })),
    });
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl: async () => jsonResponse(selectorFile(12, {})),
      extensionVersion: VERSION,
      bundledRevision: 10,
    });
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'updated', cachedRevision: 12 });
    expect(cachedRows(boundary.values[geminiSelectorCacheKey(HOST)])).toEqual(['existing']);
  });
});
