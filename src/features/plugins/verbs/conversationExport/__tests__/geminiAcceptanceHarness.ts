import JSZip from 'jszip';
import { expect, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { ExportFormat } from '@/features/export/types/export';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { mountGeminiAcceptanceFixture } from './geminiAcceptanceFixture';

export const FIXED_TIME = '2026-01-02T03:04:05.000Z';
const captures = vi.hoisted(() => ({ images: [] as string[] }));
export const imageInputs = captures.images;

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

// jsdom cannot rasterize. Capture the real, fully prepared DOM at the browser renderer boundary.
vi.mock('html-to-image', () => ({
  toBlob: async (target: HTMLElement) => {
    captures.images.push(target.outerHTML);
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  },
}));

export async function until(done: () => boolean): Promise<void> {
  for (let step = 0; step < 400 && !done(); step++) await vi.advanceTimersByTimeAsync(50);
  expect(done()).toBe(true);
}

export function button(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Export control missing: ${selector}`);
  return found;
}

export async function chooseFormat(format: ExportFormat): Promise<void> {
  await until(() => !!document.querySelector('.gv-export-dialog'));
  button(`.gv-export-dialog input[value="${format}"]`).click();
  button('.gv-export-dialog-btn-primary').click();
}

export async function beginExport(format: ExportFormat): Promise<void> {
  button('.gv-persistent-export-btn').click();
  await chooseFormat(format);
}

export async function confirmSelection(selectAll = true): Promise<void> {
  await until(() => !!document.querySelector('.gv-export-select-bar'));
  // The run read the whole conversation, so every message starts selected.
  if (selectAll) {
    await until(() => button('[data-gv-export-action="selectAll"]').dataset.checked === 'true');
  }
  vi.setSystemTime(FIXED_TIME);
  button('[data-gv-export-action="export"]').click();
}

export interface GeminiAcceptancePage {
  readonly fixture: ReturnType<typeof mountGeminiAcceptanceFixture>;
  readonly memory: MemoryStorage;
  readonly files: Array<{ blob: Blob; filename: string }>;
  readonly printed: string[];
  close(): Promise<void>;
}

/** The actual official admission, handlers, PluginHost, UI, readers and exporters run together. */
export async function openGeminiPage(
  options: {
    report?: boolean;
    beforeStart?: (memory: MemoryStorage) => Promise<void>;
  } = {},
): Promise<GeminiAcceptancePage> {
  vi.resetModules();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  const originalStorage = chrome.storage;
  const memory = createMemoryStorage();
  for (const area of [memory.api.sync, memory.api.local]) {
    const write = area.set;
    vi.spyOn(area, 'set').mockImplementation((items, callback?: () => void) => {
      const result = write(items);
      if (callback) void result.then(callback);
      return result;
    });
  }
  vi.spyOn(originalStorage.sync, 'get').mockImplementation(memory.api.sync.get);
  vi.spyOn(originalStorage.local, 'get').mockImplementation(memory.api.local.get);
  chrome.storage = memory.api;
  memory.values.sync.set(StorageKeys.LANGUAGE, 'en');
  memory.values.sync.set(StorageKeys.GEMINI_EXPORT_ENABLED, true);
  memory.values.sync.set(StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED, true);
  imageInputs.length = 0;
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  });
  const fixture = mountGeminiAcceptanceFixture({ report: options.report });
  const files: GeminiAcceptancePage['files'] = [];
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
    const url = `blob:gemini-acceptance-${blobs.size}`;
    blobs.set(url, value);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (blob && this.download) files.push({ blob, filename: this.download });
      else this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    },
  );
  vi.spyOn(window, 'print').mockImplementation(() => {
    const dom = document.querySelector(
      '#gv-pdf-print-container, #gv-deep-research-pdf-print-container',
    );
    if (!dom) throw new Error('Missing print DOM');
    printed.push(dom.outerHTML);
  });
  const [
    { PluginHost },
    { createOfficialAdmission },
    { BuiltinPluginSource },
    { HostCatalogSource },
    startup,
    registration,
    { CleanupManager },
    { startPageSelectors },
  ] = await Promise.all([
    import('@/features/plugins/runtime/PluginHost'),
    import('@/features/plugins/runtime/officialAdmission'),
    import('@/features/plugins/sources/BuiltinPluginSource'),
    import('@/features/plugins/remote/HostCatalogSource'),
    import('@/pages/content/geminiBuiltinStartup'),
    import('@/pages/content/pluginNativeRegistration'),
    import('@/core/utils/cleanupManager'),
    import('@/pages/content/pageSelectorStartup'),
  ]);
  const releaseHandlers = registration.registerBuiltinNativeHandlers();
  const cleanup = new CleanupManager();
  const lifetime = new AbortController();
  const admission = createOfficialAdmission();
  const native = startup.createGeminiBuiltinStartup(admission, cleanup, lifetime.signal);
  await native.startExport();
  if (options.report) await native.startDeepResearchExport();
  admission.close();
  await options.beforeStart?.(memory);
  const selectors = startPageSelectors({
    url: location.href,
    doc: document,
    lifetime: lifetime.signal,
  });
  await selectors.ready;
  const host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource(), new HostCatalogSource({ enabled: true })],
    admission,
    initialAdapter: selectors.initialAdapter,
    legacySettings: selectors.legacySettings,
    doc: document,
    requestCatalogRefresh: () => {},
    formFactor: async () => 'desktop',
    isTopFrame: true,
  });
  await host.start();
  await until(() => !!document.querySelector('.gv-persistent-export-btn'));
  return {
    fixture,
    memory,
    files,
    printed,
    async close() {
      host.stop();
      lifetime.abort();
      selectors.stop();
      releaseHandlers();
      cleanup.executeCleanups();
      await vi.advanceTimersByTimeAsync(500);
      window.dispatchEvent(new Event('afterprint'));
      chrome.storage = originalStorage;
      vi.unstubAllEnvs();
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
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

export async function fileBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!reader.result || typeof reader.result === 'string')
        return reject(new Error('Missing bytes'));
      resolve(new Uint8Array(reader.result));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function markdownFile(blob: Blob): Promise<string> {
  const reading = (async () => {
    const archive = await JSZip.loadAsync(await fileBytes(blob));
    const entry = Object.values(archive.files).find((file) => file.name.endsWith('.md'));
    if (!entry) throw new Error('Missing archived Markdown');
    return entry.async('string');
  })();
  let done = false;
  void reading.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await until(() => done);
  return reading;
}

export async function fileHex(blob: Blob): Promise<string> {
  return Array.from(await fileBytes(blob), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
