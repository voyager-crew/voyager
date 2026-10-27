import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { startSentPromptChips, type SentPromptChipsController } from '../SentPromptChips';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
let retire: (() => void) | undefined;
let chips: SentPromptChipsController | undefined;
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
  document.body.innerHTML = '';
});
afterEach(() => {
  Object.defineProperty(window, 'location', originalLocation);
  chips?.destroy();
  retire?.();
  chips = undefined;
  retire = undefined;
  document.body.innerHTML = '';
});
const prompts = [{ id: 'p', name: 'Review', text: 'Review this carefully.' }];
function start() {
  chips = startSentPromptChips({ prompts, scheme: () => 'light' });
}
function appearance() {
  return Array.from(document.querySelectorAll('.gv-pm-sent')).map((chip) => ({
    parent: chip.parentElement?.id,
    previous: chip.previousElementSibling?.className,
    text: chip.textContent,
  }));
}
function bubbles() {
  document.body.innerHTML =
    '<user-query><div id="one" class="user-query-container"><div class="query-text"><div class="query-text-line">Review this carefully. One</div></div><div class="luminous-toggle-container"></div></div></user-query><user-query><div id="two" class="user-query-container"><div class="query-text"><div class="query-text-line">Review this carefully. Two</div></div></div></user-query>';
}

describe('online sent prompt chips', () => {
  it('keeps chip words, native hidden lines and insertion anchors with equivalent bubbles', async () => {
    bubbles();
    start();
    const bundled = appearance();
    chips!.destroy();
    retire = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['#one, #two'] });
    start();
    expect(appearance()).toEqual(bundled);
    expect(document.querySelectorAll('.gv-pm-sent-line')).toHaveLength(2);
    expect(
      document
        .querySelector('.luminous-toggle-container')
        ?.classList.contains('gv-pm-sent-toggle-hidden'),
    ).toBe(true);
    expect(bundled.map((item) => item.parent)).toEqual(['one', 'two']);
  });

  it('partial and wrong bubble matches fall back before hiding or mounting any message', async () => {
    bubbles();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<model-response id="wrong"><div class="query-text-line">Review this carefully. Fake</div></model-response>',
    );
    for (const selectors of [['#two'], ['#wrong']]) {
      retire = await installGeminiSelectorPatch({ 'sentChips.bubbles': selectors });
      start();
      expect(appearance().map((item) => item.parent)).toEqual(['one', 'two']);
      expect(document.querySelector('#wrong .query-text-line')?.className).toBe('query-text-line');
      chips!.destroy();
      retire();
    }
  });

  it('a native-looking user turn inside response content cannot become the chip mount', async () => {
    document.body.innerHTML =
      '<user-query id="one"><p class="query-text-line">Review this carefully. One</p></user-query><model-response><user-query id="wrong"><p class="query-text-line">Review this carefully. Fake</p></user-query></model-response>';
    retire = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['user-query'] });
    start();
    expect(document.querySelector('#wrong .query-text-line')?.className).toBe('query-text-line');
    chips!.destroy();
    retire();
    retire = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['body > user-query'] });
    start();
    expect(appearance().map((item) => item.parent)).toEqual(['one']);
  });

  it('a trusted anchor can place chips outside a separately proved user bubble', async () => {
    document.body.innerHTML =
      '<section id="placement"><user-query id="one"><p class="query-text-line">Review this carefully. One</p></user-query></section>';
    retire = await installGeminiSelectorPatch({
      'sentChips.bubbles': ['user-query'],
      'sentChips.anchor': ['#placement'],
    });
    start();
    expect(
      document.querySelector('#placement')?.nextElementSibling?.classList.contains('gv-pm-sent'),
    ).toBe(true);
    expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
  });

  it('a Gemini placement patch cannot change chip placement on another host', async () => {
    bubbles();
    retire = await installGeminiSelectorPatch({ 'sentChips.anchor': ['user-query'] });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'chatgpt.com' },
    });
    start();
    expect(appearance().map((item) => item.parent)).toEqual(['one', 'two']);
    chips!.destroy();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'gemini.google.com' },
    });
    start();
    expect(document.body.querySelectorAll(':scope > .gv-pm-sent')).toHaveLength(2);
  });

  it('renamed bubbles use every independently native user turn and keep packaged anchors', async () => {
    document.body.innerHTML =
      '<user-query id="one"><p class="query-text-line">Review this carefully. One</p></user-query><user-query id="two"><p class="query-text-line">Review this carefully. Two</p></user-query><model-response id="wrong"><p class="query-text-line">Review this carefully. Fake</p></model-response>';
    retire = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['user-query'] });
    start();
    expect(appearance().map((item) => item.parent)).toEqual(['one', 'two']);
    chips!.destroy();
    retire();
    retire = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['#wrong'] });
    start();
    expect(document.querySelector('#wrong .query-text-line')?.className).toBe('query-text-line');
    expect(document.querySelector('#one')?.textContent).toBe('Review this carefully. One');
  });
});
