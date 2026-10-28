// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledSiteSelectorView, initializeSiteSelectors } from '@/core/selectors';
import { findSiteChatInput } from '@/core/services/composer/siteInputReads';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { findHandoffComposer } from '../../researchPack/receiver';
import { createGeminiVimComposerResolver } from '../vimGeminiComposer';

const HOSTS = {
  aistudio: 'aistudio.google.com',
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
  deepseek: 'chat.deepseek.com',
  kimi: 'www.kimi.com',
} as const;
const REMOTE_INPUT_SITES = ['aistudio', 'chatgpt', 'claude', 'kimi'] as const;
function nativeInput(site: keyof typeof HOSTS, field: string): string {
  switch (site) {
    case 'aistudio':
      return `<ms-prompt-box>${field}<button>Run</button></ms-prompt-box>`;
    case 'chatgpt':
      return `<form data-chatgpt-composer>${field}<button>Send</button></form>`;
    case 'claude':
      return `<div data-composer-card-holder><div>${field}<button>Send</button></div></div>`;
    case 'kimi':
      return `<div class="chat-editor-content">${field}<button>Send</button></div>`;
    case 'deepseek':
      return `<div><div>${field}</div><button>Send</button></div>`;
  }
}
const stops: Array<() => void> = [];
const input = (id: string): HTMLElement => document.getElementById(id)!;
function show() {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[contenteditable], textarea, button',
  )) {
    element.getBoundingClientRect = () => ({ width: 300, height: 30 }) as DOMRect;
    Object.defineProperty(element, 'offsetParent', { configurable: true, value: document.body });
  }
}
async function patch(
  site: keyof typeof HOSTS,
  locators: Record<string, readonly string[]>,
  selectors?: Record<string, string>,
) {
  setPageUrl(`https://${HOSTS[site]}/`);
  const lifetime = new AbortController();
  const session = initializeSiteSelectors(site, {
    host: HOSTS[site],
    doc: document,
    lifetime: lifetime.signal,
    bundledRevision: 0,
    read: async () => ({ id: site, catalogRevision: 1, locators, selectors }),
  });
  stops.push(session.stop);
  await session.ready;
}
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  resetPageUrl();
  vi.restoreAllMocks();
});

describe('site-owned input profiles', () => {
  it.each(Object.keys(HOSTS) as Array<keyof typeof HOSTS>)(
    '%s keeps the same ordered visible and hidden composers through remote and bundled reads',
    async (site) => {
      document.body.innerHTML =
        '<div id="first" class="input" contenteditable="true" role="textbox">first</div><div id="second" class="input" contenteditable="true" role="textbox">second</div>';
      show();
      const bundled = findSiteChatInput(site);
      await patch(site, { 'input.candidates': ['.input'] });
      expect(findSiteChatInput(site)).toBe(bundled);
      input('first').getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
      expect(findSiteChatInput(site)).toBe(input('second'));
      input('second').getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
      expect(findSiteChatInput(site, { requireVisible: false })).toBe(input('first'));
    },
  );

  it.each(REMOTE_INPUT_SITES)(
    '%s repairs an editor only when its native send unit owns it',
    async (site) => {
      document.body.innerHTML =
        nativeInput(site, '<div id="repair" contenteditable="plaintext-only">draft</div>') +
        '<aside><div id="decoy" contenteditable="plaintext-only">history</div></aside>';
      show();
      expect(findSiteChatInput(site)).toBeNull();
      await patch(site, { 'input.candidates': ['#repair'] });
      expect(findSiteChatInput(site)).toBe(input('repair'));
      await patch(site, { 'input.candidates': ['#decoy'] });
      expect(findSiteChatInput(site)).toBeNull();
      expect(input('repair').textContent).toBe('draft');
    },
  );

  it.each([
    { site: 'aistudio', owner: '<section data-turn-role="Model">' },
    { site: 'chatgpt', owner: '<section data-chatgpt-selection-message-id="reply">' },
    { site: 'claude', owner: '<section class="font-claude-message">' },
    { site: 'kimi', owner: '<section class="segment-assistant">' },
  ] as const)(
    '$site reply editors cannot prove a repaired main composer',
    async ({ site, owner }) => {
      document.body.innerHTML = `${owner}${nativeInput(site, '<div id="repair" contenteditable="plaintext-only">reply draft</div>')}</section>`;
      show();
      await patch(site, { 'input.candidates': ['#repair'] });
      expect(findSiteChatInput(site)).toBeNull();
      expect(input('repair').textContent).toBe('reply draft');
      document.body.innerHTML = nativeInput(
        site,
        '<div id="repair" contenteditable="plaintext-only">reply draft</div>',
      );
      show();
      expect(findSiteChatInput(site)).toBe(input('repair'));
    },
  );

  it.each(REMOTE_INPUT_SITES)(
    '%s does not mistake a profile bio and Submit button for the main composer',
    async (site) => {
      document.body.innerHTML =
        '<form id="profile"><div id="bio" contenteditable="plaintext-only">bio</div><button type="submit">Submit</button></form>';
      show();
      await patch(site, { 'input.candidates': ['#bio'] });
      expect(findSiteChatInput(site)).toBeNull();
      expect(input('bio').textContent).toBe('bio');
      document.body.insertAdjacentHTML(
        'beforeend',
        nativeInput(site, '<div id="main" contenteditable="plaintext-only">draft</div>'),
      );
      show();
      await patch(site, { 'input.candidates': ['#main'] });
      expect(findSiteChatInput(site)).toBe(input('main'));
    },
  );

  it('a partial input list cannot move insertion to the second draft', async () => {
    document.body.innerHTML =
      '<div id="first" contenteditable="true" role="textbox">first</div><div id="second" contenteditable="true" role="textbox">second</div>';
    show();
    await patch('claude', { 'input.candidates': ['#second'] });
    expect(findSiteChatInput('claude')).toBe(input('first'));
    expect(input('second').textContent).toBe('second');
  });

  it('a repaired Vim field and its HUD keep one view while a foreign configured editor falls back', async () => {
    document.body.innerHTML =
      nativeInput('claude', '<div id="repair" contenteditable="plaintext-only">draft</div>') +
      '<aside><div id="decoy" contenteditable="plaintext-only">history</div></aside>';
    show();
    const configured = getBundledSiteSelectorView('claude').profiles.composer.join(',');
    await patch('claude', { 'vim.candidates': ['#repair'] }, { composer: '#repair' });
    const resolve = createGeminiVimComposerResolver(() => configured);
    const accepted = resolve({ doc: document, requireVisible: true });
    expect(accepted.element).toBe(input('repair'));
    expect(accepted.repaired).toBe(true);
    await patch('claude', { 'vim.candidates': ['#repair'] }, { composer: '#decoy' });
    expect(resolve({ doc: document, requireVisible: true }).element).toBeNull();
  });

  it('a handoff fixes the main editor and refuses another editor from the same patch', async () => {
    document.body.innerHTML =
      nativeInput('chatgpt', '<div id="repair" contenteditable="plaintext-only"></div>') +
      '<aside><div id="decoy" contenteditable="plaintext-only">history</div></aside>';
    show();
    await patch('chatgpt', { 'input.handoff': ['#repair'] });
    expect(findHandoffComposer('chatgpt')).toBe(input('repair'));
    await patch('chatgpt', { 'input.handoff': ['#decoy'] });
    expect(findHandoffComposer('chatgpt')).toBeNull();
    expect(input('decoy').textContent).toBe('history');
  });
});
