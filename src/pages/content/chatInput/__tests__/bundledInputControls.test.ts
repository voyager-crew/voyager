// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { clearOfPromptTrigger } from '../../prompt/triggerClearance';
import { createVimInputTargets, getSendButtonTarget } from '../vimInputTargets';
import { createVimPresentation } from '../vimPresentation';

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
  setPageUrl(`https://${hostname}/`);
}

afterEach(() => {
  resetPageUrl();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each(HOSTS)(
  '%s keeps floating controls clear of the baseline input-area boundary',
  (hostname) => {
    host(hostname);
    document.body.innerHTML = '<section class="input-area"><textarea></textarea></section>';
    document.querySelector<HTMLElement>('section')!.getBoundingClientRect = () =>
      new DOMRect(100, 100, 500, 150);
    document.querySelector('textarea')!.getBoundingClientRect = () =>
      new DOMRect(150, 150, 100, 30);

    const spot = clearOfPromptTrigger({ x: 110, y: 110, w: 30, h: 30 });
    expect(spot).not.toEqual({ x: 110, y: 110 });
    expect(clearOfPromptTrigger({ ...spot, w: 30, h: 30 })).toEqual(spot);
  },
);

it.each([
  ['claude.ai', '<fieldset data-composer-card-holder>'],
  ['www.kimi.com', '<section class="chat-editor-content">'],
  ['chat.deepseek.com', '<div><div>'],
  ['aistudio.google.com', '<ms-prompt-box>'],
])('%s does not promote a new clearance owner over the baseline form', (hostname, opening) => {
  host(hostname);
  const closing =
    hostname === 'claude.ai'
      ? '</fieldset>'
      : hostname === 'www.kimi.com'
        ? '</section>'
        : hostname === 'chat.deepseek.com'
          ? '</div></div>'
          : '</ms-prompt-box>';
  document.body.innerHTML = `<form>${opening}<textarea class="ds-scroll-area"></textarea>${closing}</form>`;
  document.querySelector('form')!.getBoundingClientRect = () => new DOMRect(500, 400, 300, 150);
  for (const element of document.querySelectorAll<HTMLElement>('form *')) {
    element.getBoundingClientRect = () => new DOMRect(100, 100, 300, 50);
  }

  expect(clearOfPromptTrigger({ x: 110, y: 110, w: 30, h: 30 })).toEqual({ x: 110, y: 110 });
  expect(clearOfPromptTrigger({ x: 510, y: 410, w: 30, h: 30 })).not.toEqual({ x: 510, y: 410 });
});

it.each([
  '<button><mat-icon fonticon="send" id="target"></mat-icon></button>',
  '<button class="send-button"><span id="target"></span></button>',
  '<button class="update-button"><span id="target"></span></button>',
])('AI Studio still recognizes its original Vim submit control: %s', (markup) => {
  host('aistudio.google.com');
  document.body.innerHTML = markup;
  expect(getSendButtonTarget(document.getElementById('target'))).toBe(
    document.querySelector('button'),
  );
});

it('AI Studio keeps Vim editing and its HUD inside the original Material edit form', () => {
  host('aistudio.google.com');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 300, 30),
  );
  document.body.innerHTML =
    '<textarea id="main"></textarea><mat-form-field class="edit-form"><div class="query-content edit-mode"><textarea id="edit"></textarea></div></mat-form-field>';
  const edit = document.getElementById('edit')!;
  expect(createVimInputTargets(() => null).findVimInput()).toBe(edit);
  const presentation = createVimPresentation(
    () => ({
      activeInput: edit,
      isEnabled: true,
      mode: 'normal',
      buffer: '',
      composerSelector: null,
    }),
    () => edit,
  );
  try {
    presentation.start();
    const hud = document.querySelector('.gv-input-vim-hud');
    expect(hud?.parentElement).toBe(document.querySelector('mat-form-field'));
    expect(hud?.textContent).toContain('NORMAL');
  } finally {
    presentation.dispose();
  }
});
