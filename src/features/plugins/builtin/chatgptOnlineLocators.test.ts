// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/thread" }
import { afterEach, expect, it } from 'vitest';

import {
  initializeSiteSelectors,
  pageSemanticSelector,
  type SiteSelectorLifetime,
} from '@/core/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { ModelPickerSection } from '@/features/plugins/sites/sections/modelPickerData';
import { findAssistantReply, findUserBubble } from '@/pages/content/export/adapter/chatgptThread';

import { chatgptActionSelector } from './chatgptActionTargets';
import { hasThinkingSignal } from './chatgptLocalBridge/ops/pageReaders';
import { interruptionNotice } from './chatgptLocalBridge/ops/replyEvidence';
import { findTrigger, readPicker } from './chatgptModelSelect/pickerDom';
import { notificationSelectorsOf } from './chatgptNotificationSelectors';
import { isTemporaryChat } from './chatgptTemporaryHandoff/handoff';

let lifetime: SiteSelectorLifetime | undefined;
afterEach(() => {
  lifetime?.stop();
  document.body.replaceChildren();
  history.replaceState(null, '', '/c/thread');
});

async function online(
  locators: Record<string, string[]>,
  selectors = {},
  pageHooks = {},
): Promise<void> {
  lifetime?.stop();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: 'chatgpt', catalogRevision: 2, locators, selectors, pageHooks }),
  });
  await lifetime.ready;
}

const pickerData: ModelPickerSection = {
  format: 1,
  triggerLabels: { en: ['Select ChatGPT model'] },
  effortStatus: { en: '{label}, {position} of {count}.' },
  models: {},
  presets: {},
};

function turns(repaired = false): HTMLElement {
  document.body.innerHTML = `<main><div data-turn-key="one"><div data-chatgpt-search-unit-key="one:user"><div ${repaired ? 'class="question"' : 'data-user-message-bubble class="question"'}>Question <strong>whole</strong></div></div><div data-chatgpt-search-unit-key="one:assistant"><h4 data-conversation-role="assistant">ChatGPT said</h4><div ${repaired ? 'class="answer"' : 'data-chatgpt-selection-message-id="reply" class="answer"'}>Answer <img src="https://example.com/image.png"></div></div></div></main>`;
  return document.querySelector('[data-turn-key]')!;
}

it('export and notifications keep the same complete turn nodes through the catalog', async () => {
  const item = turns();
  const user = findUserBubble(item),
    assistant = findAssistantReply(item);
  await online({}, { userTurn: '.question', assistantTurn: '.answer' });
  expect(findUserBubble(item)).toBe(user);
  expect(findAssistantReply(item)).toBe(assistant);
  const selectors = notificationSelectorsOf(chatgptAdapter);
  expect(document.querySelector(selectors.userTurn)).toBe(user);
  expect(document.querySelector(selectors.assistantTurn)).toBe(assistant);
});

it('renamed turn bodies repair export and notification reads together', async () => {
  const item = turns(true);
  await online({}, { userTurn: '.question', assistantTurn: '.answer' });
  expect(findUserBubble(item)?.textContent).toBe('Question whole');
  expect(findAssistantReply(item)?.querySelector('img')?.src).toBe('https://example.com/image.png');
  const selectors = notificationSelectorsOf(chatgptAdapter);
  expect(document.querySelector(selectors.userTurn)).toBe(findUserBubble(item));
});

it('a partial repair cannot omit another prompt or steal the answer role', async () => {
  turns(true);
  document
    .querySelector('main')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-turn-key="two"><div data-chatgpt-search-unit-key="two:user"><div class="question">Second</div></div></div>',
    );
  await online({}, { userTurn: '[data-turn-key="one"] .question', assistantTurn: '.answer' });
  expect(pageSemanticSelector(chatgptAdapter, 'userTurn')).toBe(chatgptAdapter.selectors.userTurn);
  expect(pageSemanticSelector(chatgptAdapter, 'assistantTurn')).toBe(
    chatgptAdapter.selectors.assistantTurn,
  );
});

it('same text in another role does not become the prompt', async () => {
  turns(true);
  await online({}, { userTurn: '.answer', assistantTurn: '.question' });
  expect(pageSemanticSelector(chatgptAdapter, 'userTurn')).toBe(chatgptAdapter.selectors.userTurn);
});

it('a body fragment cannot drop an image from its original answer', async () => {
  turns(true);
  document.querySelector('.answer')!.innerHTML =
    '<div class="fragment">Answer</div><img src="https://example.com/kept.png">';
  await online({}, { userTurn: '.question', assistantTurn: '.fragment' });
  expect(pageSemanticSelector(chatgptAdapter, 'assistantTurn')).toBe(
    chatgptAdapter.selectors.assistantTurn,
  );
});

it.each(['form', 'section role="dialog"', 'section class="gv-tools"'])(
  'a %s cannot impersonate native chat messages',
  async (wrapper) => {
    turns(true);
    const main = document.querySelector('main')!;
    main.innerHTML = `<${wrapper}>${main.innerHTML}</${wrapper.split(' ')[0]}>`;
    await online({}, { userTurn: '.question', assistantTurn: '.answer' });
    expect(pageSemanticSelector(chatgptAdapter, 'userTurn')).toBe(
      chatgptAdapter.selectors.userTurn,
    );
  },
);

it('an existing native turn cannot be substituted by a duplicate repaired body', async () => {
  turns();
  document.querySelector('.question')!.textContent = '';
  document
    .querySelector('.question')!
    .insertAdjacentHTML('afterend', '<div class="duplicate">Question whole</div>');
  await online({}, { userTurn: '.duplicate', assistantTurn: '.answer' });
  expect(findUserBubble(document.querySelector('[data-turn-key]')!)).toBe(
    document.querySelector('.question'),
  );
});

it('a renamed model trigger and effort row retain the native menu and keyboard protocol', async () => {
  document.body.innerHTML =
    '<form><div role="button" aria-haspopup="menu" aria-label="Select ChatGPT model" class="picker">High</div></form><div role="menu"><span role="status">High, 3 of 5.</span><div role="menuitem" aria-keyshortcuts="ArrowLeft ArrowRight" class="effort"></div></div>';
  await online({}, {}, { modelPickerTrigger: '.picker', effortControl: '.effort' });
  expect(findTrigger(document.querySelector('form')!, pickerData)).toBe(
    document.querySelector('.picker'),
  );
  expect(readPicker(document.querySelector('[role="menu"]')!, pickerData).slider).toMatchObject({
    element: document.querySelector('.effort'),
    now: 2,
    max: 4,
  });
});

it.each([
  ['wrong label', 'aria-label="Open tools" aria-haspopup="menu"', 'form'],
  ['missing menu semantics', 'aria-label="Select ChatGPT model"', 'form'],
  ['foreign owner', 'aria-label="Select ChatGPT model" aria-haspopup="menu"', 'aside'],
])('a repaired picker with %s cannot receive a click', async (_name, attrs, parent) => {
  document.body.innerHTML = `<${parent}><div role="button" ${attrs} class="picker">High</div></${parent}>`;
  await online({}, {}, { modelPickerTrigger: '.picker' });
  expect(findTrigger(document.body, pickerData)).toBeNull();
});

it('ambiguous model triggers do not select a different control', async () => {
  document.body.innerHTML =
    '<form><div role="button" aria-haspopup="menu" aria-label="Select ChatGPT model" class="picker"></div><div role="button" aria-haspopup="menu" aria-label="Select ChatGPT model" class="picker"></div></form>';
  await online({}, {}, { modelPickerTrigger: '.picker' });
  expect(findTrigger(document.body, pickerData)).toBeNull();
});

it('a remote effort row without arrow key support cannot change a model setting', async () => {
  document.body.innerHTML =
    '<div role="menu"><span role="status">High, 3 of 5.</span><div role="menuitem" class="effort"></div></div>';
  await online({}, {}, { effortControl: '.effort' });
  expect(readPicker(document.querySelector('[role="menu"]')!, pickerData).slider).toBeNull();
});

it('temporary mode and its header controls use the repaired native button', async () => {
  document.body.innerHTML =
    '<header><button class="temporary" aria-pressed="true">Close temporary</button><button class="share">Share</button></header>';
  await online({ 'actions.temporaryToggle': ['.temporary'], 'actions.shareButton': ['.share'] });
  expect(isTemporaryChat()).toBe(true);
  expect(document.querySelector(chatgptActionSelector('actions.shareButton'))).toBe(
    document.querySelector('.share'),
  );
});

it('a remote temporary toggle cannot treat an unrelated pressed control as temporary mode', async () => {
  document.body.innerHTML =
    '<header><button class="temporary" aria-pressed="true">Bold</button></header>';
  await online({ 'actions.temporaryToggle': ['.temporary'] });
  expect(isTemporaryChat()).toBe(false);
});

it('a remote new-chat link cannot navigate to another origin', async () => {
  document.body.innerHTML =
    '<nav><a class="new-chat" href="https://example.com/">New chat</a></nav>';
  await online({ 'actions.newChat': ['.new-chat'] });
  expect(document.querySelector(chatgptActionSelector('actions.newChat'))).toBeNull();
});

it('a renamed custom GPT new-chat link is recovered only while its original route is intact', async () => {
  history.replaceState(null, '', '/g/example/c/thread');
  document.body.innerHTML = '<nav><a class="new-chat" href="/g/example/">New chat</a></nav>';
  const link = document.querySelector<HTMLAnchorElement>('a')!;
  expect(document.querySelector(chatgptActionSelector('actions.newChat'))).toBeNull();
  await online({ 'actions.newChat': ['.new-chat'] });
  expect(document.querySelector(chatgptActionSelector('actions.newChat'))).toBe(link);
  link.href = '/g/another/';
  expect(document.querySelector(chatgptActionSelector('actions.newChat'))).toBeNull();
  link.href = '/g/example/';
  expect(document.querySelector(chatgptActionSelector('actions.newChat'))).toBe(link);
});

it('a new-chat repair cannot leave the selected account or custom GPT', async () => {
  history.replaceState(null, '', '/u/2/g/example/c/thread');
  document.body.innerHTML = '<nav><a class="new-chat" href="/g/example/">New chat</a></nav>';
  await online({ 'actions.newChat': ['.new-chat'] });
  expect(document.querySelector(chatgptActionSelector('actions.newChat'))).toBeNull();
});

it('a home link relocated into the native sidebar remains available to mode switching', async () => {
  document.body.innerHTML = '<aside><a class="home" href="/">Home</a></aside>';
  await online({ 'actions.homeLink': ['.home'] });
  expect(document.querySelector(chatgptActionSelector('actions.homeLink'))).toBe(
    document.querySelector('.home'),
  );
});

it('bridge waits and export use the same independently proven pending signal', async () => {
  document.body.innerHTML =
    '<div data-turn-key="one"><div class="busy"><progress></progress></div></div>';
  await online({ 'actions.thinking': ['.busy'] });
  expect(hasThinkingSignal(document.querySelector('[data-turn-key]')!)).toBe(true);
});

it('the same picker controls survive a remote profile without changing their identities', async () => {
  document.body.innerHTML =
    '<form><button aria-label="Select ChatGPT model" aria-haspopup="menu" data-composer-navigation-target="reasoning" class="picker">High</button></form><div role="menu"><span role="status">High, 3 of 5.</span><div role="menuitem" data-reasoning-slider="true" aria-keyshortcuts="ArrowLeft ArrowRight" class="effort"></div></div>';
  const form = document.querySelector('form')!,
    menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const trigger = findTrigger(form, pickerData),
    reading = readPicker(menu, pickerData);
  await online({}, {}, { modelPickerTrigger: '.picker', effortControl: '.effort' });
  expect(findTrigger(form, pickerData)).toBe(trigger);
  expect(readPicker(menu, pickerData)).toEqual(reading);
});

it('two matching temporary controls cannot select an arbitrary active mode', async () => {
  document.body.innerHTML =
    '<header><button class="temporary" aria-pressed="true">Close temporary</button><button class="temporary" aria-pressed="true">Close temporary</button></header>';
  await online({ 'actions.temporaryToggle': ['.temporary'] });
  expect(isTemporaryChat()).toBe(false);
});

it('a renamed reply body cannot be mistaken for a connection failure notice', async () => {
  document.body.innerHTML =
    '<div data-turn-key="one"><div data-chatgpt-selection-message-id="reply"><div class="body">Connection interrupted. This is quoted in the answer.</div></div><div role="alert">Connection interrupted. The actual page notice.</div></div>';
  await online({ 'bridge.replyContent': ['.body'] });
  expect(interruptionNotice(document.querySelector('[data-turn-key]')!)).toBe(
    'Connection interrupted. The actual page notice.',
  );
});

it('notifications retain the same repaired native composer accepted by the runtime', async () => {
  document.body.innerHTML =
    '<form data-chatgpt-composer><textarea class="renamed-input">Draft</textarea><button class="renamed-send" type="submit">Send</button></form>';
  await online({}, { composer: '.renamed-input', sendButton: '.renamed-send' });
  const selected = notificationSelectorsOf(chatgptAdapter);
  expect(document.querySelector(selected.composer)).toBe(document.querySelector('textarea'));
  expect(document.querySelector(selected.sendButton)).toBe(document.querySelector('button'));
});
