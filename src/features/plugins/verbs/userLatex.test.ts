import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { textWithLatexSource } from '@/core/utils/userLatexSource';
import { turnSummary } from '@/features/timeline/adapters/catalog/turnHash';
import { chatgptExtractUserText } from '@/pages/content/export/adapter/platform/chatgpt';
import { _resetUserLatexKatexLoader } from '@/pages/content/userLatex';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import type { PrimitiveContext } from './types';
import { userLatexPrimitive } from './userLatex';

const renderToString = vi.fn(
  (tex: string) => `<span class="katex"><span class="katex-html">${tex}</span></span>`,
);
vi.mock('katex', () => ({ default: { renderToString } }));

/** ChatGPT's prompt bubble as measured live (see chatgptThreadFixture). */
function chatgptMessage(text: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', `k${document.querySelectorAll('[data-turn-key]').length}`);
  item.innerHTML =
    '<div data-user-message-bubble="true"><div data-search-result-target=""><div><div dir="auto"></div></div></div></div>';
  item.querySelector('[dir="auto"]')!.textContent = text;
  document.querySelector('main')!.append(item);
  return item.querySelector<HTMLElement>('[data-user-message-bubble]')!;
}

/** Claude's user message: one paragraph per line. */
function claudeMessage(text: string): HTMLElement {
  const message = document.createElement('div');
  message.setAttribute('data-testid', 'user-message');
  const paragraph = document.createElement('p');
  paragraph.className = 'whitespace-pre-wrap';
  paragraph.textContent = text;
  message.append(paragraph);
  document.querySelector('main')!.append(message);
  return message;
}

const sites = [
  { adapter: requireBundledSiteAdapter('chatgpt'), message: chatgptMessage },
  { adapter: requireBundledSiteAdapter('claude'), message: claudeMessage },
];

let scope: PluginScope;

function activate(adapter: SiteAdapter, params = {}) {
  let counter: () => number = () => -1;
  const context: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'test.user-latex',
    settings: {},
    setTargetCounter: (count) => (counter = count),
  };
  void userLatexPrimitive.activate(scope, params, context);
  return { count: () => counter() };
}

const rendered = (element: Element) => element.querySelectorAll('.katex');

beforeEach(() => {
  _resetUserLatexKatexLoader();
  renderToString.mockClear();
  document.body.innerHTML =
    '<main></main><form><div id="prompt-textarea" contenteditable="true"></div></form>';
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
  document.body.className = '';
});

describe('userLatex primitive', () => {
  it('accepts an optional turn selector and rejects anything else', () => {
    expect(userLatexPrimitive.validateParams(undefined)).toEqual({ success: true, data: {} });
    expect(userLatexPrimitive.validateParams({ turn: '.mine' })).toEqual({
      success: true,
      data: { turn: '.mine' },
    });
    expect(userLatexPrimitive.validateParams({ turn: ' ' }).success).toBe(false);
    expect(userLatexPrimitive.validateParams({ selector: '.mine' }).success).toBe(false);
    expect(userLatexPrimitive.validateParams([]).success).toBe(false);
  });

  it('a ChatGPT user message shows $I_3$ as rendered math', async () => {
    const bubble = chatgptMessage('这个 $I_3$ 是单位矩阵吗?');
    const { count } = activate(sites[0].adapter);

    await vi.waitFor(() => expect(rendered(bubble)).toHaveLength(1));
    expect(renderToString).toHaveBeenCalledWith(
      'I_3',
      expect.objectContaining({ displayMode: false }),
    );
    expect(bubble.textContent).toBe('这个 I_3 是单位矩阵吗?');
    expect(count()).toBe(1);
  });

  it("a message still renders under Voyager's own page classes", async () => {
    document.body.className = 'gv-rtl gv-plugin-chatgpt-reading-width';
    const bubble = chatgptMessage('$x$');
    activate(sites[0].adapter);

    await vi.waitFor(() => expect(rendered(bubble)).toHaveLength(1));
  });

  it.each(sites)('renders a user message that arrives later on $adapter.label', async (site) => {
    activate(site.adapter);
    const message = site.message('Display: $$\\sum_i x_i$$');

    await vi.waitFor(() => expect(rendered(message)).toHaveLength(1));
    expect(renderToString).toHaveBeenCalledWith(
      '\\sum_i x_i',
      expect.objectContaining({ displayMode: true }),
    );
  });

  it('the ChatGPT composer is never rendered', async () => {
    const composer = document.querySelector<HTMLElement>('#prompt-textarea')!;
    composer.innerHTML = '<p>draft $x^2$</p>';
    // Even a composer that sits inside a user turn, as an inline edit does.
    const bubble = chatgptMessage('');
    bubble.querySelector('[dir="auto"]')!.innerHTML =
      '<textarea>edit $y$</textarea><div contenteditable="true">edit $z$</div>';
    const sent = chatgptMessage('sent $w$');
    activate(sites[0].adapter);

    await vi.waitFor(() => expect(rendered(sent)).toHaveLength(1));
    expect(composer.innerHTML).toBe('<p>draft $x^2$</p>');
    expect(bubble.querySelector('textarea')!.textContent).toBe('edit $y$');
    expect(bubble.querySelector('[contenteditable]')!.textContent).toBe('edit $z$');
    expect(renderToString).toHaveBeenCalledTimes(1);
  });

  it('a dollar amount like $5 and $10 is left as text', async () => {
    const prices = chatgptMessage('It costs $5 and $10 later');
    const math = chatgptMessage('and $x$');
    activate(sites[0].adapter);

    await vi.waitFor(() => expect(rendered(math)).toHaveLength(1));
    expect(rendered(prices)).toHaveLength(0);
    expect(prices.textContent).toBe('It costs $5 and $10 later');
  });

  it('turning the plugin off restores the original text', async () => {
    const bubble = chatgptMessage('Is $I_3$ the identity?');
    const textNode = bubble.querySelector('[dir="auto"]')!.firstChild;
    activate(sites[0].adapter);
    await vi.waitFor(() => expect(rendered(bubble)).toHaveLength(1));

    await scope.dispose();

    const holder = bubble.querySelector<HTMLElement>('[dir="auto"]')!;
    expect(holder.textContent).toBe('Is $I_3$ the identity?');
    // The host's own text node goes back, so its framework still owns what it renders.
    expect(holder.firstChild).toBe(textNode);
    expect(holder.attributes).toHaveLength(1);
  });

  it('a rendered ChatGPT message keeps its timeline id, export text and send text', async () => {
    const bubble = chatgptMessage('Is $I_3$ the identity?');
    const before = turnSummary(bubble);
    activate(sites[0].adapter);
    await vi.waitFor(() => expect(rendered(bubble)).toHaveLength(1));

    expect(turnSummary(bubble)).toBe(before);
    expect(textWithLatexSource(bubble)).toBe('Is $I_3$ the identity?');
    const exported: string[] = [];
    chatgptExtractUserText(document.querySelectorAll('.none'), exported, bubble);
    expect(exported).toEqual(['Is $I_3$ the identity?']);
  });
});
