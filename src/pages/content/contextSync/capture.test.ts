import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../__tests__/geminiOnlineSelectorFixture';
import { ContextCaptureService } from './capture';

const cleanups: Array<() => void> = [];
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) })),
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { innerText?: string }).innerText;
});

it('captures the same dialogue and attachment request order under bundled and online image profiles', async () => {
  document.body.innerHTML =
    '<div class="user-query-container">Prompt<user-query-file-preview><img class="image" src="https://example.com/user.png"></user-query-file-preview></div><div class="response-content">Answer<single-image><img class="image" src="https://example.com/one.png"><img class="image" src="https://example.com/two.png"></single-image></div>';
  const bundled = await ContextCaptureService.getInstance().captureDialogue();
  const calls = vi.mocked(fetch).mock.calls.map(([url]) => url);
  vi.mocked(fetch).mockClear();
  cleanups.push(await installGeminiSelectorPatch({ 'context.images': ['.image'] }));
  const online = await ContextCaptureService.getInstance().captureDialogue();
  expect(online).toEqual(bundled);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(calls);
  expect(calls).toEqual([
    'https://example.com/user.png',
    'https://example.com/one.png',
    'https://example.com/two.png',
  ]);
  expect(online.map((node) => node.images?.length)).toEqual([1, 2]);
});

it('a later partial response rejects the whole capture before any early repaired image is fetched', async () => {
  document.body.innerHTML =
    '<div class="user-query-container">Prompt</div><div class="response-content">First<div data-full-size-image-uri="https://example.com/early-full.png"><img class="image" src="https://example.com/early.png"></div></div><div class="response-content">Second<single-image><img class="image" src="https://example.com/one.png"><img src="https://example.com/two.png"></single-image></div>';
  cleanups.push(await installGeminiSelectorPatch({ 'context.images': ['.image'] }));
  const nodes = await ContextCaptureService.getInstance().captureDialogue();
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    'https://example.com/one.png',
    'https://example.com/two.png',
  ]);
  expect(nodes.map((node) => node.images?.length)).toEqual([0, 0, 2]);
});

it('a failed online image query still captures every bundled attachment in order', async () => {
  document.body.innerHTML =
    '<div class="response-content">Answer<single-image><img src="https://example.com/one.png"><img src="https://example.com/two.png"></single-image></div>';
  cleanups.push(await installGeminiSelectorPatch({ 'context.images': ['.image'] }));
  const query = Element.prototype.querySelectorAll;
  vi.spyOn(Element.prototype, 'querySelectorAll').mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    if (selector === '.image') throw new DOMException('Unsupported clone query', 'SyntaxError');
    return query.call(this, selector);
  });
  const nodes = await ContextCaptureService.getInstance().captureDialogue();
  expect(nodes.map((node) => node.images?.length)).toEqual([2]);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    'https://example.com/one.png',
    'https://example.com/two.png',
  ]);
});

it('with online fixes off, later message preparation still follows the earlier image await', async () => {
  document.body.innerHTML =
    '<div class="user-query-container">Prompt<user-query-file-preview><img src="https://example.com/user.png"></user-query-file-preview></div><div class="response-content">Streaming answer</div>';
  vi.mocked(fetch).mockImplementation(async () => {
    document.querySelector('.response-content')!.textContent = 'Finished answer';
    return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) } as Response;
  });
  const nodes = await ContextCaptureService.getInstance().captureDialogue();
  expect(nodes.map((node) => node.text)).toEqual(['Prompt', 'Finished answer']);
  expect(nodes.map((node) => node.images?.length)).toEqual([1, 0]);
});
