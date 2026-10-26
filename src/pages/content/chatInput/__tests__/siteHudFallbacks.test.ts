// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { createVimPresentation } from '../vimPresentation';

const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
afterEach(() => {
  Object.defineProperty(window, 'location', locationDescriptor);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each(['chatgpt.com', 'claude.ai', 'chat.deepseek.com', 'www.kimi.com', 'aistudio.google.com'])(
  '%s never places an unattached Vim HUD on an unrelated Tools button',
  (hostname) => {
    Object.defineProperty(window, 'location', { configurable: true, value: { hostname } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 30),
    );
    document.body.innerHTML =
      '<button aria-label="Tools" id="tools">Tools</button><section id="mount"><textarea id="draft">Draft</textarea></section>';
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
    expect(document.getElementById('tools')!.textContent).toBe('Tools');
    expect(document.querySelector('.gv-input-vim-hud')).toBeNull();
    context.composerSelector = '#draft';
    presentation.updateHud();
    const hud = document.querySelector('.gv-input-vim-hud')!;
    expect(hud.parentElement).toBe(document.getElementById('mount'));
    expect(hud.textContent).toContain('NORMAL');
    presentation.dispose();
  },
);
