// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { createVimPresentation } from '../vimPresentation';

let retire = () => {};
let dispose = () => {};
afterEach(() => {
  dispose();
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('a catalog HUD alias cannot move the packaged Tools-button decoration', async () => {
  document.body.innerHTML =
    '<toolbox-drawer><button aria-label="Tools" id="tools"><span class="toolbox-drawer-button-label" id="label">Tools</span></button></toolbox-drawer><section id="remote"></section>';
  for (const element of document.querySelectorAll<HTMLElement>('*'))
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 40));
  const presentation = createVimPresentation(
    () => ({
      activeInput: null,
      isEnabled: true,
      mode: 'normal',
      buffer: '',
      composerSelector: null,
    }),
    () => null,
  );
  dispose = presentation.dispose;
  presentation.updateHud();
  const bundled = document.querySelector('.gv-input-vim-hud')?.parentElement;
  expect(bundled).toBe(document.getElementById('label'));
  const run = initializeSiteSelectors('gemini', {
    host: 'gemini.google.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'gemini', catalogRevision: 1, locators: { 'vim.hud': ['#remote'] } }),
  });
  retire = run.stop;
  await run.ready;
  presentation.updateHud();
  expect(document.querySelector('.gv-input-vim-hud')?.parentElement).toBe(bundled);
  expect(document.querySelector('.gv-input-vim-hud')?.textContent).toContain('VIM');
});
