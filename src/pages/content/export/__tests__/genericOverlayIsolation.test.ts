// @vitest-environment-options { "url": "https://custom.example/chat" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { alignToConversationCenter } from '../exportOverlayUi';

const stops: Array<() => void> = [];
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.replaceChildren();
});

it('a custom export keeps its original alignment while Gemini has a repaired canvas', async () => {
  document.body.innerHTML = '<section class="repaired"><div class="turn">Question</div></section>';
  const root = document.querySelector<HTMLElement>('section')!;
  const turn = document.querySelector<HTMLElement>('.turn')!;
  root.getBoundingClientRect = () => new DOMRect(500, 0, 500, 600);
  turn.getBoundingClientRect = () => new DOMRect(600, 0, 100, 40);
  const align = () => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    stops.push(
      alignToConversationCenter(bar, {
        conversationRoot: () => root,
        topUserElement: () => turn,
      }),
    );
    return bar;
  };
  expect(align().style.left).toBe('650px');
  stops.push(await installGeminiSelectorPatch({ 'exportOverlay.canvas': ['.repaired'] }));
  expect(align().style.left).toBe('650px');
});
