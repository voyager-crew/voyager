// @vitest-environment-options { "url": "https://chatgpt.com/c/root-repair" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { resolveComposerOperation } from '@/core/services/composer/siteComposerOperation';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { chatgptComposerRootOf } from './chatgptComposerTargets';
import { createChatGptPage } from './chatgptResponseNotification/page';
import { createChatGptResponseNotificationRun } from './chatgptResponseNotification/run';

const lifetimes: SiteSelectorLifetime[] = [];
let stop: (() => void) | undefined;

async function online(root = '.repaired-root', composer?: string) {
  const adapter = {
    ...chatgptAdapter,
    selectors: {
      ...chatgptAdapter.selectors,
      composerRoot: root,
      ...(composer ? { composer } : {}),
    },
  };
  const lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ ...adapter, catalogRevision: 1 }),
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
  return adapter;
}

function mount(tag = 'section') {
  document.body.innerHTML = `<main></main><${tag} class="repaired-root">
    <div id="prompt-textarea" contenteditable="true">Draft</div>
    <button type="submit">Send</button><button type="button" aria-label="Stop">Stop</button>
  </${tag}><button type="button" id="foreign-stop" aria-label="Stop">Stop</button>`;
  return {
    root: document.querySelector<HTMLElement>('.repaired-root')!,
    field: document.getElementById('prompt-textarea')!,
    submit: document.querySelector<HTMLButtonElement>('[type="submit"]')!,
    ownStop: document.querySelector<HTMLButtonElement>('.repaired-root [aria-label="Stop"]')!,
    foreignStop: document.getElementById('foreign-stop')!,
  };
}

function rendered() {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
}

afterEach(() => {
  stop?.();
  stop = undefined;
  lifetimes.splice(0).forEach((lifetime) => lifetime.stop());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('a composer moved out of form still reports its own stop and ignores unrelated controls', async () => {
  const { ownStop, foreignStop } = mount();
  rendered();
  const page = createChatGptPage(await online());
  expect(page.hasLabelledStopControl()).toBe(true);
  expect(page.isStopControlTarget(ownStop)).toBe(true);
  expect(page.isStopControlTarget(foreignStop)).toBe(false);
  ownStop.remove();
  expect(page.hasLabelledStopControl()).toBe(false);
});

it('the same form has identical notification reads through bundled and online roots', async () => {
  const { ownStop, foreignStop } = mount('form');
  rendered();
  const read = (page: ReturnType<typeof createChatGptPage>) => [
    page.hasLabelledStopControl(),
    page.isStopControlTarget(ownStop),
    page.isStopControlTarget(foreignStop),
  ];
  const baseline = read(createChatGptPage(chatgptAdapter));
  expect(baseline).toEqual([true, true, false]);
  expect(read(createChatGptPage(await online()))).toEqual(baseline);
});

it('an outside-form upload owner still contains the proven composer and submit', async () => {
  const { root, field, submit, ownStop } = mount();
  const form = document.createElement('form');
  form.append(field, submit);
  root.prepend(form, document.createElement('progress'));
  rendered();
  const adapter = await online();
  const page = createChatGptPage(adapter);
  expect(page.hasLabelledStopControl()).toBe(true);
  expect(page.isStopControlTarget(ownStop)).toBe(true);
  expect(chatgptComposerRootOf(field, adapter)).toBe(root);
});

it('a repaired native editor and root retain the same stop owner', async () => {
  const { root, field, ownStop } = mount('form');
  root.setAttribute('data-chatgpt-composer', '');
  field.id = 'renamed-input';
  rendered();
  const page = createChatGptPage(await online('.repaired-root', '#renamed-input'));
  expect(page.hasLabelledStopControl()).toBe(true);
  expect(page.isStopControlTarget(ownStop)).toBe(true);
});

it('a late composer root is reproved when it appears and after dialog ownership changes', async () => {
  const page = createChatGptPage(await online());
  const { root, ownStop } = mount();
  rendered();
  expect(page.hasLabelledStopControl()).toBe(true);
  root.setAttribute('role', 'dialog');
  expect(page.hasLabelledStopControl()).toBe(false);
  expect(page.isStopControlTarget(ownStop)).toBe(false);
  root.removeAttribute('role');
  expect(page.hasLabelledStopControl()).toBe(true);
});

const INVALID_ROOTS: ReadonlyArray<readonly [string, (nodes: ReturnType<typeof mount>) => void]> = [
  [
    'duplicate roots',
    () =>
      document.body.insertAdjacentHTML('beforeend', '<section class="repaired-root"></section>'),
  ],
  ['a second editor', ({ root }) => root.append(document.createElement('textarea'))],
  [
    'a second native composer elsewhere',
    () =>
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div data-composer-markdown contenteditable="true"></div>',
      ),
  ],
  [
    'an unproven editor',
    ({ field }) => {
      field.id = 'profile-bio';
    },
  ],
  [
    'a reply-owned editor',
    ({ root }) => {
      const bubble = document.createElement('div');
      bubble.setAttribute('data-user-message-bubble', '');
      root.replaceWith(bubble);
      bubble.append(root);
    },
  ],
  ['a readonly editor', ({ field }) => field.setAttribute('readonly', '')],
  ['a missing submit', ({ submit }) => submit.remove()],
  [
    'two submits',
    ({ root }) => root.insertAdjacentHTML('beforeend', '<button type="submit">Other send</button>'),
  ],
  [
    'a submit assigned to another form',
    ({ submit }) => {
      document.body.insertAdjacentHTML('beforeend', '<form id="other-form"></form>');
      submit.setAttribute('form', 'other-form');
    },
  ],
  [
    'a reply inside the claimed root',
    ({ root }) =>
      root.insertAdjacentHTML('beforeend', '<article data-turn-key="reply">Answer</article>'),
  ],
  ['a Voyager root', ({ root }) => root.setAttribute('data-gv-component', 'panel')],
  ['a Voyager editor', ({ field }) => field.setAttribute('data-gv-component', 'editor')],
];

it.each(INVALID_ROOTS)(
  '%s cannot certify a stop as belonging to the composer',
  async (_name, invalidate) => {
    const nodes = mount();
    rendered();
    const page = createChatGptPage(
      await online('.repaired-root', '#prompt-textarea, #profile-bio'),
    );
    expect(page.hasLabelledStopControl()).toBe(true);
    invalidate(nodes);
    expect(page.hasLabelledStopControl()).toBe(false);
    expect(page.isStopControlTarget(nodes.ownStop)).toBe(false);
  },
);

it.each(['body', 'main'])(
  'a broad %s cannot borrow the composer to own an unrelated stop',
  async (tag) => {
    const { root, foreignStop } = mount();
    if (tag === 'main') document.querySelector('main')!.append(root, foreignStop);
    rendered();
    const valid = createChatGptPage(await online());
    expect(valid.hasLabelledStopControl()).toBe(true);
    lifetimes.splice(0).forEach((lifetime) => lifetime.stop());
    const page = createChatGptPage(await online(tag));
    expect(page.hasLabelledStopControl()).toBe(false);
    expect(page.isStopControlTarget(foreignStop)).toBe(false);
  },
);

it('a reply finishing outside form still sends one completion notification', async () => {
  vi.useFakeTimers();
  const { ownStop } = mount();
  ownStop.remove();
  rendered();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const send = vi
    .fn<(message: unknown) => Promise<{ ok: boolean }>>()
    .mockResolvedValue({ ok: true });
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(send);
  const adapter = await online();
  stop = createChatGptResponseNotificationRun({ adapter });
  await vi.advanceTimersByTimeAsync(1500);
  document.querySelector('.repaired-root')!.append(ownStop);
  await vi.advanceTimersByTimeAsync(1000);
  document.querySelector('main')!.innerHTML =
    '<div data-turn-key="answer"><div data-user-message-bubble>Question</div><div data-chatgpt-selection-message-id="answer">Finished reply</div></div>';
  ownStop.remove();
  await vi.advanceTimersByTimeAsync(3000);
  const notifications = send.mock.calls.filter(
    ([message]) =>
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'gv.responseComplete.notify',
  );
  expect(notifications).toHaveLength(1);
  expect(notifications[0][0]).toMatchObject({ payload: { userPrompt: 'Question' } });
});

it('a renamed root cannot send an unrecognised profile editor through the composer operation boundary', async () => {
  const { field, submit } = mount();
  await online();
  const click = vi.fn((event: Event) => event.preventDefault());
  submit.addEventListener('click', click);
  const send = () => {
    const accepted = resolveComposerOperation(
      chatgptAdapter,
      document,
      {
        composer: '#prompt-textarea, #profile-bio',
        composerRoot: '.repaired-root',
        sendButton: 'button[type="submit"]',
      },
      (selectors) => {
        const input = document.querySelector<HTMLElement>(selectors.composer);
        return {
          field: input,
          root: input?.closest(selectors.composerRoot) ?? null,
          control: document.querySelector<HTMLElement>(selectors.sendButton),
        };
      },
    );
    accepted.control?.click();
  };
  send();
  expect(click).toHaveBeenCalledTimes(1);
  field.id = 'profile-bio';
  send();
  expect(click).toHaveBeenCalledTimes(1);
  expect(field.textContent).toBe('Draft');
});
