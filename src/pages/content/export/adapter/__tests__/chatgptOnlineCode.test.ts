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
async function online(selector = '.repaired-code'): Promise<void> {
  lifetime?.stop();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: 'chatgpt', catalogRevision: 2, selectors: { codeBlock: selector } }),
  });
  await lifetime.ready;
}
function page(bundled = false): HTMLElement {
  document.body.innerHTML = `<main><article data-chatgpt-selection-message-id="answer"><div class="markdown"><p>Example</p><section class="repaired-code" ${bundled ? 'data-markdown-copy="code-block"' : ''}><header data-markdown-copy="exclude"><span class="truncate">python</span><button>Copy</button></header><div><code style="display:block;white-space:pre">print("first")\nprint("second")</code></div></section><p>Done</p></div></article></main>`;
  return document.querySelector('article')!;
}
function exporter() {
  return createContentExtractor(buildChatGptAdapter(chatgptAdapter));
}

it('a renamed ChatGPT block without a pre still exports fenced source instead of flattened prose', async () => {
  const reply = page();
  await online();
  const result = exporter().extractAssistantContent(reply);
  expect(result.text).toBe('Example\n\n```python\nprint("first")\nprint("second")\n```\nDone');
  expect(result.hasCode).toBe(true);
  expect(result.html).toContain('<pre><code class="language-python">print("first")');
});

it('the same native code block exports identical bytes through bundled and remote snapshots', async () => {
  const reply = page(true);
  const before = exporter().extractAssistantContent(reply);
  await online();
  expect(exporter().extractAssistantContent(reply)).toEqual(before);
  expect(before.text).toContain('```python\nprint("first")\nprint("second")\n```');
});

it('an export adapter does not keep claiming a code alias after it absorbs answer prose', async () => {
  const reply = page();
  await online();
  const adapter = exporter();
  expect(adapter.extractAssistantContent(reply).hasCode).toBe(true);
  document
    .querySelector('.repaired-code')!
    .insertAdjacentHTML('afterbegin', '<p>Keep this explanation</p>');
  const result = adapter.extractAssistantContent(reply);
  expect(result.text).toContain('Keep this explanation');
  expect(result.hasCode).toBe(false);
  document.querySelector('.repaired-code > p')!.remove();
  expect(adapter.extractAssistantContent(reply).hasCode).toBe(true);
});

it('inline code and a second source cannot silently disappear into a repaired block', async () => {
  const reply = page();
  await online();
  const code = document.querySelector('code')!;
  code.style.display = 'inline';
  expect(exporter().extractAssistantContent(reply).hasCode).toBe(false);
  code.style.display = 'block';
  code.style.whiteSpace = 'normal';
  expect(exporter().extractAssistantContent(reply).hasCode).toBe(false);
  code.style.whiteSpace = 'pre';
  const extra = document.createElement('code');
  extra.style.cssText = 'display:block;white-space:pre';
  extra.textContent = 'second source';
  document.querySelector('.repaired-code')!.append(extra);
  const partial = exporter().extractAssistantContent(reply);
  expect(partial.text).toContain('second source');
  expect(partial.hasCode).toBe(false);
  extra.remove();
  expect(exporter().extractAssistantContent(reply).hasCode).toBe(true);
});

it('copy-excluded code-shaped controls cannot replace the exported source', async () => {
  const reply = page();
  document
    .querySelector('header')!
    .insertAdjacentHTML('beforeend', '<code style="display:block;white-space:pre">Ctrl+C</code>');
  await online();
  const result = exporter().extractAssistantContent(reply);
  expect(result.text).toBe('Example\n\n```python\nprint("first")\nprint("second")\n```\nDone');
  expect(result.hasCode).toBe(true);
});

it('a code element cannot masquerade as its wrapper and erase its own source', async () => {
  const reply = page();
  await online('code');
  const rejected = exporter().extractAssistantContent(reply);
  expect(rejected.text).toContain('print("first")');
  expect(rejected.hasCode).toBe(false);
  await online();
  expect(exporter().extractAssistantContent(reply).hasCode).toBe(true);
});
