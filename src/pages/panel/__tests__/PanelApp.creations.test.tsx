import { act } from 'react';

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE } from '@/features/panel/protocol';
import { importLocalPlugin } from '@/features/plugins/local/localPluginImport';
import { SCRIPTED_RELOAD_PAGE_REQUEST } from '@/features/plugins/scripted/messages';
import { readScriptedPlugin } from '@/features/plugins/scripted/state';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { fakeUserScripts } from '../../background/scriptedCreations/__tests__/fakeUserScripts';
import { type PanelGroup, featureColumns } from '../features/featureRows';
import {
  CLAUDE,
  GEMINI,
  click,
  container,
  en,
  extensionApi,
  flush,
  local,
  mount,
  query,
  rowSwitch,
  tab,
  writeElsewhere,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: () => true }));

const BASE = {
  version: '1.0.0',
  description: 'd',
  author: 'me',
  license: 'MIT',
  engine: '>=1.0.0',
};
/** Its author filed it under layout, an official topic. */
const RESTYLE = {
  ...BASE,
  id: 'me.narrow',
  name: 'Narrow column',
  category: 'layout',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*', 'https://claude.ai/*'],
  contributes: { styles: [{ css: '.gv-narrow{max-width:640px}' }] },
};
const CODE_ID = 'local.me.counter';
const SOURCE = 'const note = document.createElement("div");\nnote.className = "gv-counter";';
const CODE = {
  ...BASE,
  id: 'me.counter',
  name: 'Send counter',
  category: 'productivity',
  tier: 'scripted',
  matches: ['https://gemini.google.com/*'],
  contributes: { script: { source: SOURCE } },
};
const CREATIONS = 'creations';

const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) ?? null;
const groupOf = (rowId: string) =>
  container
    .querySelector(`[data-row="${rowId}"]`)
    ?.closest('[data-group]')
    ?.getAttribute('data-group');
const rowsIn = (groupId: string) =>
  Array.from(container.querySelectorAll(`[data-group="${groupId}"] [data-row]`)).map((row) =>
    row.getAttribute('data-row'),
  );
const stateOf = (rowId: string) =>
  container.querySelector(`[data-row="${rowId}"] [data-testid="scripted-state"]`)?.textContent;
const scriptedState = () =>
  local[StorageKeys.PLUGIN_SCRIPTED_STATE] as
    | { stopped: boolean; enabled: Record<string, { reviewHash: string }> }
    | undefined;
const pluginsState = () =>
  local[StorageKeys.PLUGINS_STATE] as Record<string, { enabled?: boolean }> | undefined;
const hashOf = async (raw: Record<string, unknown>) =>
  (await readScriptedPlugin({ ...raw, id: CODE_ID }))!.reviewHash;

/** Status refreshes after each storage write run several reads and a registrar pass. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 4; round += 1) await flush();
  });
}

async function install(raw: Record<string, unknown>): Promise<void> {
  expect((await importLocalPlugin(raw)).ok).toBe(true);
}

/** A creation that runs code, turned on after a review of `reviewed`. */
async function turnedOnAfterReviewOf(reviewed: Record<string, unknown>): Promise<void> {
  local[StorageKeys.PLUGIN_SCRIPTED_STATE] = {
    version: 1,
    stopped: false,
    enabled: { [CODE_ID]: { reviewHash: await hashOf(reviewed), enabledAt: 1 } },
    crashNotices: {},
  };
}

const tabRequests: unknown[] = [];
function recordTabRequests(): void {
  tabRequests.length = 0;
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: unknown } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      tabRequests.push(message.payload?.request);
      return { ok: true, response: undefined };
    },
  );
}

afterEach(() => {
  delete (extensionApi as { userScripts?: unknown }).userScripts;
});

describe('My creations in the Features tab', () => {
  it('holds every creation for this site, whatever category it claims, and nothing official', async () => {
    await install(RESTYLE);
    await install(CODE);
    await mount();

    const label = query(`[data-group="${CREATIONS}"] .gl`);
    expect(label?.textContent).toBe(en.localPluginsTitle);
    expect(rowsIn(CREATIONS).sort()).toEqual([CODE_ID, 'local.me.narrow']);
    expect(groupOf(OFFICIAL_PLUGIN_IDS.geminiChatWidth)).toBe('pluginsLayout');
    // Nothing local in an official group, nothing official in My creations.
    for (const id of Array.from(container.querySelectorAll('[data-row]'), (row) =>
      row.getAttribute('data-row')!,
    )) {
      expect(groupOf(id) === CREATIONS).toBe(id.startsWith('local.'));
    }
    expect(query(`[data-row="${CODE_ID}"] [data-testid="scripted-badge"]`)?.textContent).toBe(
      en.scriptedBadge,
    );
    expect(query('[data-row="local.me.narrow"] [data-testid="scripted-badge"]')).toBeNull();
  });

  it('takes in a creation installed while the panel is open', async () => {
    await mount();
    expect(query(`[data-group="${CREATIONS}"]`)).toBeNull();

    await writeElsewhere('local', {
      [StorageKeys.PLUGIN_LOCAL_MANIFESTS]: {
        'local.me.narrow': {
          manifest: { ...RESTYLE, id: 'local.me.narrow' },
          importedAt: 1,
          updatedAt: 1,
        },
      },
    });

    expect(groupOf('local.me.narrow')).toBe(CREATIONS);
  });

  it('shows no group on a site none of them is for', async () => {
    await install(CODE);
    await mount(CLAUDE);
    expect(query(`[data-group="${CREATIONS}"]`)).toBeNull();
    expect(query(`[data-row="${CODE_ID}"]`)).toBeNull();
  });

  it('search finds a creation by its name', async () => {
    await install(RESTYLE);
    await install(CODE);
    await mount();
    await click(query('.search button'));
    const field = query<HTMLInputElement>('.search input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(field, 'counter');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });

    expect(
      Array.from(container.querySelectorAll('[data-row]'), (row) => row.getAttribute('data-row')),
    ).toEqual([CODE_ID]);
  });

  it('never moves an official group to the other column when creations come or go', () => {
    const group = (id: string, rows: number) =>
      ({ id, label: id, rows: Array.from({ length: rows }, () => ({})) }) as unknown as PanelGroup;
    const official = [group('entry', 1), group('pluginsLayout', 6), group('pluginsSidebar', 4)];
    const ids = (column: PanelGroup[]) => column.map((entry) => entry.id);
    const [start, end] = featureColumns(official);

    for (const count of [1, 3, 12]) {
      const [withStart, withEnd] = featureColumns([...official, group(CREATIONS, count)]);
      expect(ids(withStart)).toEqual([CREATIONS, ...ids(start)]);
      expect(ids(withEnd)).toEqual(ids(end));
    }
  });
});

describe('a creation that only restyles', () => {
  it('turns on through the same site-access path as the popup', async () => {
    await install(RESTYLE);
    await mount(CLAUDE);
    await click(rowSwitch('local.me.narrow'));

    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ['https://claude.ai/*'],
    });
    expect(pluginsState()?.['local.me.narrow']?.enabled).toBe(true);
    expect(rowSwitch('local.me.narrow').getAttribute('aria-checked')).toBe('true');
  });

  it('stays off when the browser refuses the site access', async () => {
    await install(RESTYLE);
    extensionApi.permissions.request.mockResolvedValueOnce(false);
    await mount(CLAUDE);
    await click(rowSwitch('local.me.narrow'));

    expect(pluginsState()?.['local.me.narrow']?.enabled).not.toBe(true);
    expect(rowSwitch('local.me.narrow').getAttribute('aria-checked')).toBe('false');
  });

  it('is removed only after the user confirms', async () => {
    await install(RESTYLE);
    await mount();
    await click(query(`[aria-label="Remove Narrow column"]`));
    const manifests = () => local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<string, unknown>;
    expect(manifests()['local.me.narrow']).toBeDefined();

    await click(button(en.localPluginsRemove));
    expect(manifests()['local.me.narrow']).toBeUndefined();
    expect(query(`[data-group="${CREATIONS}"]`)).toBeNull();
  });
});

describe('a creation that runs code', () => {
  it('has no switch until its code is reviewed, then turns on bound to the code shown', async () => {
    await install(CODE);
    await mount();

    expect(stateOf(CODE_ID)).toBe(en.scriptedStateOff);
    expect(rowSwitch(CODE_ID)).toBeNull();
    expect(button(en.scriptedTurnOn)).toBeNull();

    await click(button(en.scriptedReviewAndTurnOn));
    expect(query('[data-testid="scripted-source"]')?.textContent).toBe(SOURCE);
    expect(query('[data-testid="scripted-warning"]')?.textContent).toContain('Gemini');

    await click(button(en.scriptedTurnOn));
    await settle();
    expect(scriptedState()?.enabled[CODE_ID]?.reviewHash).toBe(await hashOf(CODE));
    expect(pluginsState()?.[CODE_ID]?.enabled).not.toBe(true);
    expect(rowSwitch(CODE_ID)?.getAttribute('aria-checked')).toBe('true');

    await click(rowSwitch(CODE_ID));
    await settle();
    expect(scriptedState()?.enabled[CODE_ID]).toBeUndefined();
  });

  it('pauses with the popup’s reason once its code changed, and turns on only the code reviewed now', async () => {
    const changed = 'document.title = "changed";';
    await install(CODE);
    await turnedOnAfterReviewOf(CODE);
    const records = local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<
      string,
      { manifest: { contributes: { script: { source: string } } } }
    >;
    records[CODE_ID].manifest.contributes.script.source = changed;
    await mount();
    await settle();

    expect(stateOf(CODE_ID)).toBe(`${en.scriptedStatePaused}: ${en.scriptedPausedReview}`);
    expect(rowSwitch(CODE_ID)).toBeNull();

    await click(button(en.scriptedReviewAndTurnOn));
    expect(query('[data-testid="scripted-source"]')?.textContent).toBe(changed);
    await click(button(en.scriptedTurnOn));
    await settle();
    const reviewed = { ...CODE, contributes: { script: { source: changed } } };
    expect(scriptedState()?.enabled[CODE_ID]?.reviewHash).toBe(await hashOf(reviewed));
  });
});

describe('stopping every creation that runs code', () => {
  it('lives in My creations: stops, offers a reload, and resumes, as in the popup', async () => {
    const fake = fakeUserScripts();
    (extensionApi as { userScripts?: unknown }).userScripts = fake.api;
    await install(CODE);
    await turnedOnAfterReviewOf(CODE);
    recordTabRequests();
    await mount(GEMINI);
    await settle();
    expect([...fake.scripts.keys()]).toEqual([CODE_ID]);
    expect(stateOf(CODE_ID)).toBe(en.scriptedStateOn);

    await click(button(en.scriptedStopAll));
    await settle();
    expect(scriptedState()?.stopped).toBe(true);
    expect(scriptedState()?.enabled[CODE_ID]).toBeDefined();
    expect([...fake.scripts.keys()]).toEqual([]);
    expect(stateOf(CODE_ID)).toBe(`${en.scriptedStatePaused}: ${en.scriptedPausedStopped}`);
    expect(query('[data-testid="scripted-stopped"]')?.textContent).toContain(
      en.scriptedStoppedReload,
    );

    await click(button(en.scriptedReloadPage));
    expect(tabRequests).toContainEqual({ type: SCRIPTED_RELOAD_PAGE_REQUEST });

    await click(button(en.scriptedResume));
    await settle();
    expect(scriptedState()?.stopped).toBe(false);
    expect([...fake.scripts.keys()]).toEqual([CODE_ID]);

    await click(tab('create'));
    expect(button(en.scriptedStopAll)).toBeNull();
  });

  it('is not offered beside creations that only restyle', async () => {
    await install(RESTYLE);
    await mount();
    expect(rowsIn(CREATIONS)).toEqual(['local.me.narrow']);
    expect(button(en.scriptedStopAll)).toBeNull();
  });
});
