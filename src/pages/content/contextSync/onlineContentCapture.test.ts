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
const texts = async () => (await capture()).map((node) => [node.text, node.is_user_likely]);

it('context body repairs capture the same native dialogue on the same DOM', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><div class="user-query-container user-body">Question</div><button>Edit</button></user-query><model-response><div class="response-content reply-body">Answer</div><button>Copy</button></model-response></div>';
  const bundled = await capture();
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual(bundled);
  expect(bundled.map((node) => [node.text, node.is_user_likely])).toEqual([
    ['Question', true],
    ['Answer', false],
  ]);
});

it('renamed context bodies recover every prompt and reply without native action labels', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><section class="user-body">First question</section><button>Edit</button></user-query><model-response><section class="reply-body"><p>First answer</p></section><message-actions>Copy</message-actions></model-response></div><div class="conversation-container"><user-query><section class="user-body">Latest question</section></user-query><model-response><section class="reply-body">Latest answer</section></model-response></div>';
  expect(await capture()).toEqual([]);
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await texts()).toEqual([
    ['First question', true],
    ['First answer', false],
    ['Latest question', true],
    ['Latest answer', false],
  ]);
});

it('a partial context body repair preserves every original message', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><div class="user-query-container user-body">First question</div></user-query><model-response><div class="response-content reply-body">First answer</div></model-response></div><div class="conversation-container"><user-query><div class="user-query-container">Latest question</div></user-query><model-response><div class="response-content">Latest answer</div></model-response></div>';
  const bundled = await capture();
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual(bundled);
  expect(bundled).toHaveLength(4);
});

it('a preview with the same context text cannot replace an original extraction boundary', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><div class="user-query-container">Question</div><div class="user-body">Question</div></user-query><model-response><div class="response-content reply-body">Answer</div></model-response></div>';
  const bundled = await capture();
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual(bundled);
  expect(bundled[0].text).toBe('Question');
});

it('a wider context wrapper cannot change the captured native message identity', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><section class="user-body"><div class="user-query-container">Question</div></section></user-query><model-response><div class="response-content reply-body">Answer</div></model-response></div>';
  const bundled = await capture();
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual(bundled);
  expect(bundled[0].className).toBe('user-query-container');
});

it('a first-line context alias cannot truncate a renamed prompt and can later recover its whole body', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><section class="whole"><span id="candidate">Explain the proof</span><span>Keep every step</span></section></user-query><model-response><section class="reply-body">Answer</section></model-response></div>';
  stop = await installGeminiSelectorPatch({
    'context.users': ['#candidate'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual([]);
  document.getElementById('candidate')!.removeAttribute('id');
  document.querySelector('.whole')!.id = 'candidate';
  expect(await texts()).toEqual([
    ['Explain the proofKeep every step', true],
    ['Answer', false],
  ]);
});

it('a context alias cannot strip a native list frame even when it preserves all text', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><ul class="whole"><li><span id="candidate">One list item</span></li></ul></user-query><model-response><section class="reply-body">Answer</section></model-response></div>';
  stop = await installGeminiSelectorPatch({
    'context.users': ['#candidate'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual([]);
  document.getElementById('candidate')!.removeAttribute('id');
  document.querySelector('user-query')!.id = 'candidate';
  expect(await texts()).toEqual([
    ['One list item', true],
    ['Answer', false],
  ]);
});

it('context aliases outside native turns cannot leak a preview into a recovered conversation', async () => {
  document.body.innerHTML =
    '<section class="user-body">Private preview</section><div class="conversation-container"><user-query><section class="user-body">Question</section></user-query><model-response><section class="reply-body">Answer</section></model-response></div>';
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual([]);
  document.body.firstElementChild!.remove();
  expect(await texts()).toEqual([
    ['Question', true],
    ['Answer', false],
  ]);
});

it('duplicate context bodies with shared text cannot certify one extraction target', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><user-query><section class="user-body"><span class="user-body">Question</span></section></user-query><model-response><section class="reply-body">Answer</section></model-response></div>';
  stop = await installGeminiSelectorPatch({
    'context.users': ['.user-body'],
    'context.responses': ['.reply-body'],
  });
  expect(await capture()).toEqual([]);
  document.querySelector('.user-body .user-body')!.removeAttribute('class');
  expect(await texts()).toEqual([
    ['Question', true],
    ['Answer', false],
  ]);
});
