import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { type Mock, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { LocalPluginsPanel } from '../LocalPluginsPanel';

const t = (key: string) => key;

function authored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'me.wide-chat',
    name: 'Wide chat',
    version: '1.0.0',
    description: 'Widen the Claude chat column',
    author: 'Me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://claude.ai/*'],
    contributes: {
      styles: [{ css: '.gv-wide{max-width:none}' }],
      domOps: [{ op: 'addClass', target: 'body', className: 'gv-wide' }],
    },
    ...overrides,
  };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function setTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LocalPluginsPanel import flow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let memory: Record<string, unknown>;
  let listeners: ((changes: Record<string, unknown>, area: string) => void)[];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    memory = {};
    listeners = [];
    (chrome.storage.local.get as unknown as Mock).mockImplementation(
      async (defaults: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [key, fallback] of Object.entries(defaults)) {
          out[key] = key in memory ? structuredClone(memory[key]) : fallback;
        }
        return out;
      },
    );
    (chrome.storage.local.set as unknown as Mock).mockImplementation(
      async (items: Record<string, unknown>) => {
        Object.assign(memory, structuredClone(items));
        const changes = Object.fromEntries(
          Object.entries(items).map(([key, newValue]) => [key, { newValue }]),
        );
        for (const listener of listeners) listener(changes, 'local');
      },
    );
    (chrome.storage.onChanged.addListener as unknown as Mock).mockImplementation(
      (listener: (changes: Record<string, unknown>, area: string) => void) => {
        listeners.push(listener);
      },
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (chrome.storage.local.get as unknown as Mock).mockReset();
    (chrome.storage.local.set as unknown as Mock).mockReset();
    (chrome.storage.onChanged.addListener as unknown as Mock).mockReset();
  });

  async function pasteAndImport(manifest: Record<string, unknown>): Promise<void> {
    const textarea = container.querySelector(
      'textarea[aria-label="localPluginsPasteLabel"]',
    ) as HTMLTextAreaElement;
    await act(async () => setTextarea(textarea, JSON.stringify(manifest)));
    await act(async () => button(container, 'localPluginsCheckAndImport').click());
    await flush();
  }

  it('imports disabled, shows the inspection, keeps the old version on a bad re-import, then removes', async () => {
    await act(async () => root.render(<LocalPluginsPanel t={t} />));
    await flush();
    expect(container.textContent).toContain('localPluginsEmpty');

    await act(async () => button(container, 'createModeMoreWays').click());
    await act(async () => button(container, 'localPluginsPasteJson').click());
    await pasteAndImport(authored());

    // Imported, disabled, and inspected before the user turns it on.
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'localPluginsImported',
    );
    const inspection = container.querySelector('[data-testid="local-plugin-inspection"]');
    expect(inspection?.textContent).toContain('https://claude.ai/*');
    expect(inspection?.textContent).toContain('addClass gv-wide → body');
    const state = memory[StorageKeys.PLUGINS_STATE] as Record<string, { enabled: boolean }>;
    expect(state['local.me.wide-chat'].enabled).toBe(false);
    expect(container.textContent).toContain('local.me.wide-chat · v1.0.0');

    // A re-import that fails validation lists path + message and keeps 1.0.0.
    await pasteAndImport(
      authored({
        version: '2.0.0',
        contributes: { styles: [{ css: 'body{background:url(https://t.example/p.gif)}' }] },
      }),
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('localPluginsRejected');
    expect(alert?.textContent).toContain('contributes.styles[0].css: ');
    expect(alert?.textContent).toContain('localPluginsPreviousKept');
    const stored = memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<
      string,
      { manifest: { version: string } }
    >;
    expect(stored['local.me.wide-chat'].manifest.version).toBe('1.0.0');
    expect(container.textContent).toContain('local.me.wide-chat · v1.0.0');

    // Remove takes a confirming second click and clears the plugin's state too.
    const remove = container.querySelector(
      'button[aria-label="localPluginsRemove Wide chat"]',
    ) as HTMLButtonElement;
    await act(async () => remove.click());
    await act(async () => button(container, 'localPluginsConfirmRemove').click());
    await flush();
    expect(container.textContent).toContain('localPluginsEmpty');
    expect(memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS]).toEqual({});
    expect(memory[StorageKeys.PLUGINS_STATE]).not.toHaveProperty('local.me.wide-chat');
  });
});
