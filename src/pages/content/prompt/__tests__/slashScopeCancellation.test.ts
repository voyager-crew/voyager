import { afterEach, describe, expect, it } from 'vitest';

import { startPromptSlashCommand } from '../slashPrompt';
import { createContentEditable, typeInto, press } from './slashPromptTestHarness';
let destroy: (() => void) | undefined;
afterEach(() => {
  destroy?.();
  document.body.innerHTML = '';
});
describe('slash template cancellation', () => {
  it('a template confirmed just after navigation leaves the original slash text untouched', () => {
    window.history.replaceState({}, '', '/u/0/app/first');
    const input = createContentEditable('/fable');
    destroy = startPromptSlashCommand({
      scheme: () => 'light',
      initialItems: [{ id: 'f', name: 'Fable', text: 'Write {{topic}}.', tags: [], createdAt: 1 }],
    }).destroy;
    typeInto(input);
    press(input, 'Enter');
    document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'the sea';
    window.history.replaceState({}, '', '/u/0/app/second');
    document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
    expect(input.textContent).toBe('/Fable');
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    typeInto(input);
    press(input, 'Enter');
    document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'the sky';
    document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
    expect(input.querySelector<HTMLElement>('.gv-pm-slash-token')?.dataset.gvPromptText).toBe(
      'Write the sky.',
    );
  });
});
