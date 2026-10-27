// @vitest-environment-options {"url":"https://chatgpt.com/c/first"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startPromptSlashCommand } from '../slashPrompt';
import { createContentEditable, press, typeInto } from './slashPromptTestHarness';

let destroy: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  destroy?.();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function streamEmail(): void {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<article data-message-author-role="assistant"><a href="mailto:reply@example.com">reply@example.com</a></article>',
  );
}

function start(text: string) {
  const input = createContentEditable('/fable');
  input.id = 'prompt-textarea';
  destroy = startPromptSlashCommand({
    scheme: () => 'light',
    initialItems: [{ id: 'f', name: 'Fable', text, tags: [], createdAt: 1 }],
  }).destroy;
  typeInto(input);
  return input;
}

describe('slash prompts on non-Google pages', () => {
  it('an email in a streamed reply leaves the slash menu usable', async () => {
    const input = start('Write a fable.');
    streamEmail();
    await Promise.resolve();
    expect(document.getElementById('gv-pm-slash-root')!.hidden).toBe(false);
    press(input, 'Enter');
    expect(input.querySelector<HTMLElement>('.gv-pm-slash-token')?.dataset.gvPromptText).toBe(
      'Write a fable.',
    );
  });

  it('an email in a streamed reply does not dismiss a pending template', async () => {
    const input = start('Write {{topic}}.');
    press(input, 'Enter');
    document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'the sea';
    streamEmail();
    await Promise.resolve();
    expect(document.querySelector('.gv-pm-fill')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
    expect(input.querySelector<HTMLElement>('.gv-pm-slash-token')?.dataset.gvPromptText).toBe(
      'Write the sea.',
    );
  });

  it('an email appearing after Enter cannot swallow the expanded prompt send', async () => {
    const input = start('Write a fable.');
    press(input, 'Enter');
    const sent: string[] = [];
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sent.push(input.textContent?.trim() || '');
    });
    expect(press(input, 'Enter').defaultPrevented).toBe(true);
    streamEmail();
    await Promise.resolve();
    vi.advanceTimersByTime(0);
    expect(sent).toEqual(['Write a fable.']);
  });
});
