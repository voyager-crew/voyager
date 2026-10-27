// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { type ConversationAnchors, alignToConversationCenter } from '../exportOverlayUi';

const cleanups: Array<() => void> = [];
const noAnchors: ConversationAnchors = {
  topUserElement: () => null,
  conversationRoot: () => document.body,
};
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
});
function place(selector: string, left: number, width: number, height = 600) {
  const element = document.querySelector<HTMLElement>(selector)!;
  element.getBoundingClientRect = () => ({
    left,
    width,
    height,
    top: 0,
    bottom: height,
    right: left + width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
  return element;
}
function align(anchors = noAnchors) {
  const bar = document.createElement('div');
  document.body.append(bar);
  cleanups.push(alignToConversationCenter(bar, anchors));
  return bar;
}

it('aligns the same bar over the same canvas with bundled and online profiles', async () => {
  document.body.innerHTML = '<div id="chat-history" class="canvas"></div>';
  place('.canvas', 300, 600);
  const bundled = align();
  cleanups.push(await installGeminiSelectorPatch({ 'exportOverlay.canvas': ['.canvas'] }));
  expect(align().style.left).toBe(bundled.style.left);
  expect(align().style.left).toBe('600px');
});

it('moves the bar to a renamed canvas without requiring turn ownership', async () => {
  document.body.innerHTML = '<section class="new-canvas"><div class="turn"></div></section>';
  const root = place('.new-canvas', 500, 500);
  const turn = place('.turn', 600, 100, 40);
  const anchors = { conversationRoot: () => root, topUserElement: () => turn };
  expect(align(anchors).style.left).toBe('650px');
  cleanups.push(await installGeminiSelectorPatch({ 'exportOverlay.canvas': ['.new-canvas'] }));
  expect(align(anchors).style.left).toBe('750px');
});

it('does not move to the composer when an online canvas list misses the visible bundled canvas', async () => {
  document.body.innerHTML =
    '<div id="chat-history"></div><input-area><textarea class="new-input"></textarea></input-area>';
  place('#chat-history', 300, 600);
  place('.new-input', 500, 480, 80);
  cleanups.push(
    await installGeminiSelectorPatch({
      'exportOverlay.canvas': ['.missing'],
      'exportOverlay.composer': ['.new-input'],
    }),
  );
  expect(align().style.left).toBe('600px');
});

it('aligns with a renamed composer layout region', async () => {
  document.body.innerHTML = '<section class="new-input"></section>';
  place('.new-input', 350, 600, 80);
  expect(align().style.left).toBe(`${Math.round(window.innerWidth / 2)}px`);
  cleanups.push(await installGeminiSelectorPatch({ 'exportOverlay.composer': ['.new-input'] }));
  expect(align().style.left).toBe('650px');
});

it('rejects an editable alignment target and keeps viewport alignment', async () => {
  document.body.innerHTML =
    '<input-area><textarea class="chosen"></textarea><textarea></textarea></input-area>';
  place('.chosen', 350, 600, 80);
  cleanups.push(await installGeminiSelectorPatch({ 'exportOverlay.composer': ['.chosen'] }));
  expect(align().style.left).toBe(`${Math.round(window.innerWidth / 2)}px`);
});
