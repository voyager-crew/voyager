import { act } from 'react';

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';
import { importLocalPlugin } from '@/features/plugins/local/localPluginImport';

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
  postedKinds,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: () => true }));

const ID = 'local.me.narrow';
const RESTYLE = {
  id: 'me.narrow',
  name: 'Narrow column',
  version: '1.0.0',
  description: 'd',
  author: 'me',
  category: 'layout',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*', 'https://claude.ai/*'],
  contributes: { styles: [{ css: '.gv-narrow{max-width:640px}' }] },
};
const CODE_ID = 'local.me.counter';
const CODE = {
  ...RESTYLE,
  id: 'me.counter',
  name: 'Send counter',
  tier: 'scripted',
  matches: ['https://gemini.google.com/*'],
  contributes: { script: { source: 'document.title = "x";' } },
};

const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) ?? null;
const rowText = (id: string) => container.querySelector(`[data-row="${id}"]`)?.textContent ?? '';

async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 4; round += 1) await flush();
  });
}

/** The page: it runs the creation, and answers the check with `check` (or fails to). */
function page(check: unknown): unknown[] {
  const requests: unknown[] = [];
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: { type?: string } } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      const request = message.payload?.request;
      requests.push(request);
      switch (request?.type) {
        case 'gv.plugins.status':
          return {
            ok: true,
            response: { ok: true, statuses: [{ id: ID, version: '1.0.0', kind: 'mounted' }] },
          };
        case 'gv.create.check':
          return check === null
            ? { ok: false, error: 'no_receiver' }
            : { ok: true, response: check };
        case 'gv.create.fix':
          return { ok: true, response: { ok: true } };
        default:
          return { ok: true, response: undefined };
      }
    },
  );
  return requests;
}

async function installedAndOn(): Promise<void> {
  expect((await importLocalPlugin(RESTYLE)).ok).toBe(true);
  local[StorageKeys.PLUGINS_STATE] = { [ID]: { enabled: true } };
}

describe('a creation that is on but does nothing on this page', () => {
  it('says so and asks the AI to fix it in a new chat, filled and not sent', async () => {
    await installedAndOn();
    const requests = page({ checks: [{ id: ID, version: '1.0.0', verdict: 'nothing' }] });
    await mount(GEMINI);
    await settle();

    expect(rowText(ID)).toContain(en.panelCreationNothingMatches);
    await click(button(en.panelCreationAskFix));
    expect(requests).toContainEqual({
      type: 'gv.create.fix',
      id: ID,
      problem: 'nothing-matches',
      structure: true,
    });
    expect(postedKinds()).toContain(PANEL_SHELL_MESSAGE.close);
  });

  it('says nothing when the page matched it', async () => {
    await installedAndOn();
    page({ checks: [{ id: ID, version: '1.0.0', verdict: 'matches' }] });
    await mount(GEMINI);
    await settle();

    expect(rowText(ID)).not.toContain(en.panelCreationNothingMatches);
    expect(button(en.panelCreationAskFix)).toBeNull();
  });

  it('ignores a verdict about another version than the one running', async () => {
    await installedAndOn();
    page({ checks: [{ id: ID, version: '0.9.0', verdict: 'nothing' }] });
    await mount(GEMINI);
    await settle();

    expect(rowText(ID)).not.toContain(en.panelCreationNothingMatches);
  });

  it('raises no alarm when the page cannot be checked', async () => {
    await installedAndOn();
    const requests = page(null);
    await mount(GEMINI);
    await settle();

    expect(requests).toContainEqual({ type: 'gv.create.check' });
    expect(rowText(ID)).not.toContain(en.panelCreationNothingMatches);
    expect(button(en.panelCreationAskFix)).toBeNull();
  });

  it('keeps the page’s verdict off a site the panel only views', async () => {
    await installedAndOn();
    page({ checks: [{ id: ID, version: '1.0.0', verdict: 'nothing' }] });
    await mount(CLAUDE);
    await settle();
    expect(rowText(ID)).toContain(en.panelCreationNothingMatches);

    await click(container.querySelector('.siteBtn'));
    const gemini = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ).find((item) => item.textContent?.includes('Gemini'));
    await click(gemini ?? null);
    await settle();

    expect(rowText(ID)).toContain('Narrow column');
    expect(rowText(ID)).not.toContain(en.panelCreationNothingMatches);
    expect(button(en.panelCreationAskFix)).toBeNull();
  });
});

describe('a creation that runs code and froze a page', () => {
  it('offers to ask the AI for a fix next to its review', async () => {
    expect((await importLocalPlugin(CODE)).ok).toBe(true);
    local[StorageKeys.PLUGIN_SCRIPTED_STATE] = {
      version: 1,
      stopped: false,
      enabled: {},
      crashNotices: {
        [CODE_ID]: { at: 1, url: 'https://gemini.google.com/app', withIds: [CODE_ID] },
      },
    };
    const requests = page({ checks: [] });
    await mount(GEMINI);
    await settle();

    expect(rowText(CODE_ID)).toContain(en.scriptedPausedCrash);
    await click(button(en.panelCreationAskFix));
    expect(requests).toContainEqual({
      type: 'gv.create.fix',
      id: CODE_ID,
      problem: 'froze',
      structure: true,
    });
  });
});
