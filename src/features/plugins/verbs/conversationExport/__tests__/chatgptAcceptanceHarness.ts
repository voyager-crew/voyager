import { expect, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PDF_PRINT_CONTAINER_ID } from '@/features/export/services/pdfPrintDocument';
import type { ExportFormat } from '@/features/export/types/export';
import { HostCatalogSource } from '@/features/plugins/remote/HostCatalogSource';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';
import {
  type ThreadFixtureOptions,
  mountThreadFixture,
} from '@/pages/content/export/adapter/__tests__/chatgptThreadFixture';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

export const EXPORT_PLUGIN = 'voyager.chatgpt-export';
export const FIXED_TIME = '2026-01-02T03:04:05.000Z';
export const THREAD = [
  { key: 'turn-01', height: 1500, user: 'What is energy?', assistant: 'Energy is work.' },
  {
    key: 'turn-02',
    height: 1500,
    user: 'First line\nSecond line',
    assistant: 'Two lines noted.',
  },
  { key: 'turn-03', height: 1500, user: '谢谢', assistant: 'You are welcome.' },
];

/** Advance the host's real polling protocol, with virtual time and an observable end condition. */
export async function until(done: () => boolean): Promise<void> {
  for (let step = 0; step < 300 && !done(); step++) await vi.advanceTimersByTimeAsync(50);
  expect(done()).toBe(true);
}

export function button(selector: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`Export control missing: ${selector}`);
  return found;
}

export async function beginExport(format: ExportFormat): Promise<void> {
  button('.gv-persistent-export-btn').click();
  await until(() => !!document.querySelector('.gv-export-dialog'));
  const radio = document.querySelector<HTMLInputElement>(`input[value="${format}"]`);
  if (!radio) throw new Error(`Export format missing: ${format}`);
  radio.click();
  button('.gv-export-dialog-btn-primary').click();
}

export async function confirmAll(): Promise<void> {
  await until(() => !!document.querySelector('.gv-export-select-bar'));
  button('[data-gv-export-action="selectAll"]').click();
  expect(button('[data-gv-export-action="export"]').disabled).toBe(false);
  // Fix the serialization clock after the crawl; elapsed polling time is intentionally irrelevant.
  vi.setSystemTime(FIXED_TIME);
  button('[data-gv-export-action="export"]').click();
}

export interface AcceptancePage {
  readonly memory: MemoryStorage;
  readonly fixture: ReturnType<typeof mountThreadFixture>;
  readonly files: Array<{ blob: Blob; filename: string }>;
  readonly printed: string[];
  close(): Promise<void>;
}

/** Browser APIs are replaced at their boundary; PluginHost, reader, UI and formatters are real. */
export async function openAcceptancePage(
  fixtureOptions: ThreadFixtureOptions = { turns: THREAD, initiallyLoaded: 1, pageSize: 1 },
  beforeStart?: (memory: MemoryStorage) => Promise<void>,
): Promise<AcceptancePage> {
  const originalStorage = chrome.storage;
  const memory = createMemoryStorage();
  // StorageService captures its areas at import time; both browser access styles share this store.
  vi.spyOn(originalStorage.sync, 'get').mockImplementation(memory.api.sync.get);
  vi.spyOn(originalStorage.local, 'get').mockImplementation(memory.api.local.get);
  chrome.storage = memory.api;
  memory.values.sync.set(StorageKeys.LANGUAGE, 'en');
  const builtin = new BuiltinPluginSource();
  const plugins = await builtin.list();
  memory.values.local.set(
    StorageKeys.PLUGINS_STATE,
    Object.fromEntries(
      plugins.map((plugin) => [
        plugin.id,
        { enabled: plugin.id === EXPORT_PLUGIN, installedAt: 1 },
      ]),
    ),
  );
  document.title = 'Voyager 测试';
  const fixture = mountThreadFixture(fixtureOptions);
  const files: AcceptancePage['files'] = [];
  const printed: string[] = [];
  const blobs = new Map<string, Blob>();
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((...args: unknown[]) => {
    const response = { ok: true, messages: [], data: { messages: {} } };
    const callback = args.find((argument) => typeof argument === 'function');
    if (typeof callback === 'function') callback(response);
    return Promise.resolve(response);
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    if (!(value instanceof Blob)) throw new Error('Expected exported Blob');
    const url = `blob:chatgpt-acceptance-${blobs.size}`;
    blobs.set(url, value);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (blob && this.download) files.push({ blob, filename: this.download });
    },
  );
  vi.spyOn(window, 'print').mockImplementation(() => {
    const dom = document.getElementById(PDF_PRINT_CONTAINER_ID);
    if (!dom) throw new Error('Missing PDF print DOM');
    printed.push(dom.outerHTML);
  });
  await beforeStart?.(memory);
  const host = new PluginHost({
    url: location.href,
    sources: [builtin, new HostCatalogSource({ enabled: true })],
    requestCatalogRefresh: () => {},
    formFactor: async () => 'desktop',
    doc: document,
  });
  await host.start();
  await until(() => !!document.querySelector('.gv-persistent-export-btn'));
  return {
    memory,
    fixture,
    files,
    printed,
    async close() {
      host.stop();
      await vi.advanceTimersByTimeAsync(500);
      window.dispatchEvent(new Event('afterprint'));
      chrome.storage = originalStorage;
    },
  };
}

export async function fileText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
