import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../__tests__/geminiOnlineSelectorFixture';
import { ContextCaptureService } from './capture';

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('location', new URL('https://gemini.google.com/app/test'));
  Object.defineProperty(window, 'location', { configurable: true, value: location });
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      return this.textContent ?? '';
    },
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { innerText?: string }).innerText;
});

const capture = () => ContextCaptureService.getInstance().captureDialogue();

it('repaired turn hosts capture the same existing message contents on the same DOM', async () => {
  document.body.innerHTML = `<div class="conversation-container"><user-query class="user-fix"><div class="user-query-container user-fix">Prompt</div><button>Edit</button></user-query><model-response class="answer-fix"><div class="response-content">Answer</div><button>Copy</button></model-response></div>`;
  const bundled = await capture();
  stop = await installGeminiSelectorPatch({
    'turn.userWithHosts': ['.user-fix'],
    'turn.assistantWithHosts': ['.answer-fix'],
  });
  expect(await capture()).toEqual(bundled);
  expect(bundled.map((node) => [node.text, node.is_user_likely])).toEqual([
    ['Prompt', true],
    ['Answer', false],
  ]);
});

it.each(['primary', 'hosts'] as const)(
  'renamed %s turns still capture every prompt and answer in order',
  async (kind) => {
    document.body.innerHTML = `<div class="conversation-container"><section class="user-fix">First prompt</section><section class="answer-fix">First answer</section></div>
    <div class="conversation-container"><section class="user-fix">Latest prompt</section><section class="answer-fix">Latest answer</section></div>`;
    stop = await installGeminiSelectorPatch(
      kind === 'hosts'
        ? {
            'turn.userWithHosts': ['.user-fix'],
            'turn.assistantWithHosts': ['.answer-fix'],
          }
        : { 'turn.user': ['.user-fix'], 'turn.assistant': ['.answer-fix'] },
    );
    expect((await capture()).map((node) => [node.text, node.is_user_likely])).toEqual([
      ['First prompt', true],
      ['First answer', false],
      ['Latest prompt', true],
      ['Latest answer', false],
    ]);
  },
);

it('a partial turn repair falls back to all original captured messages', async () => {
  document.body.innerHTML = `<div class="conversation-container"><div class="user-query-container user-fix">First prompt</div><model-response class="answer-fix"><div class="response-content">First answer</div></model-response></div>
    <div class="conversation-container"><div class="user-query-container">Latest prompt</div><model-response><div class="response-content">Latest answer</div></model-response></div>`;
  const original = await capture();
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.user-fix'],
    'turn.assistant': ['.answer-fix'],
  });
  expect(await capture()).toEqual(original);
  expect(original.map((node) => node.text)).toEqual([
    'First prompt',
    'First answer',
    'Latest prompt',
    'Latest answer',
  ]);
});

it('unowned aliases cannot enter context capture but their later complete turns can', async () => {
  document.body.innerHTML =
    '<section class="user-fix">Private draft</section><section class="answer-fix">Preview</section>';
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.user-fix'],
    'turn.assistant': ['.answer-fix'],
  });
  expect(await capture()).toEqual([]);
  document.body.innerHTML =
    '<div class="conversation-container"><section class="user-fix">Sent prompt</section><section class="answer-fix">Original answer</section></div>';
  expect((await capture()).map((node) => node.text)).toEqual(['Sent prompt', 'Original answer']);
});

it('an earlier image request cannot replace a later proved answer with content from another page state', async () => {
  document.body.innerHTML = `<div class="conversation-container"><section class="user-fix">Prompt<user-query-file-preview><img src="https://example.com/prompt.png"></user-query-file-preview></section><section class="answer-fix">Proved answer</section></div>`;
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.user-fix'],
    'turn.assistant': ['.answer-fix'],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      document.querySelector('.answer-fix')!.textContent = 'Unproved later preview';
      return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
    }),
  );
  const captured = await capture();
  expect(captured.map((node) => node.text)).toEqual(['Prompt', 'Proved answer']);
  expect(captured[0].images).toHaveLength(1);
  expect(document.querySelector('.answer-fix')?.textContent).toBe('Unproved later preview');
});

it.each([
  'model-thoughts',
  'deep-research-immersive-panel',
  'div class="thoughts-container"',
  'div class="thoughts-content"',
])('capture aliases inside %s cannot add a hidden prompt or answer', async (excluded) => {
  const tag = excluded.split(' ')[0];
  document.body.innerHTML = `<div class="conversation-container"><section class="user-fix">Real prompt</section><section class="answer-fix">Real answer</section></div><${excluded}><section class="user-fix">Hidden thought prompt</section><section class="answer-fix">Hidden thought answer</section></${tag}>`;
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.user-fix'],
    'turn.assistant': ['.answer-fix'],
  });
  expect((await capture()).map((node) => [node.text, node.is_user_likely])).toEqual([
    ['Real prompt', true],
    ['Real answer', false],
  ]);
});

it('renamed capture hosts exclude native actions and thoughts from their saved text', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><section class="user-fix">Sent prompt<button>Edit prompt</button></section><section class="answer-fix">Real answer<message-actions><button>Copy</button></message-actions><model-thoughts>Hidden thought</model-thoughts></section></div>';
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.user-fix'],
    'turn.assistant': ['.answer-fix'],
  });
  expect((await capture()).map((node) => node.text)).toEqual(['Sent prompt', 'Real answer']);
});

it('old extraction aliases inside thoughts cannot replace a repaired message body', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><section class="user-fix">Sent prompt<model-thoughts><div class="user-query-container">Hidden prompt</div></model-thoughts></section><section class="answer-fix">Real answer<model-thoughts><div class="response-content">Hidden answer</div></model-thoughts></section></div>';
  stop = await installGeminiSelectorPatch({
    'turn.user': ['.user-fix'],
    'turn.assistant': ['.answer-fix'],
  });
  expect((await capture()).map((node) => node.text)).toEqual(['Sent prompt', 'Real answer']);
});
