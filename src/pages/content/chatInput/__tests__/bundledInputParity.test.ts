// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledSiteSelectorView } from '@/core/selectors';
import { SEND_SITE_POLICIES } from '@/core/services/composer/sendKeys/sendSitePolicies';
import { inputSiteId, packagedInputSelectors } from '@/core/services/composer/siteInputData';

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

// Compatibility contract copied from findChatInput at 6fa19b4ae, not from current data.
const BASELINE_CANDIDATES = [
  '[data-testid="chat-input"][contenteditable="true"]',
  '#prompt-textarea[contenteditable="true"]',
  '[data-composer-markdown][contenteditable="true"]',
  'rich-textarea [contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  '.input-area textarea',
  'textarea[placeholder*="Ask"]',
  'textarea',
];

// Literal compatibility contracts from 6fa19b4ae, before these shared lists moved into site data.
const BASELINE_PACKAGED_PROFILES = {
  // prompt/triggerClearance.ts: composerElement
  'input.clearance': [
    'form, .text-input-field, input-area-v2, input-container, .input-area, ms-prompt-input-wrapper, chat-message',
  ],
  // chatInput/vimInputTargets.ts: SEND_BUTTON_SELECTOR
  'vim.sendTarget': [
    '.update-button',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[data-tooltip*="Send"]',
    'button[data-tooltip*="send"]',
    'button mat-icon[fonticon="send"]',
    '[data-send-button]',
    '.send-button',
    'button[aria-label*="Update"]',
    'button[aria-label*="Save"]',
    'button[aria-label*="更新"]',
  ],
  // chatInput/vimPresentation.ts: queryHudMountCandidates
  'vim.hud': [
    'toolbox-drawer .toolbox-drawer-button-label-icon-text',
    'toolbox-drawer .toolbox-drawer-button-label',
    'toolbox-drawer .toolbox-drawer-button-container',
    'toolbox-drawer button',
    'toolbox-drawer .toolbox-drawer-container',
    '[class*="toolbox-drawer"] .toolbox-drawer-button-label-icon-text',
    '[class*="toolbox-drawer"] button',
    'button[aria-label*="Tools"]',
    'button[aria-label*="tools"]',
    'button[aria-label*="工具"]',
    'button[aria-label*="ツール"]',
    'button[aria-label*="도구"]',
  ],
};

// composer/sendKeys/sendSitePolicies.ts at 6fa19b4ae: both native send policies shared this order.
const BASELINE_SEND_CONTAINERS = [
  '.text-input-field',
  'ms-prompt-box',
  'ms-prompt-input-wrapper',
  'ms-prompt-input',
  'ms-chat-turn-input',
  'ms-autosize-textarea',
  '.prompt-input-wrapper',
  '.prompt-input-container',
  '.user-query-container.edit-mode',
  '.edit-container',
  'chat-message',
  'form',
  '[role="dialog"]',
  '.mat-mdc-dialog-container',
];

describe('bundled input parity', () => {
  it.each(HOSTS)('%s bundled input and Vim candidates equal baseline order', (hostname) => {
    host(hostname);
    const site = inputSiteId();
    if (!site) {
      expect(packagedInputSelectors('input.candidates')).toEqual(BASELINE_CANDIDATES);
      expect(packagedInputSelectors('vim.candidates')).toEqual(BASELINE_CANDIDATES);
      return;
    }
    const profiles = getBundledSiteSelectorView(site).profiles;
    const input = profiles[site === 'gemini' ? 'composer.candidates' : 'input.candidates'];
    expect(input).toEqual(BASELINE_CANDIDATES);
    expect(profiles['vim.candidates'] ?? input).toEqual(BASELINE_CANDIDATES);
  });

  describe.each(Object.entries(BASELINE_PACKAGED_PROFILES))(
    '%s baseline contract',
    (key, expected) => {
      it.each(HOSTS)('%s retains every bundled candidate in baseline order', (hostname) => {
        host(hostname);
        expect(packagedInputSelectors(key)).toEqual(expected);
      });
    },
  );

  it.each(['gemini', 'aistudio'] as const)(
    '%s retains every bundled send container in baseline order',
    (site) => {
      expect(SEND_SITE_POLICIES[site].sendContainerSelectors).toEqual(BASELINE_SEND_CONTAINERS);
    },
  );

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
