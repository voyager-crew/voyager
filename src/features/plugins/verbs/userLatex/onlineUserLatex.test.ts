import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveGeminiUserLatexLines } from '@/core/gemini/math/userLatex';
import { getBundledGeminiSelectorView } from '@/core/gemini/selectors';
import { textWithLatexSource } from '@/core/utils/userLatexSource';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { startRenderedQuoteStyling } from '@/pages/content/quoteReply/renderedQuotes';
import {
  _resetUserLatexKatexLoader,
  _setUserLatexKatexLoaderForTest,
} from '@/pages/content/userLatex';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { userLatexPrimitive } from './index';

const renderToString = vi.fn((source: string) => `<span class="katex">${source}</span>`);
vi.mock('katex', () => ({ default: { renderToString } }));
let scope: PluginScope;
const cleanups: Array<() => void> = [];
beforeEach(() => {
  scope = new PluginScope();
  _resetUserLatexKatexLoader();
  renderToString.mockClear();
});
afterEach(async () => {
  await scope.dispose();
  cleanups.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
});
async function patch(selector = '.line') {
  cleanups.push(await installGeminiSelectorPatch({ 'userLatex.lines': [selector] }));
}
function start(site = 'gemini'): () => number {
  let count = () => 0;
  void userLatexPrimitive.activate(
    scope,
    { turn: 'p.query-text-line', unit: 'turn' },
    {
      doc: document,
      adapter: requireBundledSiteAdapter(site),
      pluginId: 'voyager.gemini-user-latex',
      settings: {},
      setTargetCounter: (counter) => {
        count = counter;
      },
    },
  );
  return () => count();
}
function install(lines: string, extra = ''): HTMLElement {
  document.body.innerHTML = `<user-query><div class="query-text">${lines}</div></user-query>${extra}`;
  return document.querySelector<HTMLElement>('user-query')!;
}
const rendered = () => document.querySelectorAll('.katex').length;

function holdKatex(): () => void {
  let release!: () => void;
  _setUserLatexKatexLoaderForTest(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ default: { renderToString } } as unknown as typeof import('katex'));
      }),
  );
  return () => release();
}

describe('online Gemini user LaTeX', () => {
  it('keeps the same lines, quote text, source and restored nodes through both profiles', async () => {
    const host = install(
      '<p class="query-text-line line">&gt; quoted $x$</p><p class="query-text-line line">answer $$y$$</p>',
    );
    const lines = Array.from(host.querySelectorAll('p'));
    const originalNodes = lines.map((line) => line.firstChild);
    const bundled = resolveGeminiUserLatexLines(document, getBundledGeminiSelectorView()).value;
    await patch();
    expect(resolveGeminiUserLatexLines(document).value).toEqual(bundled);
    const stopQuotes = startRenderedQuoteStyling();
    cleanups.push(stopQuotes);
    const count = start();
    await vi.waitFor(() => expect(rendered()).toBe(2));
    expect(count()).toBe(2);
    expect(lines.map(textWithLatexSource)).toEqual(['> quoted $x$', 'answer $$y$$']);
    expect(host.querySelector('blockquote')?.textContent).toBe('> quoted x');
    await scope.dispose();
    stopQuotes();
    expect(lines.map((line) => line.textContent)).toEqual(['> quoted $x$', 'answer $$y$$']);
    expect(lines[1].firstChild).toBe(originalNodes[1]);
  });

  it('repairs renamed native paragraphs and observes later quote lines without changing their source', async () => {
    const host = install('<p class="line">&gt; first $x$</p>');
    await patch();
    cleanups.push(startRenderedQuoteStyling());
    const count = start();
    await vi.waitFor(() => expect(rendered()).toBe(1));
    const line = document.createElement('p');
    line.className = 'line';
    line.textContent = '> later $y$';
    host.querySelector('.query-text')!.append(line);
    await vi.waitFor(() => expect(rendered()).toBe(2));
    await vi.waitFor(() => expect(line.closest('blockquote')).not.toBeNull());
    expect(count()).toBe(2);
    expect(textWithLatexSource(line)).toBe('> later $y$');
  });

  it('renders both bundled lines when an online list omits the second one', async () => {
    install(
      '<p class="query-text-line line">first $x$</p><p class="query-text-line">second $y$</p>',
    );
    await patch();
    const count = start();
    await vi.waitFor(() => expect(rendered()).toBe(2));
    expect(count()).toBe(2);
    expect(
      Array.from(document.querySelectorAll('p'), (line) => line.dataset.userLatexOriginal),
    ).toEqual(['first $x$', 'second $y$']);
  });

  it.each([
    [
      'ordinary reply',
      '<p class="line">user $x$</p>',
      '<model-response><p class="line">reply $y$</p></model-response>',
    ],
    ['missing line', '<p class="line">first $x$</p><p>second $y$</p>', ''],
    ['bare message text', 'first $x$<p class="line">second $y$</p>', ''],
  ])('falls back as one scan when the online read includes an %s', async (_name, lines, extra) => {
    const host = install(lines, extra);
    const before = document.body.innerHTML;
    await patch();
    const count = start();
    expect(count()).toBe(0);
    expect(document.body.innerHTML).toBe(before);
    expect(host.textContent).toContain('$x$');
  });

  it('leaves a repaired line with its new owner when it moves while KaTeX loads', async () => {
    const host = install('<p class="line">moving $x$</p>', '<user-query id="next"></user-query>');
    const line = host.querySelector('p')!;
    const release = holdKatex();
    await patch();
    start();
    document.querySelector('#next')!.append(line);
    release();
    await vi.waitFor(() => expect(line.hasAttribute('data-user-latex-owner')).toBe(false));
    expect(line.textContent).toBe('moving $x$');
    expect(line.parentElement?.id).toBe('next');
  });

  it('keeps the original text when the online page view retires while KaTeX loads', async () => {
    const host = install('<p class="line">pending $x$</p>');
    const line = host.querySelector('p')!;
    const original = line.firstChild;
    const release = holdKatex();
    await patch();
    start();
    cleanups.pop()!();
    release();
    await vi.waitFor(() => expect(line.hasAttribute('data-user-latex-owner')).toBe(false));
    expect(line.firstChild).toBe(original);
    expect(line.textContent).toBe('pending $x$');
  });

  it('keeps a line the host renamed out of the accepted set while KaTeX loads', async () => {
    const host = install('<p class="line">pending $x$</p>');
    const line = host.querySelector('p')!;
    const original = line.firstChild;
    const release = holdKatex();
    await patch();
    start();
    line.className = 'changed';
    release();
    await vi.waitFor(() => expect(line.hasAttribute('data-user-latex-owner')).toBe(false));
    expect(line.firstChild).toBe(original);
    expect(line.textContent).toBe('pending $x$');
  });

  it.each([
    '<code>$x$</code>',
    '<a href="https://example.org">$x$</a>',
    '<strong>$x$</strong>',
    '<math><mi>x</mi></math>$x$',
    '<span class="katex">$x$</span>',
    '<span data-math="x">$x$</span>',
    '<span data-user-latex-original="$x$">$x$</span>',
    '<span role="link">$x$</span>',
    '<button>$x$</button>',
  ])('keeps native content frames in a renamed line: %s', async (markup) => {
    const host = install(`<p class="line">${markup}</p>`);
    const line = host.querySelector('p')!;
    const first = line.firstChild;
    const before = line.innerHTML;
    await patch();
    const count = start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(count()).toBe(0);
    expect(line.innerHTML).toBe(before);
    expect(line.firstChild).toBe(first);
    line.innerHTML = '<span>plain $x$</span>';
    await vi.waitFor(() => expect(line.dataset.userLatexOriginal).toBe('plain $x$'));
    expect(count()).toBe(1);
    expect(textWithLatexSource(line)).toBe('plain $x$');
  });

  it('keeps another site on its configured line selector even with a Gemini patch installed', async () => {
    const host = install('<p class="line">Gemini $x$</p>');
    await patch();
    const count = start('chatgpt');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const configured = document.createElement('p');
    configured.className = 'query-text-line';
    configured.textContent = 'configured $y$';
    host.append(configured);
    await vi.waitFor(() => expect(rendered()).toBe(1));
    expect(count()).toBe(1);
    expect(configured.dataset.userLatexOriginal).toBe('configured $y$');
    expect(document.querySelector('.line')?.textContent).toBe('Gemini $x$');
  });
});
