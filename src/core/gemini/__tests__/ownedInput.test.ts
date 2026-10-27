import { afterEach, describe, expect, it } from 'vitest';

import { findOwnedGeminiMainInputs } from '../composer/ownedInput';

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

describe('native input identity beneath Voyager decorations', () => {
  it('retains a hidden native draft after collapse, Vim HUD and slash token decoration', () => {
    document.body.className = 'gv-platform-themed gv-rtl';
    document.body.innerHTML = `<input-area class="gv-input-collapsed gv-input-collapse-processed gv-input-vim-hud-composer-mount">
      <section id="draft" contenteditable="plaintext-only" style="display:none"
        class="gv-input-vim-mode-normal gv-pm-slash-contenteditable-hide-value">draft</section>
      </input-area>`;
    const draft = document.getElementById('draft')!;
    expect(findOwnedGeminiMainInputs(document)).toEqual([draft]);
    draft.className = '';
    draft.style.display = '';
    expect(findOwnedGeminiMainInputs(document)).toEqual([draft]);
  });

  it.each([
    '<div class="gv-pm-panel"><textarea id="wrong"></textarea></div>',
    '<model-response><textarea id="wrong"></textarea></model-response>',
    '<div role="dialog"><textarea id="wrong"></textarea></div>',
    '<user-query><textarea id="wrong"></textarea></user-query>',
    '<section data-gv-plugin="test"><textarea id="wrong"></textarea></section>',
    '<textarea id="wrong" readonly></textarea>',
  ])('keeps native draft ownership when an unrelated editor appears: %s', (wrong) => {
    document.body.innerHTML = `<input-area><textarea id="draft"></textarea>${wrong}</input-area>
      <textarea id="outside"></textarea>`;
    expect(findOwnedGeminiMainInputs(document)).toEqual([document.getElementById('draft')]);
  });
});
