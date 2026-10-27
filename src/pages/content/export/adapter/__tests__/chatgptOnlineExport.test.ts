// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/uc/thread" }
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { chatgptLoggedOutAssistantSelector } from '../chatgptExportLocators';
import { createChatGptLoggedOutReader } from '../chatgptLoggedOut';
import { resolveChatGptLoggedOutThread } from '../chatgptLoggedOutDom';
import { isChatGptThreadGenerating } from '../chatgptThread';
import { buildChatGptAdapter } from '../platform/chatgpt';

let lifetime: SiteSelectorLifetime | undefined;
afterEach(() => {
  lifetime?.stop();
  document.body.replaceChildren();
});
async function online(locators: Record<string, string[]>): Promise<void> {
  lifetime?.stop();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: 'chatgpt', catalogRevision: 2, locators }),
  });
  await lifetime.ready;
}
function page(repaired = false): void {
  document.body.innerHTML = `<main><section class="thread" ${repaired ? '' : 'data-mobile-thread'}><article data-message-role="user" data-message-id="question"><div data-user-message-bubble>Question</div></article><article data-message-role="assistant" data-message-id="answer"><div class="answer" ${repaired ? '' : 'data-assistant-markdown-root'}>Whole <strong>answer</strong><img src="https://example.com/image.png"></div><button>Copy</button></article></section></main>`;
}
const profile = { 'export.loggedOutThread': ['.thread'], 'export.loggedOutAssistant': ['.answer'] };
function reader() {
  return createChatGptLoggedOutReader(buildChatGptAdapter(chatgptAdapter));
}

it('logged-out export keeps the same role, IDs, bodies and order with bundled and remote data', async () => {
  page();
  const before = reader().messages();
  await online(profile);
  expect(reader().messages()).toEqual(before);
});

it('renamed logged-out wrappers still export the complete original conversation', async () => {
  page(true);
  await online(profile);
  const messages = reader().messages();
  expect(
    messages.map(({ messageId, role, exportElement }) => [
      messageId,
      role,
      exportElement?.textContent,
    ]),
  ).toEqual([
    ['logged-out-id:user:question', 'user', 'Question'],
    ['logged-out-id:assistant:answer', 'assistant', 'Whole answer'],
  ]);
  expect(messages[1].exportElement?.querySelector('img')?.src).toBe(
    'https://example.com/image.png',
  );
});

it('a partial logged-out thread cannot omit another message', async () => {
  page(true);
  document
    .querySelector('main')!
    .insertAdjacentHTML(
      'beforeend',
      '<article data-message-role="user"><div data-user-message-bubble>Still part of the thread</div></article>',
    );
  await online(profile);
  expect(resolveChatGptLoggedOutThread()).toBeNull();
  expect(document.querySelectorAll('[data-message-role]')).toHaveLength(3);
});

it('a renamed body cannot omit an image that belongs to the same reply', async () => {
  page(true);
  document.querySelector('.answer')!.innerHTML =
    '<div class="fragment">Whole answer</div><img src="https://example.com/image.png">';
  await online({ ...profile, 'export.loggedOutAssistant': ['.fragment'] });
  expect(chatgptLoggedOutAssistantSelector()).toBe('[data-assistant-markdown-root]');
  expect(
    reader()
      .messages()
      .map(({ role }) => role),
  ).toEqual([]);
});

it('a remote body cannot replace an already identified native answer', async () => {
  page();
  document.querySelector('.answer')!.replaceChildren();
  document
    .querySelector('.answer')!
    .insertAdjacentHTML('afterend', '<div class="duplicate">Whole answer</div>');
  await online({ ...profile, 'export.loggedOutAssistant': ['.duplicate'] });
  expect(reader().messages()[1].exportElement).toBe(document.querySelector('.answer'));
});

it('another role cannot become the logged-out answer', async () => {
  page(true);
  await online({ ...profile, 'export.loggedOutAssistant': ['[data-user-message-bubble]'] });
  expect(
    reader()
      .messages()
      .map(({ role, exportElement }) => [role, exportElement?.textContent]),
  ).toEqual([]);
});

it('a repaired streaming marker prevents exporting an unfinished native answer', async () => {
  document.body.innerHTML =
    '<main><div data-turn-key="one"><div class="stream" aria-busy="true">Writing</div></div></main>';
  await online({ 'export.streaming': ['.stream'] });
  expect(isChatGptThreadGenerating()).toBe(true);
});

it('a status elsewhere on the page does not make a completed thread look unfinished', async () => {
  document.body.innerHTML =
    '<aside><div class="stream" aria-busy="true">Uploading avatar</div></aside><main><div data-turn-key="one">Complete answer</div></main>';
  await online({ 'export.streaming': ['.stream'] });
  expect(isChatGptThreadGenerating()).toBe(false);
});

it('a remote marker cannot silence an existing native streaming signal', async () => {
  document.body.innerHTML =
    '<main><div data-turn-key="one"><div class="result-streaming">Writing</div><div class="stream" aria-busy="true">Writing</div></div></main>';
  await online({ 'export.streaming': ['.stream'] });
  document.querySelector('.stream')!.remove();
  expect(isChatGptThreadGenerating()).toBe(true);
});

it('a static answer with an unrelated class cannot be called streaming', async () => {
  document.body.innerHTML =
    '<main><div data-turn-key="one"><div class="stream">Complete answer</div></div></main>';
  await online({ 'export.streaming': ['.stream'] });
  expect(isChatGptThreadGenerating()).toBe(false);
});

it('a preview dialog cannot masquerade as the logged-out conversation', async () => {
  page(true);
  document.querySelector('.thread')!.setAttribute('role', 'dialog');
  await online({ 'export.loggedOutThread': ['.thread'] });
  expect(resolveChatGptLoggedOutThread()).toBeNull();
  expect(document.querySelector('[data-message-role="user"]')?.textContent).toBe('Question');
});

it('the whole ARIA main cannot replace the logged-out conversation body', async () => {
  page(true);
  const thread = document.querySelector('.thread')!;
  thread.setAttribute('role', 'main');
  await online(profile);
  expect(resolveChatGptLoggedOutThread()).toBeNull();
  thread.removeAttribute('role');
  expect(resolveChatGptLoggedOutThread()).toBe(thread);
});

it('an answer inside a dialog cannot be substituted into the main thread', async () => {
  page(true);
  document.querySelector('.thread')!.setAttribute('data-mobile-thread', '');
  document.querySelector('.answer')!.parentElement!.setAttribute('role', 'dialog');
  await online({ 'export.loggedOutAssistant': ['.answer'] });
  expect(
    reader()
      .messages()
      .map(({ role, exportElement }) => [role, exportElement?.textContent]),
  ).toEqual([['user', 'Question']]);
});
