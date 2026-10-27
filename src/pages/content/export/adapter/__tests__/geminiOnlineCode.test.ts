// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/code" }
import { afterEach, expect, it } from 'vitest';

import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { buildGeminiAdapter } from '../platform/gemini';

afterEach(() => document.body.replaceChildren());

function remote(selector = '.repaired-code'): GeminiSelectorView {
  const bundled = getBundledGeminiSelectorView();
  return {
    ...bundled,
    profiles: { ...bundled.profiles, 'code.host': [selector] },
    remoteKeys: new Set(['code.host']),
  };
}

function block(tag = 'renamed-code', extra = ''): string {
  return `<${tag} class="repaired-code" ${extra}><div class="code-block"><div class="code-block-decoration">python</div><pre><code data-test-id="code-content">print("first")\nprint("second")</code></pre></div></${tag}>`;
}

function page(markup: string): HTMLElement {
  document.body.innerHTML = `<model-response><message-content><div class="markdown">${markup}</div></message-content></model-response>`;
  return document.querySelector('model-response')!;
}

function exporter(view = remote()) {
  return createContentExtractor(buildGeminiAdapter(geminiAdapter, view));
}

it('a renamed Gemini code host exports one fenced source with its language instead of duplicate prose', () => {
  const reply = page(`<p>Example</p>${block()}<p>Done</p>`);
  const result = exporter().extractAssistantContent(reply);
  expect(result.text).toBe('Example\n\n```python\nprint("first")\nprint("second")\n```\nDone');
  expect(result.hasCode).toBe(true);
  expect(result.html.match(/<pre>/g)).toHaveLength(1);
});

it('the same Gemini blocks in prose and a list export identical bytes through bundled and remote data', () => {
  const reply = page(
    `<p>Example</p>${block('code-block')}<ul><li>Nested ${block('code-block')}</li></ul><p>Done</p>`,
  );
  const bundled = exporter(getBundledGeminiSelectorView()).extractAssistantContent(reply);
  const online = exporter().extractAssistantContent(reply);
  expect(online).toEqual(bundled);
  expect(online.text.match(/```python/g)).toHaveLength(2);
  expect(online.html.match(/<pre>/g)).toHaveLength(2);
});

it('a renamed code host nested in a list keeps one indented fence and serialized HTML source', () => {
  const reply = page(`<ul><li>Nested ${block()}<p>After code</p></li></ul>`);
  const result = exporter().extractAssistantContent(reply);
  expect(result.text).toBe(
    '- Nested\n  ```python\n  print("first")\n  print("second")\n  ```\n  After code',
  );
  expect(result.html.match(/<pre>/g)).toHaveLength(1);
  expect(result.html).toContain('<code class="language-python">');
});

it('a repaired host read retains class-only compatibility blocks beside the native hosts', () => {
  const reply = page(
    `${block('code-block')}<div class="code-block"><div class="code-block-decoration">text</div><code>Compatibility source</code></div>`,
  );
  const bundled = exporter(getBundledGeminiSelectorView()).extractAssistantContent(reply);
  expect(exporter().extractAssistantContent(reply)).toEqual(bundled);
  expect(bundled.text).toContain('```text\nCompatibility source\n```');
});

it('a code alias that grows around answer prose keeps that prose and can recover later', () => {
  const reply = page(
    `<section class="wrong-owner"><p>Keep this explanation</p>${block()}</section>`,
  );
  const adapter = exporter(remote('.wrong-owner'));
  expect(adapter.extractAssistantContent(reply).text).toContain('Keep this explanation');
  const owner = reply.querySelector('.wrong-owner')!;
  owner.classList.remove('wrong-owner');
  reply.querySelector('.repaired-code')!.classList.add('wrong-owner');
  const recovered = adapter.extractAssistantContent(reply);
  expect(recovered.text).toBe(
    'Keep this explanation\n\n```python\nprint("first")\nprint("second")\n```',
  );
});

it('a code alias shared by ordinary prose exports only its proved host as code', () => {
  const reply = page(
    `<p class="repaired-code">Keep this explanation</p>${block()}<ul><li><p class="repaired-code">List explanation</p>${block()}</li></ul>`,
  );
  const result = exporter().extractAssistantContent(reply);
  expect(result.text).toBe(
    'Keep this explanation\n\n```python\nprint("first")\nprint("second")\n```\n\n- List explanation\n  ```python\n  print("first")\n  print("second")\n  ```',
  );
  expect(result.html).toContain('<p>Keep this explanation</p>');
  expect(result.html).toContain('>List explanation</p>');
  expect(result.html.match(/<pre>/g)).toHaveLength(2);
});

it('an alias matching prose on a page with no complete code host preserves the answer', () => {
  const reply = page('<p>Keep the whole answer</p><ul><li><p>Keep the list too</p></li></ul>');
  const bundled = exporter(getBundledGeminiSelectorView()).extractAssistantContent(reply);
  expect(exporter(remote('p')).extractAssistantContent(reply)).toEqual(bundled);
  expect(bundled.text).toBe('Keep the whole answer\n\n- Keep the list too');
});

it('stripping a list control does not lose the proved code host when its positional alias stops matching', () => {
  const reply = page(`<ul><li><button>Copy</button>${block()}</li></ul>`);
  const result = exporter(remote('li > :nth-child(2)')).extractAssistantContent(reply);
  const parsed = document.createElement('div');
  parsed.innerHTML = result.html;
  expect(parsed.querySelector('li > pre > code')?.textContent).toBe(
    'print("first")\nprint("second")',
  );
  expect(result.text).toContain('  ```python\n  print("first")\n  print("second")\n  ```');
});

it('an incomplete code-shaped alias cannot suppress unrelated raw code beside a proved host', () => {
  const reply = page(
    `${block()}<section class="repaired-code"><pre><code class="language-text">Keep raw source</code></pre></section>`,
  );
  const result = exporter().extractAssistantContent(reply);
  expect(result.text).toContain('```python\nprint("first")\nprint("second")\n```');
  expect(result.text).toContain('```text\nKeep raw source\n```');
});
