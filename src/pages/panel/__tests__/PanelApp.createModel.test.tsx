// @vitest-environment jsdom
import { act } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';

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
  tab,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const FLASH = { model: 'Flash', thinking: null, suggested: 'Argon' };
const field = () => byId(CREATE_REQUEST_ID) as HTMLTextAreaElement;
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) ?? null;
const notice = () => document.querySelector('[role="note"]');
const closes = () => postedKinds().filter((kind) => kind === PANEL_SHELL_MESSAGE.close).length;
const title = (model: string) =>
  en.panelCreateWeakModel.replace('{site}', 'Gemini').replace('{model}', model);

async function write(text: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(field(), text);
    field().dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

/** The page's answers through the relay: the model warning it reads now, and the start request. */
let modelReply: () => unknown;
const starts = vi.fn();

beforeEach(() => {
  starts.mockClear();
  modelReply = () => ({ warning: null });
  extensionApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: { request?: unknown } }) => {
      if (message?.type !== PANEL_MESSAGE.tabRequest) return undefined;
      const request = message.payload?.request as { type?: string } | undefined;
      if (request?.type === 'gv.create.model') return { ok: true, response: modelReply() };
      if (request?.type === 'gv.create.start') {
        starts(request);
        return { ok: true, response: { ok: true } };
      }
      return { ok: true, response: undefined };
    },
  );
});

describe('the Create tab on a chat model that usually cannot write a plugin', () => {
  it('warns as the tab opens, with both ways out, and still sends when asked', async () => {
    modelReply = () => ({ warning: FLASH });
    await mount(GEMINI);
    await click(tab('create'));

    expect(notice()?.textContent).toContain(title('Flash'));
    expect(notice()?.textContent).toContain('Argon');
    expect(notice()?.querySelectorAll('button')).toHaveLength(2);
    expect(button(en.createModeCopyForAgent)?.closest('[role="note"]')).toBe(notice());

    await write('Round my messages');
    await click(button(en.panelCreateOnPage));
    expect(starts).toHaveBeenCalledTimes(1);
    expect(closes()).toBe(1);
  });

  it('names the thinking level only when the page said it', async () => {
    modelReply = () => ({ warning: { ...FLASH, thinking: 'Low' } });
    await mount(GEMINI);
    await click(tab('create'));

    expect(notice()?.textContent).toContain(
      en.panelCreateWeakModelThinking
        .replace('{site}', 'Gemini')
        .replace('{model}', 'Flash')
        .replace('{thinking}', 'Low'),
    );
  });

  it.each([
    ['a stronger model', () => ({ warning: null })],
    ['a page that cannot read its model', () => undefined],
    [
      'a page that does not answer',
      () => {
        throw new Error('no content script');
      },
    ],
  ])('shows nothing for %s', async (_label, reply) => {
    modelReply = reply;
    await mount(GEMINI);
    await click(tab('create'));

    expect(notice()).toBeNull();
    expect(button(en.createModeCopyForAgent)).not.toBeNull();
  });

  it('holds a send once when the model became weak after the tab opened', async () => {
    await mount(GEMINI);
    await click(tab('create'));
    await write('Round my messages');
    expect(notice()).toBeNull();

    modelReply = () => ({ warning: FLASH });
    await click(button(en.panelCreateOnPage));
    expect(starts).not.toHaveBeenCalled();
    expect(notice()?.textContent).toContain(title('Flash'));

    await click(button(en.panelCreateOnPage));
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('clears the warning when the user switched models and checks again', async () => {
    modelReply = () => ({ warning: FLASH });
    await mount(GEMINI);
    await click(tab('create'));
    expect(notice()).not.toBeNull();

    modelReply = () => ({ warning: null });
    await click(button(en.panelCreateCheckModel));
    expect(notice()).toBeNull();
  });
});
