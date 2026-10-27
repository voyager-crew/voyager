// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvePromptSiteAdapter } from '../../prompt/resolvePromptSiteAdapter';
import { findChatInput } from '../index';
import { getVimComposerMount } from '../vimComposerMount';
import { createGeminiVimComposerResolver } from '../vimGeminiComposer';
import { createVimInputTargets, getSendButtonTarget } from '../vimInputTargets';

const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
const HOSTS = [
  'custom.example',
  'gemini.google.com',
  'aistudio.google.com',
  'chatgpt.com',
  'claude.ai',
  'chat.deepseek.com',
  'www.kimi.com',
];
function host(hostname: string) {
  Object.defineProperty(window, 'location', { configurable: true, value: { hostname } });
}
function show(element: HTMLElement) {
  element.getBoundingClientRect = () =>
    ({ width: 200, height: 30, top: 100, left: 100, bottom: 130, right: 300 }) as DOMRect;
}
afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(window, 'location', locationDescriptor);
  vi.restoreAllMocks();
});

// Reverse DOM order distinguishes candidate precedence from a single combined selector.
const GENERIC_CANDIDATES = [
  '<div data-testid="chat-input" contenteditable="true"></div>',
  '<div id="prompt-textarea" contenteditable="true"></div>',
  '<div data-composer-markdown contenteditable="true"></div>',
  '<rich-textarea><div contenteditable="true"></div></rich-textarea>',
  '<div contenteditable="true" role="textbox"></div>',
  '<section class="input-area"><textarea></textarea></section>',
  '<textarea placeholder="Ask anything"></textarea>',
  '<textarea></textarea>',
];

describe('bundled input behavior', () => {
  it.each(HOSTS)('%s keeps baseline composer precedence before a search textarea', (hostname) => {
    host(hostname);
    const candidates = GENERIC_CANDIDATES;
    for (let index = 0; index < candidates.length - 1; index++) {
      document.body.innerHTML = candidates.slice(index).reverse().join('');
      for (const element of document.querySelectorAll<HTMLElement>('textarea, [contenteditable]'))
        show(element);
      const expected = document.body.lastElementChild!;
      const field = expected.matches('textarea, [contenteditable]')
        ? expected
        : expected.querySelector('textarea, [contenteditable]');
      expect(findChatInput()).toBe(field);
      expect(
        createGeminiVimComposerResolver(() => null)({ doc: document, requireVisible: true })
          .element,
      ).toBe(field);
    }
  });

  it.each(HOSTS)(
    '%s keeps Save, Update and wrapped send controls as Vim submission targets',
    (hostname) => {
      host(hostname);
      document.body.innerHTML =
        '<button aria-label="Save"><span id="save"></span></button><button aria-label="Update"><span id="update"></span></button><div data-send-button><span id="send"></span></div>';
      for (const id of ['save', 'update', 'send']) {
        const target = document.getElementById(id)!;
        expect(getSendButtonTarget(target)).toBe(target.parentElement);
      }
    },
  );

  it.each(HOSTS)(
    '%s keeps its edited prompt and both baseline composer mount fallbacks',
    (hostname) => {
      host(hostname);
      document.body.innerHTML =
        '<textarea aria-label="Edit message"></textarea><form><div id="prompt-textarea" contenteditable="true"></div></form><fieldset><div data-testid="chat-input" contenteditable="true"></div></fieldset>';
      const edit = document.querySelector('textarea')!;
      show(edit);
      expect(createVimInputTargets(() => null).findVimInput()).toBe(edit);
      expect(getVimComposerMount(document.getElementById('prompt-textarea'), null)).toBe(
        document.querySelector('form'),
      );
      expect(getVimComposerMount(document.querySelector('[data-testid="chat-input"]'), null)).toBe(
        document.querySelector('fieldset'),
      );
    },
  );

  it('a custom host places its Prompt Manager beside the original floating action target', () => {
    host('custom.example');
    document.body.innerHTML = '<span class="mat-mdc-button-touch-target"></span>';
    show(document.querySelector('span')!);
    expect(resolvePromptSiteAdapter('https://custom.example/').defaultTriggerSpot(46)).toEqual({
      right: window.innerWidth - 90,
      bottom: window.innerHeight - 138,
    });
  });
});
