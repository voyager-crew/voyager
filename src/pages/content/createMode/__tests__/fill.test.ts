// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/u/1/app/0123456789abcdef" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createPageUrl } from '@/features/plugins/local/authoring/skillLink';
import { installNativeEditingMock } from '@/tests/nativeEditing';

import { FILL_CONFIRM_MS, FILL_POLL_MS, FILL_TIMEOUT_MS, startCreationFill } from '../fill';
import { FILL_STABLE_POLLS, type FillResult } from '../fillMachine';
import { startCreateMode } from '../index';
import { NEW_CHAT_TARGETS } from '../newChat';

const CHAT = '/u/1/app/0123456789abcdef';
const SETTLE_MS = FILL_POLL_MS * (FILL_STABLE_POLLS + 2);
const MESSAGE = 'Read the page, then write me a plugin.';

let restoreEditing = () => {};
let stop: (() => void) | null = null;

function page(): {
  composer: HTMLElement;
  sendClicked: ReturnType<typeof vi.fn>;
  enterPressed: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = `
    <bard-sidenav></bard-sidenav>
    <main>
      <rich-textarea><div class="ql-editor" contenteditable="true"><p><br></p></div></rich-textarea>
      <button class="send-button" aria-label="Send">Send</button>
    </main>`;
  const composer = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const sendClicked = vi.fn();
  const enterPressed = vi.fn();
  document.querySelector('.send-button')!.addEventListener('click', sendClicked);
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter') enterPressed();
    },
    { capture: true },
  );
  return { composer, sendClicked, enterPressed };
}

const composerText = (composer: HTMLElement) => composer.textContent ?? '';

describe('filling a new chat with the creation message', () => {
  let notify: ReturnType<typeof vi.fn<(result: FillResult) => void>>;
  let navigationErrors: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', CHAT);
    restoreEditing = installNativeEditingMock();
    notify = vi.fn();
    // jsdom reports a full page load as "Not implemented: navigation".
    navigationErrors = vi.fn();
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('navigation')) navigationErrors(...args);
    });
    (window as { gvSamePage?: boolean }).gvSamePage = true;
  });

  afterEach(() => {
    stop?.();
    stop = null;
    restoreEditing();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens a Gemini new chat in the same page, keeps the account and leaves send to the user', async () => {
    const { composer, sendClicked, enterPressed } = page();
    const pushState = vi.spyOn(history, 'pushState');
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.gemini,
      find: () => document.querySelector('[contenteditable="true"]'),
      notify,
    });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(location.pathname).toBe('/u/1/app');
    expect(pushState).toHaveBeenCalledWith({}, '', '/u/1/app');
    expect((window as { gvSamePage?: boolean }).gvSamePage).toBe(true);
    expect(navigationErrors).not.toHaveBeenCalled();
    expect(composerText(composer)).toBe(MESSAGE);
    expect(notify).toHaveBeenCalledWith('filled');
    expect(sendClicked).not.toHaveBeenCalled();
    expect(enterPressed).not.toHaveBeenCalled();
  });

  it("presses Gemini's own new-chat link before reaching for the History API", async () => {
    const { composer } = page();
    const link = document.createElement('a');
    link.setAttribute('data-test-id', 'new-chat-button');
    link.href = '/u/1/app';
    // Gemini's router takes the click and routes in place.
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.pushState({}, '', '/u/1/app');
    });
    document.querySelector('bard-sidenav')!.append(link);
    const pushState = vi.spyOn(history, 'pushState');
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.gemini,
      find: () => composer,
      notify,
    });
    await vi.advanceTimersByTimeAsync(FILL_CONFIRM_MS + SETTLE_MS);

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(composerText(composer)).toBe(MESSAGE);
    expect(navigationErrors).not.toHaveBeenCalled();
  });

  it('never writes into a composer that already holds text', async () => {
    const { composer } = page();
    history.replaceState({}, '', '/u/1/app');
    composer.innerHTML = '<p>my own draft</p>';
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.gemini,
      find: () => composer,
      notify,
    });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(composerText(composer)).toBe('my own draft');
    expect(notify).toHaveBeenCalledWith('busy');
  });

  it('writes nothing once the page left the new-chat page', async () => {
    history.replaceState({}, '', '/u/1/app');
    let composer: HTMLElement | null = null;
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.gemini,
      find: () => composer,
      notify,
    });
    await vi.advanceTimersByTimeAsync(FILL_POLL_MS);
    history.pushState({}, '', '/u/1/app/fedcba9876543210');
    composer = page().composer;
    await vi.advanceTimersByTimeAsync(FILL_TIMEOUT_MS);

    expect(composerText(composer)).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it("never writes into another account's new chat the user switched to while it opened", async () => {
    const { composer } = page();
    // A new-chat link Gemini has not answered yet.
    const link = document.createElement('a');
    link.setAttribute('data-test-id', 'new-chat-button');
    link.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('bard-sidenav')!.append(link);
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.gemini,
      find: () => composer,
      notify,
    });
    history.pushState({}, '', '/u/2/app');
    await vi.advanceTimersByTimeAsync(FILL_CONFIRM_MS + SETTLE_MS);

    expect(location.pathname).toBe('/u/2/app');
    expect(composerText(composer)).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not move a user who opened another chat before the new chat arrived', async () => {
    const { composer } = page();
    const link = document.createElement('a');
    link.setAttribute('data-test-id', 'new-chat-button');
    link.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('bard-sidenav')!.append(link);
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.gemini,
      find: () => composer,
      notify,
    });
    history.pushState({}, '', '/u/1/app/fedcba9876543210');
    const pushState = vi.spyOn(history, 'pushState');
    await vi.advanceTimersByTimeAsync(FILL_CONFIRM_MS + SETTLE_MS);

    expect(location.pathname).toBe('/u/1/app/fedcba9876543210');
    expect(pushState).not.toHaveBeenCalled();
    expect(composerText(composer)).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it('stays on the page and says so where the site offers no way to a new chat', async () => {
    const { composer } = page();
    const pushState = vi.spyOn(history, 'pushState');
    stop = startCreationFill(MESSAGE, {
      target: NEW_CHAT_TARGETS.claude,
      find: () => composer,
      notify,
    });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(location.pathname).toBe(CHAT);
    expect(pushState).not.toHaveBeenCalled();
    expect(composerText(composer)).toBe('');
    expect(notify).toHaveBeenCalledWith('no-new-chat');
  });
});

describe('the panel asking this page to create', () => {
  let listener:
    | ((message: unknown, sender: unknown, reply: (value: unknown) => void) => void)
    | null;

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', CHAT);
    restoreEditing = installNativeEditingMock();
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((added) => {
      listener = added as typeof listener;
    });
  });

  afterEach(() => {
    stop?.();
    stop = null;
    listener = null;
    restoreEditing();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const ask = (message: unknown): unknown => {
    let reply: unknown;
    listener?.(message, {}, (value) => (reply = value));
    return reply;
  };

  it('refuses before leaving a chat whose composer holds a draft', async () => {
    const { composer } = page();
    composer.innerHTML = '<p>half a thought</p>';
    stop = startCreateMode({ find: () => composer });

    expect(ask({ type: 'gv.create.start', request: 'Round my messages' })).toEqual({
      ok: false,
      reason: 'busy',
    });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(location.pathname).toBe(CHAT);
    expect(composerText(composer)).toBe('half a thought');
  });

  it("fills the new chat with a message that links this site's create page and the request", async () => {
    const { composer, sendClicked } = page();
    stop = startCreateMode({ find: () => composer });

    expect(ask({ type: 'gv.create.start', request: '  Round my messages ' })).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(composerText(composer)).toContain(createPageUrl('gemini'));
    expect(composerText(composer)).toContain('Round my messages');
    expect(sendClicked).not.toHaveBeenCalled();
  });

  it('adds the structure of the page the request started on, read before the new chat replaced it', async () => {
    const { composer } = page();
    document.querySelector('main')!.prepend(document.createElement('user-query'));
    // The new chat takes the conversation off the page.
    window.addEventListener('popstate', () => document.querySelector('user-query')?.remove(), {
      once: true,
    });
    stop = startCreateMode({ find: () => composer });

    expect(ask({ type: 'gv.create.start', request: 'Round my messages', structure: true })).toEqual(
      { ok: true },
    );
    await vi.advanceTimersByTimeAsync(SETTLE_MS + FILL_CONFIRM_MS);
    expect(document.querySelector('user-query')).toBeNull();
    const text = composerText(composer);
    expect(text.indexOf('Site: Gemini')).toBeLessThan(text.indexOf('Round my messages'));
    expect(text).toMatch(/- userTurn: 1\b/);
    expect(text).not.toContain('```');
  });

  it('adds no page structure when the user leaves it out, and shows the same text on request', async () => {
    const { composer } = page();
    stop = startCreateMode({ find: () => composer });

    const preview = ask({ type: 'gv.create.outline' }) as { outline: string };
    expect(preview.outline).toContain('Site: Gemini');
    expect(
      ask({ type: 'gv.create.start', request: 'Round my messages', structure: false }),
    ).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(SETTLE_MS + FILL_CONFIRM_MS);
    expect(composerText(composer)).toContain('Round my messages');
    expect(composerText(composer)).not.toContain('Site: Gemini');
  });

  describe('asking the AI to fix an installed creation', () => {
    const ID = 'local.me.narrow';
    const installed = {
      [ID]: {
        manifest: {
          id: ID,
          name: 'Narrow column',
          version: '1.0.0',
          description: 'd',
          author: 'me',
          category: 'layout',
          license: 'MIT',
          engine: '>=1.0.0',
          tier: 'declarative',
          matches: ['https://gemini.google.com/*'],
          contributes: { styles: [{ css: '.convo-v1 { max-width: 60rem }' }] },
        },
        importedAt: 1,
        updatedAt: 1,
      },
    };
    const fix = { type: 'gv.create.fix', id: ID, problem: 'nothing-matches', structure: false };

    const askLater = async (message: unknown): Promise<unknown> => {
      let reply: unknown;
      const kept = listener?.(message, {}, (value) => (reply = value));
      expect(kept).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      return reply;
    };

    beforeEach(() => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [StorageKeys.PLUGIN_LOCAL_MANIFESTS]: installed,
      } as never);
    });

    it('fills a new Create chat with the plugin as installed, and does not send it', async () => {
      const { composer, sendClicked } = page();
      stop = startCreateMode({ find: () => composer });

      expect(await askLater(fix)).toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(SETTLE_MS + FILL_CONFIRM_MS);
      const text = composerText(composer);
      expect(text).toContain(createPageUrl('gemini'));
      expect(text).toContain('"id": "local.me.narrow"');
      expect(sendClicked).not.toHaveBeenCalled();
    });

    it('refuses while the composer holds a draft', async () => {
      const { composer } = page();
      composer.innerHTML = '<p>half a thought</p>';
      stop = startCreateMode({ find: () => composer });

      expect(await askLater(fix)).toEqual({ ok: false, reason: 'busy' });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      expect(location.pathname).toBe(CHAT);
      expect(composerText(composer)).toBe('half a thought');
    });
  });

  it('ignores a request without a sentence', () => {
    const { composer } = page();
    stop = startCreateMode({ find: () => composer });
    expect(ask({ type: 'gv.create.start', request: '' })).toBeUndefined();
  });
});
