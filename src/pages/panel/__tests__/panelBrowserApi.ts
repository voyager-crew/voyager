import { vi } from 'vitest';

function createExtensionApi() {
  return {
    storage: {
      sync: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), getBytesInUse: vi.fn() },
      local: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), getBytesInUse: vi.fn() },
      session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      id: 'test-extension-id',
      getManifest: vi.fn(),
      getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
      sendMessage: vi.fn(),
      connect: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn(),
      request: vi.fn(),
      remove: vi.fn(),
      getAll: vi.fn(),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: {
      registerContentScripts: vi.fn(),
      unregisterContentScripts: vi.fn(),
      getRegisteredContentScripts: vi.fn(),
    },
    i18n: { getUILanguage: vi.fn(() => 'en'), getMessage: vi.fn((key: string) => key) },
  };
}

const SHARED = Symbol.for('voyager.panelTestExtensionApi');
const realm = globalThis as { [SHARED]?: ReturnType<typeof createExtensionApi> };

/**
 * The extension APIs an embedded extension page has. No `tabs` or `windows`:
 * the panel must never reach them (Safari crashes the tab, Firefox lacks them).
 * One object per test file, even across `vi.resetModules()`, so the
 * `webextension-polyfill` mock and the harness always configure the same one.
 * Each panel test file mocks the polyfill with it before anything imports it:
 *
 *     vi.mock('webextension-polyfill', async () => ({
 *       default: (await import('./panelBrowserApi')).extensionApi,
 *     }));
 */
export const extensionApi = (realm[SHARED] ??= createExtensionApi());
