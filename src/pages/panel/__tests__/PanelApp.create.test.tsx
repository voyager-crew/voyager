// @vitest-environment jsdom
import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';
import { WRITE_PLUGIN_SKILL_URL } from '@/features/plugins/local/authoring/skillLink';

import { CREATE_REQUEST_ID } from '../create/CreateView';
import {
  GEMINI,
  byId,
  click,
  en,
  extensionApi,
  flush,
  mount,
  postedKinds,
  query,
  tab,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const field = () => byId(CREATE_REQUEST_ID) as HTMLTextAreaElement;
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) ?? null;
const closes = () => postedKinds().filter((kind) => kind === PANEL_SHELL_MESSAGE.close).length;

async function write(text: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(field(), text);
    field().dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

/** The page's answer to "Create on this page", through the relay. */
function pageAnswers(response: unknown): ReturnType<typeof vi.fn> {
  const requests = vi.fn();
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: unknown } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      const request = message.payload?.request as { type?: string } | undefined;
      if (request?.type !== 'gv.create.start') return { ok: true, response: undefined };
      requests(request);
      return { ok: true, response };
    },
  );
  return requests;
}

describe('the Create tab', () => {
  it('asks this page to open a new chat with the sentence, then gets out of the way', async () => {
    const requests = pageAnswers({ ok: true });
    await mount(GEMINI);
    await click(tab('create'));
    await write('  Round my messages  ');
    await click(button(en.panelCreateOnPage));

    expect(requests).toHaveBeenCalledWith({
      type: 'gv.create.start',
      request: 'Round my messages',
    });
    expect(closes()).toBe(1);
  });

  it('stays open and says why when the page has a draft in its composer', async () => {
    pageAnswers({ ok: false, reason: 'busy' });
    await mount(GEMINI);
    await click(tab('create'));
    await write('Round my messages');
    await click(button(en.panelCreateOnPage));

    expect(closes()).toBe(0);
    expect(query('[role="alert"]')?.textContent).toBe(en.createModeComposerBusy);
    expect(field().value).toBe('Round my messages');
  });

  it('says the page did not answer when nothing on it handled the request', async () => {
    pageAnswers(undefined);
    await mount(GEMINI);
    await click(tab('create'));
    await write('Round my messages');
    await click(button(en.panelCreateOnPage));

    expect(closes()).toBe(0);
    expect(query('[role="alert"]')?.textContent).toBe(en.panelCreateUnavailable);
  });

  it("copies a handoff for a local agent that names this page's site and the skill", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount(GEMINI);
    await click(tab('create'));
    await write('Round my messages');
    await click(button(en.createModeCopyForAgent));

    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain(WRITE_PLUGIN_SKILL_URL);
    expect(copied).toContain('Gemini');
    expect(copied).toContain('Round my messages');
    expect(button(en.localPluginDescribeCopied)).not.toBeNull();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('offers nothing to send on a website Create mode does not run on', async () => {
    const requests = pageAnswers({ ok: true });
    await mount({
      ...GEMINI,
      pageUrl: 'https://example.com/chat',
      siteId: null,
      accountSlot: null,
    });
    await click(tab('create'));

    expect(field().disabled).toBe(true);
    expect(button(en.panelCreateOnPage)?.hasAttribute('disabled')).toBe(true);
    await click(button(en.panelCreateOnPage));
    expect(requests).not.toHaveBeenCalled();
  });
});
