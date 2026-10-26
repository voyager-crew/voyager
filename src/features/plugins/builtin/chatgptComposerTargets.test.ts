// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { SiteAdapter } from '@/features/plugins/types';

import { chatgptComposerRootOf } from './chatgptComposerTargets';
import { findComposerField, findSendButton } from './chatgptLocalBridge/ops/pageReaders';

const lifetimes: SiteSelectorLifetime[] = [];
const INVALID_GROUP_MEMBERS: Readonly<Record<string, string>>[] = [{ sendButton: '#foreign-send' }];

function adapter(selectors: Readonly<Record<string, string>>): SiteAdapter {
  return { ...chatgptAdapter, selectors: { ...chatgptAdapter.selectors, ...selectors } };
}

async function online(selectors: Readonly<Record<string, string>>): Promise<SiteAdapter> {
  const source = adapter(selectors);
  const lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'chatgpt', catalogRevision: 1, selectors: source.selectors }),
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
  return source;
}

async function offline(): Promise<void> {
  const lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    readOnlineUpdates: async () => false,
    read: async () => null,
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
}

function composer(id: string, content: string): HTMLElement {
  const form = document.createElement('form');
  form.innerHTML = `<div id="${id}" contenteditable="true" role="textbox">${content}</div><button type="submit">Send</button>`;
  document.body.append(form);
  return form.firstElementChild as HTMLElement;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 100,
    height: 30,
    x: 0,
    y: 0,
    top: 0,
    bottom: 30,
    left: 0,
    right: 100,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  lifetimes.splice(0).forEach((lifetime) => lifetime.stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ChatGPT composer ownership', () => {
  it('ON without an admitted repair keeps the original composer with one bundled DOM lookup', async () => {
    const input = composer('prompt-textarea', 'Original draft');
    composer('cached-editor', 'Private draft');
    await online({});
    const stale = adapter({
      composer: '#cached-editor',
      composerRoot: 'body',
      sendButton: '#cached-editor + button',
    });
    const query = vi.spyOn(document, 'querySelectorAll');
    expect(findComposerField(stale)).toBe(input);
    expect(query).toHaveBeenCalledTimes(1);
    expect(input.textContent).toBe('Original draft');
  });

  it('OFF keeps the cached composer ahead of a still-mounted bundled editor', async () => {
    const original = composer('prompt-textarea', 'Original draft');
    const cached = composer('cached-editor', 'Cached draft');
    await offline();
    const source = adapter({ composer: '#cached-editor' });
    const query = vi.spyOn(document, 'querySelectorAll');
    expect(findComposerField(source)).toBe(cached);
    expect(query).toHaveBeenCalledTimes(1);
    expect(cached.textContent).toBe('Cached draft');
    expect(original.textContent).toBe('Original draft');
  });

  it('OFF keeps the cached send fallback after the composer’s own submit disappears', async () => {
    const field = composer('prompt-textarea', 'Unsent draft');
    const own = field.parentElement!.querySelector('button')!;
    const cached = document.createElement('button');
    cached.type = 'button';
    cached.id = 'cached-send';
    cached.textContent = 'Send';
    document.body.append(cached);
    await offline();
    const source = adapter({ sendButton: '#cached-send' });
    expect(findSendButton(field, source)).toBe(own);
    own.remove();
    expect(findSendButton(field, source)).toBe(cached);
    expect(field.textContent).toBe('Unsent draft');
  });

  it('a broad online composer root retains the field’s native form', async () => {
    const input = composer('prompt-textarea', 'Original draft');
    const source = await online({ composerRoot: 'body' });
    const root = chatgptComposerRootOf(input, source);
    expect(root).toBe(input.parentElement);
    expect(root?.tagName).toBe('FORM');
  });

  it('the same page yields the same composer and send through bundled and hydrated online data', async () => {
    const input = composer('prompt-textarea', 'Original draft');
    input.setAttribute('data-repaired', '');
    const bundledInput = findComposerField(null);
    const bundledSend = findSendButton(input, null);
    const source = await online({
      composer: '[data-repaired]',
      sendButton: 'form:has([data-repaired]) button',
    });
    expect(findComposerField(source)).toBe(bundledInput);
    expect(findSendButton(input, source)).toBe(bundledSend);
    expect(input.textContent).toBe('Original draft');
  });

  it('a later adapter reload cannot replace the page’s accepted composer snapshot', async () => {
    document.body.innerHTML =
      '<form data-chatgpt-composer><section id="renamed-editor" contenteditable="plaintext-only" role="textbox">Unsent draft</section><button type="submit">Send</button></form>';
    const input = document.querySelector<HTMLElement>('#renamed-editor');
    await online({ composer: '#renamed-editor' });
    expect(findComposerField(adapter({ composer: '#later-editor' }))).toBe(input);
    expect(input?.textContent).toBe('Unsent draft');
  });

  it('an online composer pointing at another form preserves the original draft target', async () => {
    const input = composer('prompt-textarea', 'Original draft');
    const other = composer('other-editor', 'Unrelated draft');
    other.parentElement?.setAttribute('data-chatgpt-composer', '');
    const source = await online({ composer: '#other-editor' });
    expect(findComposerField(source)).toBe(input);
    expect(input.textContent).toBe('Original draft');
  });

  it('a repaired unique native composer can be found when its packaged marker disappeared', async () => {
    document.body.innerHTML =
      '<form data-chatgpt-composer><section id="renamed-editor" contenteditable="plaintext-only" role="textbox">Unsent draft</section><button type="submit">Send</button></form>';
    const input = document.querySelector<HTMLElement>('#renamed-editor');
    const source = await online({
      composer: '#renamed-editor',
      composerRoot: 'form[data-chatgpt-composer]',
      sendButton: 'form[data-chatgpt-composer] > button',
    });
    const read = findComposerField(source);
    expect(read).toBe(input);
    expect(read?.textContent).toBe('Unsent draft');
  });

  it.each(INVALID_GROUP_MEMBERS)(
    'a bad composer group member cannot retain a repaired editor: %j',
    async (invalid) => {
      document.body.innerHTML =
        '<form data-chatgpt-composer><section id="renamed-editor" contenteditable="plaintext-only">Unsent draft</section><button type="submit">Send</button></form><button id="foreign-send">Unrelated action</button>';
      const source = await online({ composer: '#renamed-editor', ...invalid });
      const read = findComposerField(source);
      if (read) read.textContent = 'Mixed-profile handoff';
      expect(document.querySelector('#renamed-editor')?.textContent).toBe('Unsent draft');
    },
  );

  it('a packaged composer owner ignores a remote root while the original editor repair still works', async () => {
    document.body.innerHTML =
      '<form data-chatgpt-composer><section id="renamed-editor" contenteditable="true">Draft</section><button type="submit">Send</button></form>';
    const source = await online({ composer: '#renamed-editor', composerRoot: 'body' });
    const field = findComposerField(source);
    expect(field).toBe(document.querySelector('#renamed-editor'));
    expect(chatgptComposerRootOf(field!, source)).toBe(document.querySelector('form'));
  });

  it('a profile editor with Submit cannot become the repaired chat composer', async () => {
    document.body.innerHTML =
      '<form><section id="profile-bio" contenteditable="plaintext-only">Private biography</section><button type="submit">Submit</button></form>';
    const source = await online({ composer: '#profile-bio' });
    const read = findComposerField(source);
    if (read) read.textContent = 'Conversation handoff';
    expect(document.querySelector('#profile-bio')?.textContent).toBe('Private biography');
  });

  it('an inline response editor is never accepted as a repaired main composer', async () => {
    document.body.innerHTML =
      '<form data-chatgpt-composer data-turn-key="turn-1"><section id="inline-editor" contenteditable="plaintext-only">Reply edit</section><button type="submit">Send</button></form>';
    const source = await online({ composer: '#inline-editor' });
    const read = findComposerField(source);
    if (read) read.textContent = 'Misplaced handoff';
    expect(document.querySelector('#inline-editor')?.textContent).toBe('Reply edit');
  });

  it('a form with two editable fields cannot claim one as a repaired main composer', async () => {
    document.body.innerHTML =
      '<form data-chatgpt-composer><section id="candidate-editor" contenteditable="plaintext-only">First draft</section><section contenteditable="plaintext-only">Second draft</section><button type="submit">Send</button></form>';
    const source = await online({ composer: '#candidate-editor' });
    const read = findComposerField(source);
    if (read) read.textContent = 'Misplaced handoff';
    expect(document.querySelector('#candidate-editor')?.textContent).toBe('First draft');
    expect(document.querySelector('section + section')?.textContent).toBe('Second draft');
  });

  it('a remote send button in another form cannot receive the original composer send', async () => {
    const input = composer('prompt-textarea', 'Original draft');
    const other = composer('other-editor', 'Other draft');
    const own = input.parentElement?.querySelector('button');
    const source = await online({ sendButton: '#other-editor + button' });
    expect(findSendButton(input, source)).toBe(own);
    expect(other.textContent).toBe('Other draft');
  });

  it('multiple online send candidates retain the single native control', async () => {
    const input = composer('prompt-textarea', 'Original draft');
    composer('other-editor', 'Other draft');
    const source = await online({ sendButton: 'button' });
    const read = findSendButton(input, source);
    expect(read).toBe(input.parentElement?.querySelector('button'));
    expect(read?.form).toBe(input.parentElement);
  });
});
