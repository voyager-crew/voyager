// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findProjectInput, resolveProjectInput } from '../inputTargets';

let retire = () => {};
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 30,
    width: 300,
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hidden ? null : document.body;
    },
  );
});
afterEach(() => {
  retire();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function fixture(): void {
  document.body.innerHTML =
    '<div class="text-input-field"><rich-textarea><div id="main" class="new-input" role="textbox" contenteditable="true">draft</div></rich-textarea></div><div class="edit-container"><textarea id="edit">old message</textarea></div>';
}

describe('project online input ownership', () => {
  it('keeps the same input and draft through bundled and remote profiles', async () => {
    fixture();
    const bundled = findProjectInput();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#main', '#edit'] });
    expect(findProjectInput()).toBe(bundled);
    expect(findProjectInput()?.textContent).toBe('draft');
  });

  it('keeps instructions in the main draft when a partial profile names only the old-message editor', async () => {
    fixture();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#edit'] });
    expect(findProjectInput()).toBe(document.getElementById('main'));
  });

  it('keeps the original input order when a remote profile puts the old-message editor first', async () => {
    fixture();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#edit', '#main'] });
    expect(findProjectInput()).toBe(document.getElementById('main'));
  });

  it('finds a renamed main editor only when native ownership proves it', async () => {
    document.body.innerHTML =
      '<div class="text-input-field"><section id="renamed" class="gv-input-vim-mode-normal" contenteditable="true">main draft</section></div><model-response><section id="reply" contenteditable="true">reply text</section></model-response>';
    expect(findProjectInput()).toBeNull();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#renamed'] });
    expect(findProjectInput()).toBe(document.getElementById('renamed'));
    retire();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#reply'] });
    expect(findProjectInput()).toBeNull();
  });

  it('keeps the hidden fallback and Gem editor behavior under an equivalent patch', async () => {
    document.body.innerHTML =
      '<rich-textarea><div id="gem" contenteditable="true">Gem instructions</div></rich-textarea>';
    const input = document.getElementById('gem')!;
    const bundled = findProjectInput();
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#gem'] });
    expect(findProjectInput()).toBe(bundled);
    input.hidden = true;
    expect(findProjectInput()).toBeNull();
  });
  it('a remote input accepts only the send control that started its operation', async () => {
    document.body.innerHTML =
      '<div class="text-input-field"><section id="renamed" contenteditable="true">draft</section><button aria-label="Send" id="actual"></button></div><form><button id="other" aria-label="Send"></button></form>';
    retire = await installGeminiSelectorPatch({ 'project.inputs': ['#renamed'] });
    expect(findProjectInput(document.getElementById('actual')!)).toBe(
      document.getElementById('renamed'),
    );
    expect(findProjectInput(document.getElementById('other')!)).toBeNull();
  });
});

it('a different clicked send falls back to the bundled draft even when the remote editor is valid', async () => {
  document.body.innerHTML =
    '<div class="text-input-field"><rich-textarea><div id="draft" role="textbox" contenteditable="true">bundled draft</div></rich-textarea><button id="actual" aria-label="Send"></button><button id="clicked" aria-label="Send"></button></div>';
  retire = await installGeminiSelectorPatch({ 'project.inputs': ['#draft'] });
  const matching = resolveProjectInput(document.getElementById('actual')!);
  expect(matching.view.remoteKeys.has('project.inputs')).toBe(true);
  const fallback = resolveProjectInput(document.getElementById('clicked')!);
  expect(fallback.value?.textContent).toBe('bundled draft');
  expect(fallback.view.remoteKeys.has('project.inputs')).toBe(false);
});
