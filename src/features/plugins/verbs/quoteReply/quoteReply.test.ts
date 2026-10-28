import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readComposer } from '@/core/services/composer';
import { installNativeEditingMock } from '@/tests/nativeEditing';
import { toastDriver } from '@/tests/toastDriver';
import { setCachedLanguage } from '@/utils/i18n';

import { DeclarativeEngine } from '../../runtime/declarativeEngine';
import { PluginScope } from '../../runtime/pluginScope';
import { chatgptAdapter } from '../../sites/adapters/chatgpt';
import { claudeAdapter } from '../../sites/adapters/claude';
import { deepseekAdapter } from '../../sites/adapters/deepseek';
import type { PluginManifest, SiteAdapter } from '../../types';
import { quoteReplyPrimitive } from './index';

const sites = [
  {
    name: 'ChatGPT',
    adapter: chatgptAdapter,
    turn: (id: string, content: string) =>
      `<div data-chatgpt-selection-message-id="${id}" id="${id}">${content}</div>`,
    user: '<div data-user-message-bubble id="user">Question</div>',
    composer:
      '<form><div data-composer-markdown contenteditable="true"></div><button type="submit">Send</button></form>',
  },
  {
    name: 'Claude',
    adapter: claudeAdapter,
    turn: (id: string, content: string) =>
      `<div data-testid="assistant-message" id="${id}">${content}</div>`,
    user: '<div data-testid="user-message" id="user">Question</div>',
    composer:
      '<div data-composer-card-holder><div><div data-testid="chat-input" contenteditable="true"></div><button data-testid="chat-input-send">Send</button></div></div>',
  },
  {
    name: 'DeepSeek',
    adapter: deepseekAdapter,
    turn: (id: string, content: string) =>
      `<div class="ds-message" id="${id}"><div class="ds-assistant-message-main-content">${content}</div></div>`,
    user: '<div class="ds-message" id="user"><div class="ds-collapsible-text">Question</div></div>',
    composer:
      '<div><div><textarea class="ds-scroll-area"></textarea></div><div class="ds-button--primary ds-button--circle" role="button">Send</div></div>',
  },
];

const rect = {
  x: 20,
  y: 40,
  top: 40,
  left: 20,
  right: 180,
  bottom: 60,
  width: 160,
  height: 20,
  toJSON: () => ({}),
};
const scopes: PluginScope[] = [];
const engines: DeclarativeEngine[] = [];
let restoreEditing: () => void;
let rangeRectDescriptor: PropertyDescriptor | undefined;
let rangeRectsDescriptor: PropertyDescriptor | undefined;

function fixture(site: (typeof sites)[number], draft = '') {
  document.body.innerHTML =
    '<main>' +
    site.user +
    site.turn('answer', '<p id="selected">First<br>Second</p>') +
    site.turn('another', '<p>Other answer</p>') +
    '<p id="outside">Outside</p></main>' +
    site.composer;
  const field = document.querySelector<HTMLElement>(site.adapter.selectors.composer!)!;
  if (field instanceof HTMLTextAreaElement) field.value = draft;
  else field.textContent = draft;
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(rect);
  const sends = vi.fn((event: Event) => event.preventDefault());
  document.querySelector(site.adapter.selectors.sendButton!)!.addEventListener('click', sends);
  const keys = vi.fn();
  field.addEventListener('keydown', keys);
  return { field, sends, keys };
}

function activate(adapter: SiteAdapter): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  void quoteReplyPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter,
      pluginId: 'test.quote-reply',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  return scope;
}

function select(element: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  return range;
}

const button = () => document.querySelector<HTMLButtonElement>('.gv-quote-reply-button');

function quoteButton(): HTMLButtonElement {
  const control = button();
  if (!control) throw new Error('Expected a quote action for this selection');
  return control;
}

beforeEach(async () => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  await setCachedLanguage('en');
  restoreEditing = installNativeEditingMock();
  rangeRectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  rangeRectsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [rect],
  });
});

afterEach(async () => {
  for (const engine of engines.splice(0)) engine.unmountAll();
  for (const scope of scopes.splice(0)) await scope.dispose();
  restoreEditing();
  for (const [key, descriptor] of [
    ['getBoundingClientRect', rangeRectDescriptor],
    ['getClientRects', rangeRectsDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
    else Reflect.deleteProperty(Range.prototype, key);
  }
  vi.restoreAllMocks();
  await setCachedLanguage('en');
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('quoteReply primitive', () => {
  describe.each(sites)('$name adapter', (site) => {
    it('offers one accessible Quote action only inside one assistant answer', () => {
      fixture(site);
      activate(site.adapter);
      select(document.getElementById('selected')!);
      expect(document.querySelectorAll('.gv-quote-reply-button')).toHaveLength(1);
      expect(quoteButton().tagName).toBe('BUTTON');
      expect(quoteButton().getAttribute('aria-label')).toBe('Quote');
      expect(quoteButton().disabled).toBe(false);
      expect(quoteButton().tabIndex).toBe(0);

      select(document.getElementById('user')!);
      expect(button()).toBeNull();
      select(document.getElementById('outside')!);
      expect(button()).toBeNull();
      const spanning = document.createRange();
      spanning.setStart(document.getElementById('selected')!.firstChild!, 0);
      spanning.setEnd(document.getElementById('another')!.querySelector('p')!.firstChild!, 5);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(spanning);
      document.dispatchEvent(new Event('selectionchange'));
      expect(button()).toBeNull();
      select(document.querySelector('main')!);
      expect(button()).toBeNull();
    });

    it.each(['', 'Existing draft', ' \n '])(
      'appends multiline quotes to the %j draft without sending',
      (draft) => {
        const { field, sends, keys } = fixture(site, draft);
        activate(site.adapter);
        select(document.getElementById('selected')!);

        quoteButton().click();

        expect(readComposer(field)).toBe(`${draft}${draft ? '\n\n' : ''}> First\n> Second\n`);
        expect(document.activeElement).toBe(field);
        if (field instanceof HTMLTextAreaElement) {
          expect(field.selectionStart).toBe(field.value.length);
          expect(field.selectionEnd).toBe(field.value.length);
        } else {
          const selection = document.getSelection()!;
          expect(selection.isCollapsed).toBe(true);
          const following = document.createRange();
          following.selectNodeContents(field);
          following.setStart(selection.anchorNode!, selection.anchorOffset);
          expect(following.toString()).toBe('');
        }
        expect(sends).not.toHaveBeenCalled();
        expect(keys).not.toHaveBeenCalled();
      },
    );

    it('quotes the captured answer when its native button takes keyboard focus', () => {
      const { field } = fixture(site);
      activate(site.adapter);
      select(document.getElementById('selected')!);
      const control = quoteButton();

      control.focus();
      expect(document.activeElement).toBe(control);
      document.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      expect(document.activeElement).toBe(control);
      control.click();

      expect(readComposer(field)).toBe('> First\n> Second\n');
    });

    it('hides a collapsed selection action when keyboard focus leaves the Quote button', () => {
      const { field } = fixture(site);
      activate(site.adapter);
      select(document.getElementById('selected')!);
      const control = quoteButton();
      control.focus();
      document.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      expect(button()).toBe(control);

      field.focus();

      expect(document.activeElement).toBe(field);
      expect(button()).toBeNull();
    });

    it('offers Quote for an answer already selected when the plugin is enabled', () => {
      fixture(site);
      select(document.getElementById('selected')!);
      expect(button()).toBeNull();

      activate(site.adapter);

      expect(quoteButton().getAttribute('aria-label')).toBe('Quote');
    });

    it('keeps the selection and shows a toast when the composer is unavailable', () => {
      const { field, sends, keys } = fixture(site);
      field.remove();
      activate(site.adapter);
      const original = select(document.getElementById('selected')!);
      const before = {
        start: original.startContainer,
        startOffset: original.startOffset,
        end: original.endContainer,
        endOffset: original.endOffset,
      };

      quoteButton().click();

      expect(toastDriver.messages()).toHaveLength(1);
      expect(toastDriver.messages()[0]).toMatch(/composer/i);
      const selected = document.getSelection()!.getRangeAt(0);
      expect(selected.startContainer).toBe(before.start);
      expect(selected.startOffset).toBe(before.startOffset);
      expect(selected.endContainer).toBe(before.end);
      expect(selected.endOffset).toBe(before.endOffset);
      expect(selected.toString()).toBe('FirstSecond');
      expect(sends).not.toHaveBeenCalled();
      expect(keys).not.toHaveBeenCalled();
    });

    it.each(['collapse', 'scroll', 'Escape', 'outside press', 'rerender'])(
      'hides the action on %s',
      async (cause) => {
        fixture(site);
        activate(site.adapter);
        select(document.getElementById('selected')!);
        expect(button()).not.toBeNull();

        if (cause === 'collapse') {
          document.getSelection()!.collapseToEnd();
          document.dispatchEvent(new Event('selectionchange'));
        }
        if (cause === 'scroll') document.querySelector('main')!.dispatchEvent(new Event('scroll'));
        if (cause === 'Escape')
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (cause === 'outside press')
          document
            .getElementById('outside')!
            .dispatchEvent(new Event('pointerdown', { bubbles: true }));
        if (cause === 'rerender') {
          document
            .getElementById('answer')!
            .replaceWith(document.getElementById('answer')!.cloneNode(true));
          await Promise.resolve();
        }

        expect(button()).toBeNull();
      },
    );

    it('keeps the action when another plugin restamps attributes on the selected answer', async () => {
      fixture(site);
      activate(site.adapter);
      select(document.getElementById('selected')!);

      document.getElementById('answer')!.setAttribute('data-gv-font-size', '16');
      document.getElementById('selected')!.setAttribute('class', 'gv-restamped');
      await Promise.resolve();

      expect(button()).not.toBeNull();
    });

    it('ignores outside presses on Voyager layers', () => {
      fixture(site);
      activate(site.adapter);
      select(document.getElementById('selected')!);
      const layer = document.createElement('div');
      layer.setAttribute('data-gv-layer', 'toast');
      const action = document.createElement('button');
      layer.attachShadow({ mode: 'open' }).append(action);
      document.body.append(layer);

      action.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));

      expect(button()).not.toBeNull();
    });

    it('restores head and body synchronously when unmounted with a selected answer', async () => {
      fixture(site);
      const beforeHead = document.head.innerHTML;
      const beforeBody = document.body.innerHTML;
      const scope = activate(site.adapter);
      select(document.getElementById('selected')!);
      expect(button()).not.toBeNull();

      const disposal = scope.dispose();

      expect(document.head.innerHTML).toBe(beforeHead);
      expect(document.body.innerHTML).toBe(beforeBody);
      select(document.getElementById('selected')!);
      expect(button()).toBeNull();
      document.getElementById('answer')!.append(document.createTextNode('More'));
      await disposal;
      await Promise.resolve();
      expect(button()).toBeNull();
      expect(document.querySelector('[data-gv-layer]')).toBeNull();
    });

    it('quotes KaTeX as LaTeX and preserves paragraph breaks', () => {
      const { field } = fixture(site);
      document.getElementById('selected')!.outerHTML =
        '<div id="math"><p>Inline <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span></p><p><span class="katex-display"><span class="katex"><math><semantics><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math><span aria-hidden="true">ab</span></span></span></p></div>';
      activate(site.adapter);
      select(document.getElementById('math')!);

      quoteButton().click();

      expect(readComposer(field)).toBe('> Inline $x^2$\n> $$\\frac{a}{b}$$\n');
    });

    it('keeps one blank quote line for an empty paragraph between paragraphs', () => {
      const { field } = fixture(site);
      document.getElementById('selected')!.outerHTML =
        '<div id="paragraphs"><p>First</p><p><br></p><p>Second</p></div>';
      activate(site.adapter);
      select(document.getElementById('paragraphs')!);

      quoteButton().click();

      expect(readComposer(field)).toBe('> First\n> \n> Second\n');
    });

    it('quotes a selection of the complete KaTeX contents as one formula', () => {
      const { field } = fixture(site);
      document.getElementById('selected')!.innerHTML =
        '<span class="katex" id="formula"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math><span aria-hidden="true">x2</span></span>';
      activate(site.adapter);
      select(document.getElementById('formula')!);

      quoteButton().click();

      expect(readComposer(field)).toBe('> $x^2$\n');
    });

    it('does not leave quote styles in head after settings update and immediate engine unmount', async () => {
      fixture(site);
      const engine = new DeclarativeEngine({ doc: document, adapter: site.adapter });
      engines.push(engine);
      const manifest: PluginManifest = {
        id: 'test.quote-engine-unmount',
        name: 'Quote replies',
        version: '1.0.0',
        description: 'Quote selected answer text',
        author: 'Test',
        category: 'productivity',
        license: 'MIT',
        engine: '>=next',
        tier: 'declarative',
        matches: [...site.adapter.matches],
        contributes: {
          settings: { enabled: { type: 'boolean', label: 'Enabled', default: true } },
          domOps: [{ op: 'native', handler: 'quoteReply', params: {} }],
        },
      };
      const headWithoutBase = () =>
        Array.from(document.head.children)
          .filter((element) => element.id !== 'gv-plugin-base-style')
          .map((element) => element.outerHTML)
          .join('');
      const beforeHead = headWithoutBase();
      const beforeBody = document.body.innerHTML;
      engine.mount(manifest);
      select(document.getElementById('selected')!);
      expect(button()).not.toBeNull();

      engine.updateSettings(manifest.id, { enabled: false });
      engine.unmount(manifest.id);

      expect(headWithoutBase()).toBe(beforeHead);
      expect(document.body.innerHTML).toBe(beforeBody);
      await Promise.resolve();
      select(document.getElementById('selected')!);
      expect(button()).toBeNull();
      expect(headWithoutBase()).toBe(beforeHead);
      expect(document.body.innerHTML).toBe(beforeBody);
    });
  });

  it('reads ChatGPT math source without copying duplicate rendered KaTeX text', () => {
    const { field } = fixture(sites[0]);
    document.getElementById('selected')!.outerHTML =
      '<div id="math-source"><p>Inline <span data-math-source="x^2"><span class="katex"><span aria-hidden="true">x2</span></span></span></p><p><span data-math-source="\\frac{a}{b}"><span class="katex-display"><span class="katex"><span aria-hidden="true">ab</span></span></span></span></p></div>';
    activate(chatgptAdapter);
    select(document.getElementById('math-source')!);

    quoteButton().click();

    expect(readComposer(field)).toBe('> Inline $x^2$\n> $$\\frac{a}{b}$$\n');
  });

  it('reads ChatGPT math source on the ancestor of selected KaTeX contents', () => {
    const { field } = fixture(sites[0]);
    document.getElementById('selected')!.innerHTML =
      '<span data-math-source="x^2"><span class="katex" id="formula"><span aria-hidden="true">x2</span></span></span>';
    activate(chatgptAdapter);
    select(document.getElementById('formula')!);

    quoteButton().click();

    expect(readComposer(field)).toBe('> $x^2$\n');
  });

  it('excludes a DeepSeek thinking block and selections that cross it', () => {
    fixture(sites[2]);
    document.getElementById('answer')!.innerHTML =
      '<div class="ds-assistant-message-main-content"><p id="before">Answer start</p></div><div class="ds-think-content" id="thinking">Private thinking</div><div class="ds-assistant-message-main-content"><p id="after">Answer end</p></div>';
    activate(deepseekAdapter);
    select(document.getElementById('thinking')!);
    expect(button()).toBeNull();
    const range = document.createRange();
    range.setStart(document.getElementById('before')!.firstChild!, 0);
    range.setEnd(document.getElementById('after')!.firstChild!, 10);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    expect(button()).toBeNull();
    select(document.getElementById('after')!);
    expect(button()).not.toBeNull();
  });

  // Rich editors only: a textarea always takes the value.
  it.each(sites.slice(0, 2))(
    'keeps the selection and Quote on $name and says so when the composer refuses the quote',
    (site) => {
      const { field, sends } = fixture(site, 'Existing draft');
      activate(site.adapter);
      select(document.getElementById('selected')!);
      vi.mocked(document.execCommand).mockReturnValue(false);

      quoteButton().click();

      expect(readComposer(field)).toBe('Existing draft');
      expect(toastDriver.messages()).toEqual([expect.stringMatching(/quote/i)]);
      expect(document.getSelection()!.toString()).toBe('FirstSecond');
      expect(button()).not.toBeNull();
      expect(sends).not.toHaveBeenCalled();
    },
  );
});
