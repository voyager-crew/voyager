import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import {
  PANEL_MESSAGE,
  PANEL_PORT_MESSAGE,
  type PanelContext,
  type PanelSession,
  type PanelSessionId,
  type PanelShellMessage,
} from '@/features/panel/protocol';
import { setCachedLanguage } from '@/utils/i18n';
import type { AppLanguage } from '@/utils/language';
import { loadTranslations } from '@/utils/translations';

import { PanelApp } from '../PanelApp';
import { extensionApi } from './panelBrowserApi';

export const en = await loadTranslations('en');

type Listener = (...args: unknown[]) => void;
type Area = 'sync' | 'local' | 'session';

export { extensionApi };

export const SESSION_ID = 'a'.repeat(64) as PanelSessionId;
export const GEMINI: PanelContext = {
  pageUrl: 'https://gemini.google.com/app',
  siteId: 'gemini',
  accountSlot: '0',
  scheme: 'light',
  direction: 'ltr',
};
export const CLAUDE: PanelContext = {
  ...GEMINI,
  pageUrl: 'https://claude.ai/new',
  siteId: 'claude',
};

export function sessionFor(context: PanelContext): PanelSession {
  return { sessionId: SESSION_ID, context, hostOrigin: new URL(context.pageUrl).origin };
}

function readStorage(keys: unknown, stored: Record<string, unknown>): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...stored };
  if (typeof keys === 'string') return Object.hasOwn(stored, keys) ? { [keys]: stored[keys] } : {};
  if (Array.isArray(keys)) {
    return Object.fromEntries(
      keys.filter((key: string) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]]),
    );
  }
  return Object.fromEntries(
    Object.entries(keys as Record<string, unknown>).map(([key, fallback]) => [
      key,
      Object.hasOwn(stored, key) ? stored[key] : fallback,
    ]),
  );
}

export let sync: Record<string, unknown>;
export let local: Record<string, unknown>;
export let session: Record<string, unknown>;
/** The browser's host grants: exact patterns, as the extension asks for them. */
export const granted = new Set<string>();
let storageListeners: Listener[] = [];
const permissionListeners = { added: [] as Listener[], removed: [] as Listener[] };
let portListeners: Listener[] = [];

/** What the browser does after a storage write: tells every listener, in a later task. */
function changed(area: Area, changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) {
  queueMicrotask(() => {
    for (const listener of storageListeners) listener(changes, area);
  });
}

/** A change made elsewhere (another window, the popup, an install). */
export async function writeElsewhere(area: Area, updates: Record<string, unknown>): Promise<void> {
  const stored = { sync, local, session }[area];
  const changes = Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [
      key,
      { oldValue: stored[key], newValue: value },
    ]),
  );
  Object.assign(stored, updates);
  await act(async () => {
    changed(area, changes);
    await flush();
  });
}

/** The shell's context update, forwarded by the background over the panel's port. */
export async function updateContext(context: PanelContext): Promise<void> {
  await act(async () => {
    for (const listener of portListeners) {
      listener({ type: PANEL_PORT_MESSAGE.context, payload: { sessionId: SESSION_ID, context } });
    }
    await flush();
  });
}

/** Window messages the page sent to the shell (its parent frame), in order. */
export let posted: PanelShellMessage[] = [];
export const postedKinds = () => posted.map((message) => message.kind);

export async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('chrome', extensionApi);
  sync = { [StorageKeys.MERMAID_ENABLED]: false };
  local = {};
  session = {};
  granted.clear();
  storageListeners = [];
  permissionListeners.added = [];
  permissionListeners.removed = [];
  portListeners = [];
  posted = [];
  for (const area of ['sync', 'local', 'session'] as const) {
    const api = extensionApi.storage[area];
    api.get.mockImplementation((keys: unknown, callback?: unknown) => {
      const result = readStorage(keys, { sync, local, session }[area]);
      if (typeof callback === 'function') callback(result);
      return Promise.resolve(result);
    });
    api.set.mockImplementation((updates: Record<string, unknown>, callback?: unknown) => {
      const stored = { sync, local, session }[area];
      const changes = Object.fromEntries(
        Object.entries(updates).map(([key, value]) => [
          key,
          { oldValue: stored[key], newValue: value },
        ]),
      );
      Object.assign(stored, updates);
      changed(area, changes);
      if (typeof callback === 'function') callback();
      return Promise.resolve();
    });
    api.remove.mockImplementation((keys: string | string[], callback?: unknown) => {
      const stored = { sync, local, session }[area];
      const changes: Record<string, { oldValue?: unknown }> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        changes[key] = { oldValue: stored[key] };
        delete stored[key];
      }
      changed(area, changes);
      if (typeof callback === 'function') callback();
      return Promise.resolve();
    });
  }
  extensionApi.storage.sync.getBytesInUse.mockResolvedValue(0);
  extensionApi.storage.local.getBytesInUse.mockResolvedValue(0);
  extensionApi.storage.onChanged.addListener.mockImplementation((listener: Listener) =>
    storageListeners.push(listener),
  );
  extensionApi.storage.onChanged.removeListener.mockImplementation((listener: Listener) => {
    storageListeners = storageListeners.filter((candidate) => candidate !== listener);
  });
  extensionApi.runtime.getManifest.mockReturnValue({ version: '1.8.3' });
  extensionApi.runtime.sendMessage.mockImplementation(async (message: { type?: string }) => {
    if (message?.type === PANEL_MESSAGE.tabRequest) return { ok: true, response: undefined };
    if (message?.type === 'gv.openPopup' || message?.type === PANEL_MESSAGE.siteAccessFallback) {
      return { ok: true };
    }
    return undefined;
  });
  extensionApi.runtime.connect.mockImplementation(() => ({
    name: 'gv.panel.context',
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (listener: Listener) => portListeners.push(listener),
      removeListener: (listener: Listener) => {
        portListeners = portListeners.filter((candidate) => candidate !== listener);
      },
    },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  }));
  const { permissions } = extensionApi;
  permissions.contains.mockImplementation(async ({ origins }: { origins: string[] }) =>
    origins.every((origin) => granted.has(origin)),
  );
  permissions.request.mockImplementation(async ({ origins }: { origins: string[] }) => {
    for (const origin of origins) granted.add(origin);
    for (const listener of permissionListeners.added) listener();
    return true;
  });
  permissions.remove.mockImplementation(async ({ origins }: { origins: string[] }) => {
    for (const origin of origins) granted.delete(origin);
    for (const listener of permissionListeners.removed) listener();
    return true;
  });
  permissions.getAll.mockImplementation(async () => ({ origins: [...granted], permissions: [] }));
  permissions.onAdded.addListener.mockImplementation((listener: Listener) =>
    permissionListeners.added.push(listener),
  );
  permissions.onRemoved.addListener.mockImplementation((listener: Listener) =>
    permissionListeners.removed.push(listener),
  );
  extensionApi.scripting.getRegisteredContentScripts.mockResolvedValue([]);
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as PanelShellMessage);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.removeAttribute('data-gv-scheme');
  document.documentElement.removeAttribute('dir');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Opens the panel for a redeemed session, in a Voyager language. */
export async function mount(
  context: PanelContext = GEMINI,
  language: AppLanguage = 'en',
): Promise<void> {
  await setCachedLanguage(language);
  await act(async () => {
    root.render(
      <LanguageProvider initialLanguage={language}>
        <PanelApp session={sessionFor(context)} />
      </LanguageProvider>,
    );
    await flush();
  });
  await act(flush);
}

export const query = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector);
export const byId = (id: string) => document.getElementById(id);
/** A feature row's switch; feature ids contain dots, so look them up by id. */
export const rowSwitch = (pluginId: string) => byId(`panel-row-${pluginId}`) as HTMLButtonElement;
export const tab = (name: 'features' | 'sites') => byId(`panel-tab-${name}`) as HTMLButtonElement;
export const rowNames = () =>
  Array.from(container.querySelectorAll('[data-row] .rn')).map((name) => name.textContent);

export async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('Nothing to click');
  await act(async () => {
    (element as HTMLElement).click();
    await flush();
  });
}

export async function press(key: string, target: EventTarget = document.activeElement ?? window) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flush();
  });
}
