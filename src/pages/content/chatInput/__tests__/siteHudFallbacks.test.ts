// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { createVimPresentation } from '../vimPresentation';

afterEach(() => {
  resetPageUrl();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each([
  'gemini.google.com',
  'chatgpt.com',
  'claude.ai',
  'chat.deepseek.com',
  'www.kimi.com',
  'aistudio.google.com',
])('%s keeps the baseline rich-textarea fallback when no earlier HUD anchor exists', (hostname) => {
  setPageUrl(`https://${hostname}/`);
  document.body.innerHTML =
    '<section id="fallback"><rich-textarea></rich-textarea></section><section id="configured"><textarea id="draft"></textarea></section>';
  const field = document.querySelector('textarea')!;
  const context = {
    activeInput: field,
    isEnabled: true,
    mode: 'normal' as const,
    buffer: '',
    composerSelector: null as string | null,
  };
  const presentation = createVimPresentation(
    () => context,
    () => field,
  );
  try {
    presentation.start();
    const hud = document.querySelector('.gv-input-vim-hud');
    expect(hud?.parentElement).toBe(document.getElementById('fallback'));
    expect(hud?.textContent).toContain('NORMAL');
    context.composerSelector = '#draft';
    presentation.updateHud();
    expect(hud?.parentElement).toBe(document.getElementById('configured'));
  } finally {
    presentation.dispose();
  }
});

it.each([
  'gemini.google.com',
  'chatgpt.com',
  'claude.ai',
  'chat.deepseek.com',
  'www.kimi.com',
  'aistudio.google.com',
])('%s keeps an Edit message HUD beside its original action buttons', (hostname) => {
  setPageUrl(`https://${hostname}/`);
  document.body.innerHTML =
    '<section id="edit"><div><textarea aria-label="Edit message"></textarea></div><button>Save</button><button>Cancel</button></section>';
  const field = document.querySelector('textarea')!;
  const presentation = createVimPresentation(
    () => ({
      activeInput: field,
      isEnabled: true,
      mode: 'normal',
      buffer: '',
      composerSelector: null,
    }),
    () => field,
  );
  try {
    presentation.start();
    const hud = document.querySelector('.gv-input-vim-hud');
    expect(hud?.parentElement).toBe(document.getElementById('edit'));
    expect(hud?.textContent).toContain('NORMAL');
  } finally {
    presentation.dispose();
  }
});

it.each(['chatgpt.com', 'claude.ai', 'chat.deepseek.com', 'www.kimi.com', 'aistudio.google.com'])(
  '%s keeps the baseline Tools HUD fallback until its configured composer mounts',
  (hostname) => {
    setPageUrl(`https://${hostname}/`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 30),
    );
    document.body.innerHTML =
      '<button aria-label="Tools" id="tools">Tools</button><aside><rich-textarea>Example Gemini widget</rich-textarea></aside><section id="mount"><textarea id="draft">Draft</textarea></section>';
    const field = document.querySelector('textarea')!;
    const context = {
      activeInput: field,
      isEnabled: true,
      mode: 'normal' as const,
      buffer: '',
      composerSelector: null as string | null,
    };
    const presentation = createVimPresentation(
      () => context,
      () => field,
    );
    presentation.start();
    const initialHud = document.querySelector('.gv-input-vim-hud');
    expect(initialHud?.parentElement).toBe(document.getElementById('tools'));
    expect(initialHud?.textContent).toContain('NORMAL');
    context.composerSelector = '#draft';
    presentation.updateHud();
    const hud = document.querySelector('.gv-input-vim-hud')!;
    expect(hud.parentElement).toBe(document.getElementById('mount'));
    expect(hud.textContent).toContain('NORMAL');
    presentation.dispose();
  },
);

// OFF retains the same fallback anchors and precedence as 6fa19b4ae.
it.each(['chatgpt.com', 'claude.ai', 'chat.deepseek.com', 'www.kimi.com', 'aistudio.google.com'])(
  '%s keeps the baseline input host until its configured composer takes precedence',
  (hostname) => {
    setPageUrl(`https://${hostname}/`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 30),
    );
    document.body.innerHTML =
      '<section class="text-input-field"><div id="owner"><textarea id="draft">Draft</textarea></div></section>';
    const field = document.querySelector('textarea')!;
    const context = {
      activeInput: field,
      isEnabled: true,
      mode: 'normal' as const,
      buffer: '',
      composerSelector: null as string | null,
    };
    const presentation = createVimPresentation(
      () => context,
      () => field,
    );
    presentation.start();
    expect(document.querySelector('.gv-input-vim-hud')?.parentElement).toBe(
      document.querySelector('.text-input-field'),
    );
    context.composerSelector = '#draft';
    presentation.updateHud();
    const hud = document.querySelector('.gv-input-vim-hud')!;
    expect(hud.parentElement).toBe(document.getElementById('owner'));
    expect(hud.textContent).toContain('NORMAL');
    presentation.dispose();
  },
);
