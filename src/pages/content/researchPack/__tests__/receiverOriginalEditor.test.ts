// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { HANDOFF_MESSAGES, type HandoffMessage } from '@/features/researchPack/services/handoff';

import { startResearchPackReceiver } from '../receiver';

let stop = () => {};
let stopSelectors = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<form><div id="prompt-textarea" contenteditable="true"></div></form>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 300,
    height: 30,
  } as DOMRect);
});
afterEach(() => {
  stop();
  stopSelectors();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('handoff editor ownership', () => {
  it.each([
    { remote: false, remounted: false },
    { remote: false, remounted: true },
    { remote: true, remounted: false },
    { remote: true, remounted: true },
  ])(
    'a remounted bundled editor receives its pack while remote claims keep their owner ($remote / $remounted)',
    async ({ remote, remounted }) => {
      if (remote) {
        const session = initializeSiteSelectors('chatgpt', {
          host: 'chatgpt.com',
          doc: document,
          lifetime: new AbortController().signal,
          bundledRevision: 0,
          read: async () => ({
            id: 'chatgpt',
            catalogRevision: 1,
            locators: { 'input.handoff': ['#prompt-textarea'] },
          }),
        });
        stopSelectors = session.stop;
        await session.ready;
      }
      let finish!: (value: unknown) => void;
      const claim = new Promise<unknown>((resolve) => {
        finish = resolve;
      });
      const send = async (message: HandoffMessage) =>
        message.type === HANDOFF_MESSAGES.peek ? { pending: true } : claim;
      const insert = vi.fn((text: string, editor: HTMLElement) => {
        editor.textContent = text;
        return true;
      });
      const original = document.getElementById('prompt-textarea')!;
      stop = startResearchPackReceiver({ send, insert, navigation: new EventTarget() });
      await vi.advanceTimersByTimeAsync(600);
      if (remounted) original.outerHTML = '<div id="prompt-textarea" contenteditable="true"></div>';
      finish({ ok: true, markdown: 'The claimed pack' });
      await vi.advanceTimersByTimeAsync(0);
      expect(document.getElementById('prompt-textarea')!.textContent).toBe(
        remote && remounted ? '' : 'The claimed pack',
      );
      expect(insert).toHaveBeenCalledTimes(remote && remounted ? 0 : 1);
      expect(original.textContent).toBe(remounted ? '' : 'The claimed pack');
    },
  );
});

it('an editor insertion error ends the handoff and releases navigation listeners', async () => {
  const navigation = new EventTarget();
  const added = vi.spyOn(navigation, 'addEventListener');
  const removed = vi.spyOn(navigation, 'removeEventListener');
  const insert = vi.fn(() => {
    throw new Error('host editor refused insertion');
  });
  stop = startResearchPackReceiver({
    navigation,
    insert,
    send: async (message) =>
      message.type === HANDOFF_MESSAGES.peek ? { pending: true } : { ok: true, markdown: 'pack' },
  });
  await vi.advanceTimersByTimeAsync(600);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(added.mock.calls.length).toBeGreaterThan(0);
  expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
  navigation.dispatchEvent(new Event('currententrychange'));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(insert).toHaveBeenCalledTimes(1);
});
