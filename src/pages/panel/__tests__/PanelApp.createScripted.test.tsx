import { act } from 'react';

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FormFactor } from '@/core/utils/formFactor';
import { PANEL_MESSAGE } from '@/features/panel/protocol';
import { importLocalPlugin } from '@/features/plugins/local/localPluginImport';
import { readScriptedPlugin } from '@/features/plugins/scripted/state';

import { fakeUserScripts } from '../../background/scriptedCreations/__tests__/fakeUserScripts';
import { GEMINI, click, en, extensionApi, flush, local, mount, query, tab } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: () => true }));
const device = vi.hoisted(() => ({ formFactor: 'desktop' as FormFactor }));
vi.mock('@/core/utils/formFactor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/utils/formFactor')>()),
  readPlatformFormFactor: async () => device.formFactor,
}));

const ID = 'local.me.counter';
const SOURCE = 'const note = document.createElement("div");\nnote.className = "gv-counter";';
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
const reply = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...PLUGIN, ...patch });

const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) ?? null;
const scriptedState = () =>
  local[StorageKeys.PLUGIN_SCRIPTED_STATE] as
    | { stopped: boolean; enabled: Record<string, { reviewHash: string }> }
    | undefined;
const storedManifest = () =>
  (
    local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<string, { manifest: unknown }> | undefined
  )?.[ID]?.manifest;
const review = () => query('[data-testid="create-review"]');
const tabRequests: unknown[] = [];

function pageHolds(text: string | null): void {
  let held = text;
  tabRequests.length = 0;
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: { type?: string } } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      tabRequests.push(message.payload?.request);
      if (message.payload?.request?.type !== 'gv.create.pending')
        return { ok: true, response: undefined };
      const candidate = held ? { text: held, siteId: 'gemini' } : null;
      held = null;
      return { ok: true, response: { candidate } };
    },
  );
}

function allowUserScripts() {
  const fake = fakeUserScripts();
  (extensionApi as { userScripts?: unknown }).userScripts = fake.api;
  return fake;
}

/** Status refreshes after each storage write run several reads and a registrar pass. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 4; round += 1) await flush();
  });
}

async function hashOf(raw: Record<string, unknown>): Promise<string> {
  return (await readScriptedPlugin({ ...raw, id: ID }))!.reviewHash;
}

afterEach(() => {
  delete (extensionApi as { userScripts?: unknown }).userScripts;
  device.formFactor = 'desktop';
});

describe('reviewing a reply that runs code', () => {
  it('shows the badge, the warning and the full source, then turns on exactly what was reviewed', async () => {
    pageHolds(reply());
    await mount({ ...GEMINI, creationRequest: 1 });

    expect(tab('create').getAttribute('aria-selected')).toBe('true');
    expect(query('[data-testid="scripted-badge"]')?.textContent).toBe(en.scriptedBadge);
    expect(query('[data-testid="scripted-source"]')?.textContent).toBe(SOURCE);
    expect(query('[data-testid="scripted-source"]')?.getAttribute('dir')).toBe('ltr');
    expect(query('[data-testid="scripted-warning"]')?.textContent).toContain('Gemini');
    // Only the source body folds: the badge and the warning stay on screen while it is closed.
    const fold = query('[data-testid="scripted-source"]')?.closest('details');
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector('summary')?.textContent).toBe(en.scriptedSourceLabel);
    expect(query('[data-testid="scripted-badge"]')?.closest('details')).toBeNull();
    expect(query('[data-testid="scripted-warning"]')?.closest('details')).toBeNull();

    await click(button(en.panelCreateInstall));
    expect(storedManifest()).toMatchObject({ id: ID, tier: 'scripted' });
    expect(scriptedState()?.enabled[ID]?.reviewHash).toBe(await hashOf(PLUGIN));
    const declarative = local[StorageKeys.PLUGINS_STATE] as Record<string, { enabled?: boolean }>;
    expect(declarative[ID]?.enabled).not.toBe(true);
    expect(review()?.textContent).toContain('Send counter is on.');
    expect(review()?.textContent).toContain('It’s in Features, under My creations.');
  });

  it('turns nothing on when the install changed after the review, then reviews the reply again', async () => {
    pageHolds(reply());
    await mount({ ...GEMINI, creationRequest: 1 });
    const changed = 'document.title = "changed";';
    expect(
      (await importLocalPlugin({ ...PLUGIN, contributes: { script: { source: changed } } })).ok,
    ).toBe(true);

    await click(button(en.panelCreateInstall));
    expect(scriptedState()?.enabled?.[ID]).toBeUndefined();
    expect(review()?.textContent).toContain(en.localPluginChangedSinceReview);
    expect(query('[data-testid="scripted-source"]')?.textContent).toBe(SOURCE);

    await click(button(en.panelCreateUpdate));
    expect(scriptedState()?.enabled[ID]?.reviewHash).toBe(await hashOf(PLUGIN));
  });
});

describe('when this browser cannot run it yet', () => {
  it('walks through the toggle, shows the address when opening fails, and registers from this page', async () => {
    pageHolds(reply());
    await mount({ ...GEMINI, creationRequest: 1 });
    expect(query('[data-testid="scripted-setup"]')?.textContent).toContain(
      en.scriptedSetupStepAllow,
    );

    await click(button(en.scriptedSetupOpen));
    expect(query('[data-testid="scripted-details-address"]')?.textContent).toBe(
      'chrome://extensions/?id=test-extension-id',
    );

    await click(button(en.panelCreateInstall));
    expect(storedManifest()).toBeDefined();
    const fake = allowUserScripts();
    await click(button(en.scriptedSetupDone));
    await settle();
    expect(query('[data-testid="scripted-setup"]')).toBeNull();
    expect([...fake.scripts.keys()]).toEqual([ID]);
    expect(fake.worlds.get(`gv-${ID}`)).toMatchObject({ messaging: false });
  });

  it('says this browser cannot run it and offers no install on a phone', async () => {
    device.formFactor = 'mobile';
    pageHolds(reply());
    await mount({ ...GEMINI, creationRequest: 1 });
    const card = query('[data-testid="scripted-unsupported"]');
    expect(card?.textContent).toContain(en.scriptedUnsupported);
    expect(card?.textContent).toContain(en.scriptedUnsupportedHint);
    expect(button(en.panelCreateInstall)).toBeNull();
  });
});
