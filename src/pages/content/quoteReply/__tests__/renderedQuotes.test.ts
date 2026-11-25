import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readContentStyle } from '@/tests/contentStyle';

import { renderQuotedUserMessages, startRenderedQuoteStyling } from '../renderedQuotes';
import { startQuoteReply } from './startQuoteReply';

function installUserMessage(lines: string[]): HTMLElement {
  const container = document.createElement('div');
  container.className = 'query-text';
  lines.forEach((text) => {
    const line = document.createElement('p');
    line.className = 'query-text-line';
    line.textContent = text;
    container.appendChild(line);
  });
  document.body.appendChild(container);
  return container;
}

function installComposer(lines: string[]): HTMLElement {
  const input = document.createElement('div');
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('role', 'textbox');
  lines.forEach((text) => {
    const line = document.createElement('p');
    line.textContent = text;
    input.appendChild(line);
  });
  document.body.appendChild(input);
  return input;
}

describe('rendered Quote Reply blocks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('marks a quote run in place, leaving each line a direct child of its message', () => {
    const container = installUserMessage([
      '>',
      '> quoted context',
      '>',
      '> more context',
      'My follow-up question',
    ]);
    const lines = Array.from(container.children);
    const raw = container.textContent;

    renderQuotedUserMessages();

    // Gemini owns this list and re-collapses a message that grows after Expand (#1117).
    expect(Array.from(container.children)).toEqual(lines);
    expect(container.querySelector('blockquote')).toBeNull();
    const [leadingEmpty, first, empty, last, reply] = lines;
    expect(container.querySelectorAll('.gv-rendered-quote-line')).toHaveLength(4);
    expect(container.querySelectorAll('.gv-rendered-quote-marker')).toHaveLength(4);
    expect(leadingEmpty.classList).toContain('gv-rendered-quote-empty');
    expect(empty.classList).toContain('gv-rendered-quote-empty');
    expect(container.querySelectorAll('.gv-rendered-quote-start')).toHaveLength(1);
    expect(first.classList).toContain('gv-rendered-quote-start');
    expect(last.classList).toContain('gv-rendered-quote-end');
    expect(container.querySelectorAll('.gv-rendered-quote-end')).toHaveLength(1);
    expect(reply.className).toBe('query-text-line');
    expect(container.textContent).toBe(raw);
  });

  it('keeps separate quote runs separate and remains idempotent', () => {
    const container = installUserMessage(['> first quote', 'question', '> second quote']);

    renderQuotedUserMessages();
    renderQuotedUserMessages();

    const [first, question, second] = Array.from(container.children);
    for (const line of [first, second]) {
      expect(line.classList).toContain('gv-rendered-quote-start');
      expect(line.classList).toContain('gv-rendered-quote-end');
    }
    expect(question.classList).not.toContain('gv-rendered-quote-line');
    expect(container.querySelectorAll('.gv-rendered-quote-marker')).toHaveLength(2);
    expect(container.textContent).toBe('> first quotequestion> second quote');
  });

  it('does not reinterpret a greater-than prefix without quote spacing', () => {
    const container = installUserMessage(['>not a quote']);

    renderQuotedUserMessages();

    expect(container.querySelector('.gv-rendered-quote-line')).toBeNull();
    expect(container.textContent).toBe('>not a quote');
  });

  it('groups quoted context in the composer without changing its text', () => {
    const input = installComposer(['> first quote', '> second quote', 'Follow-up']);
    const rawText = input.textContent;
    const cleanup = startRenderedQuoteStyling();
    const lines = Array.from(input.children);

    expect(lines[0].classList).toContain('gv-composer-quote-line');
    expect(lines[0].classList).toContain('gv-composer-quote-start');
    expect(lines[0].classList).not.toContain('gv-composer-quote-end');
    expect(lines[1].classList).toContain('gv-composer-quote-line');
    expect(lines[1].classList).toContain('gv-composer-quote-end');
    expect(lines[2].classList).not.toContain('gv-composer-quote-line');
    expect(input.textContent).toBe(rawText);

    cleanup();
    expect(input.querySelector('[class*="gv-composer-quote"]')).toBeNull();
  });

  it('updates composer quote styling as the user edits', () => {
    const input = installComposer(['Draft']);
    const line = input.firstElementChild;
    if (!(line instanceof HTMLElement)) throw new Error('Expected a composer line.');
    const cleanup = startRenderedQuoteStyling();

    line.textContent = '> Quoted';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(line.classList).toContain('gv-composer-quote-line');

    line.textContent = 'Plain text';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(line.classList).not.toContain('gv-composer-quote-line');

    cleanup();
  });

  it('decorates messages added after startup', async () => {
    const container = installUserMessage([]);
    const cleanup = startRenderedQuoteStyling();
    const line = document.createElement('p');
    line.className = 'query-text-line';
    line.textContent = '> arrived later';
    container.appendChild(line);

    await Promise.resolve();
    vi.advanceTimersByTime(80);

    expect(line.classList).toContain('gv-rendered-quote-line');
    cleanup();
  });

  it('restyles the composer when its lines are replaced without an input event', async () => {
    const input = installComposer(['Draft']);
    const cleanup = startRenderedQuoteStyling();
    const quoted = document.createElement('p');
    quoted.textContent = '> inserted context';

    input.replaceChildren(quoted);
    await Promise.resolve();
    vi.advanceTimersByTime(80);

    expect(quoted.classList).toContain('gv-composer-quote-line');
    cleanup();
  });

  it('styles a composer mounted after startup', async () => {
    const cleanup = startRenderedQuoteStyling();
    const host = document.createElement('div');
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    const line = document.createElement('p');
    line.textContent = '> quoted';
    input.appendChild(line);
    host.appendChild(input);

    document.body.appendChild(host);
    await Promise.resolve();
    vi.advanceTimersByTime(80);

    expect(line.classList).toContain('gv-composer-quote-line');
    cleanup();
  });

  it('does not measure layout while unrelated rows stream into the page', async () => {
    installComposer(['Draft']);
    const cleanup = startRenderedQuoteStyling();
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const list = document.createElement('div');
    document.body.appendChild(list);

    for (let i = 0; i < 20; i++) {
      const row = document.createElement('a');
      row.textContent = `Conversation ${i}`;
      list.appendChild(row);
    }
    await Promise.resolve();
    vi.advanceTimersByTime(80);

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
    cleanup();
  });

  it('restores a marker after another renderer repaints a quoted line', async () => {
    const container = installUserMessage(['> before $x$']);
    const cleanup = startRenderedQuoteStyling();
    const line = container.querySelector<HTMLElement>('.query-text-line');
    if (!line) throw new Error('Expected user message line.');

    line.textContent = '> after $y$';
    await Promise.resolve();
    vi.advanceTimersByTime(80);

    expect(line.querySelector('.gv-rendered-quote-marker')?.textContent).toBe('> ');
    expect(container.textContent).toBe('> after $y$');
    cleanup();
  });

  it('restores the original DOM on cleanup', () => {
    const container = installUserMessage(['> quoted context', 'question']);
    const raw = container.innerHTML;
    const cleanup = startRenderedQuoteStyling();

    cleanup();

    expect(container.querySelector('.gv-rendered-quote-marker')).toBeNull();
    expect(container.querySelector('[class*="gv-rendered-quote"]')).toBeNull();
    expect(container.innerHTML).toBe(raw);
  });

  it('keeps rendered quotes styled with quote and highlight both off', () => {
    const container = installUserMessage(['> quoted context', 'question']);
    // In a conversation turn, so the toolbar would offer Quote if it were on.
    const turn = document.createElement('div');
    turn.className = 'conversation-container';
    container.replaceWith(turn);
    turn.appendChild(container);
    const stop = startQuoteReply({ quoteEnabled: false, highlightEnabled: false });
    const line = container.querySelector('.query-text-line')!;
    const range = document.createRange();
    range.selectNodeContents(line);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);

    expect(container.querySelector('.gv-rendered-quote-line')).not.toBeNull();
    expect(document.querySelector('.gv-selection-toolbar')).toBeNull();
    stop();
    expect(container.querySelector('[class*="gv-rendered-quote"]')).toBeNull();
  });

  it('restores a quote line that was detached and re-rendered before stop', async () => {
    const original = installUserMessage(['> quoted context', 'question']);
    const raw = original.innerHTML;
    const cleanup = startRenderedQuoteStyling();
    expect(original.querySelector('.gv-rendered-quote-marker')).not.toBeNull();

    // Gemini swaps the message for a freshly rendered copy and keeps the old node around.
    original.remove();
    const replacement = installUserMessage(['> quoted context', 'question']);
    await Promise.resolve();
    vi.advanceTimersByTime(80);
    expect(replacement.querySelector('.gv-rendered-quote-marker')).not.toBeNull();
    cleanup();

    document.body.appendChild(original);
    expect(original.innerHTML).toBe(raw);
    expect(replacement.querySelector('[class*="gv-"]')).toBeNull();
  });

  it('uses Voyager theme variables and logical properties in every browser', () => {
    const css = readContentStyle();
    // Collect the rules by what they style, not by slicing between two comments:
    // the previous end anchor was an unrelated comment, so editing that comment
    // silently emptied this block and every assertion below passed on nothing.
    const block = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /\.gv-(?:rendered-quote|composer-quote)/.test(selector))
      .map(([rule]) => rule)
      .join('\n');

    expect(block, 'no Quote Reply rules found').not.toBe('');

    expect(block).toContain('.gv-rendered-quote-line');
    expect(block).toContain('var(--gv-pm-brand, var(--gv-pm-brand-default))');
    expect(block).toContain('border-inline-start');
    expect(block).toContain('border-start-end-radius');
    expect(block).toContain('.gv-rendered-quote-marker');
    expect(block).toContain('.gv-composer-quote-line');
    expect(block).toContain('.gv-composer-quote-start');
    expect(block).toContain('.gv-composer-quote-end');
    expect(block).not.toContain('border-left');
  });

  it('paints sent quotes without making the message taller', () => {
    // Gemini re-collapses an expanded message once it measures taller than its
    // threshold, so any block-axis size a sent quote adds undoes Expand (#1117).
    const css = readContentStyle();
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector]) =>
        /\.gv-rendered-quote/.test(selector) && !/::?(?:before|after)\b/.test(selector),
    );
    expect(rules, 'no sent-quote rules found').not.toHaveLength(0);

    const growsBlockAxis =
      /^(?:padding|margin|border|border-width|gap|row-gap|height|min-height|line-height|font-size|(?:padding|margin)-(?:top|bottom|block(?:-start|-end)?)|border-(?:top|bottom|block(?:-start|-end)?)(?:-width)?)$/;
    for (const [rule, , body] of rules) {
      const properties = body
        .split(';')
        .map((declaration) => declaration.split(':')[0].trim())
        .filter(Boolean);
      expect(
        properties.filter((name) => growsBlockAxis.test(name)),
        rule,
      ).toEqual([]);
      expect(body, rule).not.toMatch(/display\s*:\s*(?:grid|flex|inline-grid|inline-flex)/);
    }

    // The paint itself stays out of layout.
    const paint = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) =>
      /\.gv-rendered-quote-line::before/.test(selector),
    );
    expect(paint?.[2]).toMatch(/position\s*:\s*absolute/);
  });
});
