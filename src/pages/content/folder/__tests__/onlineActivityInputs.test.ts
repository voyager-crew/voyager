// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/chat" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { resolveActivitySendIntent } from '../gemini/activitySelectors';

let retire = () => {};
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 30,
    width: 300,
  } as DOMRect);
});
afterEach(() => {
  retire();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
function intent(target: Element, type = 'click'): boolean {
  let accepted = false;
  const read = (event: Event) => {
    accepted = resolveActivitySendIntent(event).value.accepted;
  };
  target.addEventListener(type, read);
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  target.removeEventListener(type, read);
  return accepted;
}

describe('folder activity input profiles', () => {
  it('detects the same submit and click with bundled and remote inputs', async () => {
    document.body.innerHTML =
      '<form class="text-input-field"><div id="input" role="textbox" contenteditable="true"></div><button aria-label="Send"></button></form>';
    const form = document.querySelector('form')!;
    const button = document.querySelector('button')!;
    const bundled = [intent(form, 'submit'), intent(button)];
    retire = await installGeminiSelectorPatch({ 'activity.inputs': ['#input'] });
    expect([intent(form, 'submit'), intent(button)]).toEqual(bundled);
    expect(bundled).toEqual([true, true]);
  });

  it('keeps recording the real send when a remote list misses its editor', async () => {
    document.body.innerHTML =
      '<form><div id="input" role="textbox" contenteditable="true"></div><button aria-label="Send"></button></form><textarea id="elsewhere"></textarea>';
    retire = await installGeminiSelectorPatch({ 'activity.inputs': ['#elsewhere'] });
    expect(intent(document.querySelector('button')!)).toBe(true);
  });

  it('reads every editor in the send owner when a remote profile selects only one', async () => {
    document.body.innerHTML =
      '<form><div id="first" role="textbox" contenteditable="true"></div><div id="second" role="textbox" contenteditable="true"></div><button aria-label="Send"></button></form>';
    const form = document.querySelector('form')!;
    const readInputs = () => {
      let inputs: HTMLElement[] = [];
      const read = (event: Event) => {
        inputs = resolveActivitySendIntent(event).value.inputs;
      };
      form.addEventListener('submit', read);
      form.dispatchEvent(new Event('submit'));
      form.removeEventListener('submit', read);
      return inputs;
    };
    const bundled = Array.from(form.querySelectorAll<HTMLElement>('[contenteditable]'));
    retire = await installGeminiSelectorPatch({ 'activity.inputs': ['#second'] });
    expect(readInputs()).toEqual(bundled);
    expect(readInputs().map((input) => input.id)).toEqual(['first', 'second']);
  });

  it('does not turn a reply editor into activity for the current chat', async () => {
    document.body.innerHTML =
      '<model-response><form><section id="reply" contenteditable="true"></section><button aria-label="Send"></button></form></model-response><div class="text-input-field"><section id="main" class="gv-input-vim-mode-normal" contenteditable="true"></section><button aria-label="Send"></button></div>';
    const [reply, main] = document.querySelectorAll('button');
    retire = await installGeminiSelectorPatch({ 'activity.inputs': ['#reply', '#main'] });
    expect(intent(main)).toBe(true);
    expect(intent(reply)).toBe(false);
  });

  it('does not claim an ambiguous pair of renamed editors as one native send owner', async () => {
    document.body.innerHTML =
      '<div class="text-input-field"><section id="first" contenteditable="true"></section><section id="second" contenteditable="true"></section><button aria-label="Send"></button></div>';
    retire = await installGeminiSelectorPatch({ 'activity.inputs': ['#first'] });
    expect(intent(document.querySelector('button')!)).toBe(false);
    document.getElementById('second')!.remove();
    expect(intent(document.querySelector('button')!)).toBe(true);
  });
});

it('a malformed project profile leaves activity fixes usable and vice versa', async () => {
  const { findProjectInput } = await import('../../folderProject/inputTargets');
  document.body.innerHTML =
    '<form class="text-input-field"><section id="main" contenteditable="true"></section><button aria-label="Send"></button></form>';
  const main = document.getElementById('main')!;
  const button = document.querySelector('button')!;
  retire = await installGeminiSelectorPatch({
    'project.inputs': ['['],
    'activity.inputs': ['#main'],
  });
  expect(findProjectInput()).toBeNull();
  expect(intent(button)).toBe(true);
  retire();
  retire = await installGeminiSelectorPatch({
    'project.inputs': ['#main'],
    'activity.inputs': ['['],
  });
  expect(findProjectInput()).toBe(main);
  expect(intent(button)).toBe(false);
});
