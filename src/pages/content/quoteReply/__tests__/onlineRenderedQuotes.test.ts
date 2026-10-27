import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { startRenderedQuoteStyling } from '../renderedQuotes';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
let retire: (() => void) | undefined;
let stop: (() => void) | undefined;

function composer(): HTMLElement {
  const owner = document.createElement('div');
  owner.className = 'text-input-field';
  owner.innerHTML = '<section class="renamed-input" contenteditable="true"><p>Draft</p></section>';
  const input = owner.firstElementChild as HTMLElement;
  input.getBoundingClientRect = () => ({ height: 20, width: 200 }) as DOMRect;
  document.body.append(owner);
  return input;
}

function quote(input: HTMLElement, text: string): HTMLElement {
  const line = document.createElement('p');
  line.textContent = `> ${text}`;
  input.replaceChildren(line);
  return line;
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  vi.advanceTimersByTime(80);
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
});

afterEach(() => {
  stop?.();
  retire?.();
  stop = retire = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', originalLocation);
});

describe('online composer quote repainting', () => {
  it('a host line replacement in a renamed composer keeps quote styling without an input event', async () => {
    const input = composer();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.renamed-input'] });
    stop = startRenderedQuoteStyling();
    const line = quote(input, 'new context');
    await flushMutations();
    expect(line.classList).toContain('gv-composer-quote-line');
    expect(input.textContent).toBe('> new context');
    line.textContent = 'Plain draft';
    await flushMutations();
    expect(line.classList).not.toContain('gv-composer-quote-line');
    expect(input.textContent).toBe('Plain draft');
  });

  it('a remounted renamed composer is styled only after its new native owner is verified', async () => {
    const old = composer();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.renamed-input'] });
    stop = startRenderedQuoteStyling();
    old.parentElement!.remove();
    const replacement = composer();
    const line = quote(replacement, 'replacement context');
    await flushMutations();
    expect(line.classList).toContain('gv-composer-quote-line');
    expect(replacement.textContent).toBe('> replacement context');
    stop();
    stop = undefined;
    expect(line.classList).not.toContain('gv-composer-quote-line');
  });

  it('streaming sidebar rows defer no composer layout work while an actual edit still repaints', async () => {
    const input = composer();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.renamed-input'] });
    stop = startRenderedQuoteStyling();
    const measure = vi.spyOn(input, 'getBoundingClientRect');
    const sidebar = document.createElement('nav');
    document.body.append(sidebar);
    for (let index = 0; index < 20; index += 1) {
      const row = document.createElement('a');
      row.textContent = `Conversation ${index}`;
      sidebar.append(row);
    }
    await flushMutations();
    expect(measure).not.toHaveBeenCalled();
    const line = quote(input, 'updated context');
    await flushMutations();
    expect(line.classList).toContain('gv-composer-quote-line');
    expect(measure).toHaveBeenCalled();
  });
});
