// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/code" }
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { buildChatGptAdapter } from '../platform/chatgpt';

let lifetime: SiteSelectorLifetime | undefined;
afterEach(() => {
  lifetime?.stop();
  document.body.replaceChildren();
});
async function online(selector = '.language-name'): Promise<void> {
  lifetime?.stop();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 2,
      locators: { 'export.codeLanguage': [selector] },
    }),
  });
  await lifetime.ready;
}
function page(native = true): HTMLElement {
  document.body.innerHTML = `<main><article data-chatgpt-selection-message-id="answer"><div class="markdown"><section data-markdown-copy="code-block" class="language-python"><header data-markdown-copy="exclude"><span class="language-name ${native ? 'truncate' : ''}">Python</span><button>Copy</button></header><code style="display:block;white-space:pre">print("hello")</code></section></div></article></main>`;
  return document.querySelector('article')!;
}
function extract(reply: HTMLElement) {
  return createContentExtractor(buildChatGptAdapter(chatgptAdapter)).extractAssistantContent(reply);
}

it('the same code exports the same language fence through bundled and remote labels', async () => {
  const reply = page();
  const before = extract(reply);
  await online();
  expect(extract(reply)).toEqual(before);
  expect(before.text).toContain('```python\nprint("hello")');
});

it('a renamed language label keeps the fence language supplied by its own code metadata', async () => {
  const reply = page(false);
  await online();
  expect(extract(reply).text).toContain('```python\nprint("hello")');
});

it('a status word cannot replace the exported language even when it looks like a language ID', async () => {
  const reply = page();
  document
    .querySelector('header')!
    .insertAdjacentHTML('beforeend', '<span class="status">ruby</span>');
  await online('.status');
  expect(extract(reply).text).toContain('```python\nprint("hello")');
});

it('metadata on an unrelated label cannot certify that label as the code language', async () => {
  const reply = page();
  document
    .querySelector('header')!
    .insertAdjacentHTML('beforeend', '<span class="status language-ruby">ruby</span>');
  await online('.status');
  expect(extract(reply).text).toContain('```python\nprint("hello")');
});

it('a second code language cannot silently change the first source fence', async () => {
  const reply = page();
  document.querySelector('code')!.parentElement!.classList.add('language-ruby');
  document
    .querySelector('header')!
    .insertAdjacentHTML('beforeend', '<span class="status">ruby</span>');
  await online('.status');
  expect(extract(reply).text).toContain('```python\nprint("hello")');
});

it('a late label edit is checked again before the next export', async () => {
  const reply = page(false);
  await online();
  const exporter = createContentExtractor(buildChatGptAdapter(chatgptAdapter));
  expect(exporter.extractAssistantContent(reply).text).toContain('```python\n');
  document.querySelector('.language-name')!.textContent = 'ruby';
  expect(exporter.extractAssistantContent(reply).text).toContain('```\nprint("hello")');
});
