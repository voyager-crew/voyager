import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FormFactor } from '@/core/utils/formFactor';
import { readScriptedPlugin } from '@/features/plugins/scripted/state';

import { fakeUserScripts } from '../../../background/scriptedCreations/__tests__/fakeUserScripts';
import { LocalPluginsPanel } from '../LocalPluginsPanel';

vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: () => true }));
const device = vi.hoisted(() => ({ formFactor: 'desktop' as FormFactor }));
vi.mock('@/core/utils/formFactor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/utils/formFactor')>()),
  readPlatformFormFactor: async () => device.formFactor,
}));

const t = (key: string) => key;
const ID = 'local.me.counter';
const SOURCE = 'document.title = "sent: 0";';
const PLUGIN = {
  id: 'me.counter',
  name: 'Send counter',
  version: '1.0.0',
  description: 'Counts what I send',
  author: 'me',
  category: 'productivity',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'scripted',
  matches: ['https://gemini.google.com/*'],
  contributes: { script: { source: SOURCE } },
};

function button(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === text,
    ) ?? null
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 6; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(element: HTMLElement | null): Promise<void> {
  if (!element) throw new Error('nothing to click');
  await act(async () => element.click());
  await settle();
}

describe('creations that run code in My creations', () => {
  let container: HTMLDivElement;
  let root: Root;
  let memory: Record<string, unknown>;
  let listeners: ((changes: Record<string, unknown>, area: string) => void)[];

  const state = () =>
    memory[StorageKeys.PLUGIN_SCRIPTED_STATE] as
      | { stopped: boolean; enabled: Record<string, { reviewHash: string }> }
      | undefined;
  const text = (selector: string) => container.querySelector(selector)?.textContent ?? null;
  const hash = async () => (await readScriptedPlugin({ ...PLUGIN, id: ID }))!.reviewHash;

  async function installed(enabled: boolean, stopped = false): Promise<void> {
    memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
      [ID]: { manifest: { ...PLUGIN, id: ID }, importedAt: 1, updatedAt: 1 },
    };
    memory[StorageKeys.PLUGIN_SCRIPTED_STATE] = {
      version: 1,
      stopped,
      enabled: enabled ? { [ID]: { reviewHash: await hash(), enabledAt: 1 } } : {},
      crashNotices: {},
    };
  }

  async function render(): Promise<void> {
    await act(async () => root.render(<LocalPluginsPanel t={t} />));
    await settle();
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    memory = {};
    listeners = [];
    (chrome.storage.local.get as unknown as Mock).mockImplementation(
      async (keys: string | Record<string, unknown>) => {
        const defaults = typeof keys === 'string' ? { [keys]: undefined } : keys;
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
    (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (chrome as { userScripts?: unknown }).userScripts;
    device.formFactor = 'desktop';
    (chrome.storage.local.get as unknown as Mock).mockReset();
    (chrome.storage.local.set as unknown as Mock).mockReset();
    (chrome.storage.onChanged.addListener as unknown as Mock).mockReset();
    (chrome.runtime.sendMessage as unknown as Mock).mockReset();
  });

  it('reviews a pasted reply with its source and warning, then turns on exactly that', async () => {
    await render();
    const field = container.querySelector(
      '[data-testid="local-plugin-reply"] textarea',
    ) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        field,
        JSON.stringify(PLUGIN),
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(container, 'localPluginDescribeCheck'));

    const preview = container.querySelector('[data-testid="local-plugin-preview"]');
    expect(preview?.querySelector('[data-testid="scripted-source"]')?.textContent).toBe(SOURCE);
    expect(preview?.querySelector('[data-testid="scripted-warning"]')?.textContent).toContain(
      'scriptedWarning',
    );
    expect(preview?.textContent).not.toContain('localPluginInspectNoCode');

    await click(button(container, 'scriptedInstallAndTurnOn'));
    expect(state()?.enabled[ID]?.reviewHash).toBe(await hash());
    expect(text('[data-testid="scripted-state"]')).toBe(
      'scriptedStatePaused: scriptedPausedUserScriptsOff',
    );
  });

  it('keeps a creation the toggle blocks, paused with the reason and the setup steps', async () => {
    await installed(true);
    await render();
    expect(text('[data-testid="scripted-state"]')).toBe(
      'scriptedStatePaused: scriptedPausedUserScriptsOff',
    );
    expect(text('[data-testid="scripted-setup"]')).toContain('scriptedSetupStepAllow');
    expect(memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS]).toHaveProperty(ID);
    expect(state()?.enabled[ID]).toBeDefined();
  });

  it('keeps a creation this browser cannot run, paused, and says what to ask the AI for', async () => {
    device.formFactor = 'mobile';
    await installed(true);
    await render();
    expect(text('[data-testid="scripted-state"]')).toBe(
      'scriptedStatePaused: scriptedPausedUnsupported',
    );
    expect(text('[data-testid="scripted-unsupported"]')).toContain('scriptedUnsupportedHint');
    expect(memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS]).toHaveProperty(ID);
  });

  it('shows a running creation as on for this device, and turns it off', async () => {
    (chrome as { userScripts?: unknown }).userScripts = fakeUserScripts().api;
    await installed(true);
    await render();
    expect(text('[data-testid="scripted-state"]')).toBe('scriptedStateOn');
    expect(container.querySelector('[data-testid="scripted-setup"]')).toBeNull();

    await click(button(container, 'scriptedTurnOff'));
    expect(state()?.enabled[ID]).toBeUndefined();
    expect(text('[data-testid="scripted-state"]')).toBe('scriptedStateOff');
  });

  it('turns an off creation on only from its review', async () => {
    (chrome as { userScripts?: unknown }).userScripts = fakeUserScripts().api;
    await installed(false);
    await render();
    expect(button(container, 'scriptedTurnOn')).toBeNull();

    await click(button(container, 'scriptedReviewAndTurnOn'));
    const row = container.querySelector('[data-testid="scripted-row"]');
    expect(row?.querySelector('[data-testid="scripted-source"]')?.textContent).toBe(SOURCE);
    await click(button(container, 'scriptedTurnOn'));
    expect(state()?.enabled[ID]?.reviewHash).toBe(await hash());
    expect(text('[data-testid="scripted-state"]')).toBe('scriptedStateOn');
  });

  it('stops every creation that runs code, then resumes them', async () => {
    const fake = fakeUserScripts();
    (chrome as { userScripts?: unknown }).userScripts = fake.api;
    await installed(true);
    await render();
    expect([...fake.scripts.keys()]).toEqual([ID]);

    await click(button(container, 'scriptedStopAll'));
    expect(state()?.stopped).toBe(true);
    expect([...fake.scripts.keys()]).toEqual([]);
    expect(text('[data-testid="scripted-stopped"]')).toContain('scriptedStoppedReload');
    expect(text('[data-testid="scripted-state"]')).toBe(
      'scriptedStatePaused: scriptedPausedStopped',
    );

    await click(button(container, 'scriptedResume'));
    expect(state()?.stopped).toBe(false);
    expect([...fake.scripts.keys()]).toEqual([ID]);
    expect(text('[data-testid="scripted-state"]')).toBe('scriptedStateOn');
  });
});
