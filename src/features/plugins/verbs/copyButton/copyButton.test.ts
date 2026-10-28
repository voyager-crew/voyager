import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastDriver } from '@/tests/toastDriver';
import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { SEMANTIC_SELECTOR_KEYS } from '../../sites/semanticKeys';
import type { SiteAdapter } from '../../types';
import type { PrimitiveContext } from '../types';
import { COPY_BUTTON_CLASS, type CopyTarget } from './button';
import { copyButtonPrimitive } from './index';

/**
 * Inside the target: Voyager's own toggle (a control, left out of the copy) and
 * a code block Voyager stamped a class on (host content, kept in the copy).
 */
const BODY =
  '<p>Step one</p>\n<button class="gv-code-block-toggle">Collapse</button>\n' +
  '<pre class="gv-code-block-clip">x = 1</pre>';
const COPIED = 'Step one\n\nx = 1';

/** Each site with one target element (`#target`), plus elements the button must leave alone. */
const sites: {
  name: string;
  adapter: SiteAdapter;
  target: CopyTarget;
  page: string;
  /** Markup for another target element, added later. */
  another: (id: string) => string;
}[] = [
  {
    name: 'DeepSeek thinking block',
    adapter: requireBundledSiteAdapter('deepseek'),
    target: 'thinkingBlock',
    page:
      '<div class="ds-message"><div class="ds-collapsible-text">Question</div></div>' +
      `<div class="ds-message" id="reply"><div class="ds-think-content" id="target">  ${BODY}  </div>` +
      '<div class="ds-assistant-message-main-content"><div class="ds-markdown">Answer</div></div></div>',
    another: (id) =>
      `<div class="ds-message"><div class="ds-think-content" id="${id}">More</div>` +
      '<div class="ds-assistant-message-main-content"><div class="ds-markdown">Answer</div></div></div>',
  },
  {
    name: 'ChatGPT user message',
    adapter: requireBundledSiteAdapter('chatgpt'),
    target: 'userTurn',
    page:
      `<div data-message-author-role="user"><div data-user-message-bubble="true" id="target">  ${BODY}  </div></div>` +
      '<div data-chatgpt-selection-message-id="m1" id="reply"><div class="markdown">Answer</div></div>',
    another: (id) =>
      `<div data-message-author-role="user"><div data-user-message-bubble="true" id="${id}">More</div></div>`,
  },
];

const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>() };
let scope: PluginScope;

function activate(adapter: SiteAdapter, target: CopyTarget) {
  let counter: () => number = () => -1;
  const context: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'test.copy-button',
    settings: {},
    setTargetCounter: (count) => (counter = count),
  };
  void copyButtonPrimitive.activate(scope, { target, format: 'text' }, context);
  return { count: () => counter() };
}

const hosts = () => Array.from(document.querySelectorAll<HTMLElement>(`.${COPY_BUTTON_CLASS}`));
const buttonOf = (host: HTMLElement) => host.shadowRoot!.querySelector('button')!;
/** The element each button sits on, by id. */
const targets = () => hosts().map((host) => host.nextElementSibling?.id);

beforeEach(() => {
  vi.useFakeTimers();
  scope = new PluginScope();
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.assign(Object.create(window.navigator), { clipboard }));
});

afterEach(async () => {
  await scope.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await setCachedLanguage('en');
  document.body.innerHTML = '';
});

describe('copyButton primitive', () => {
  it('accepts exactly the targets its contract lets the static checks allow', () => {
    const allowed: readonly string[] = copyButtonPrimitive.contract.params.target.allowedKeys ?? [];
    for (const target of SEMANTIC_SELECTOR_KEYS) {
      expect(copyButtonPrimitive.validateParams({ target }).success, target).toBe(
        allowed.includes(target),
      );
    }
  });

  it('accepts a known target with the text format, and nothing else', () => {
    for (const target of ['userTurn', 'assistantTurn', 'thinkingBlock', 'codeBlock']) {
      expect(copyButtonPrimitive.validateParams({ target })).toEqual({
        success: true,
        data: { target, format: 'text' },
      });
    }
    expect(copyButtonPrimitive.validateParams({ target: 'userTurn', format: 'text' })).toEqual({
      success: true,
      data: { target: 'userTurn', format: 'text' },
    });

    const issues = (raw: unknown) => {
      const result = copyButtonPrimitive.validateParams(raw);
      return result.success ? [] : result.error.map((issue) => issue.path);
    };
    expect(issues({ target: 'userTurn', selector: '.x' })).toEqual(['params.selector']);
    for (const format of ['markdown', 'html', '', 1, null]) {
      expect(issues({ target: 'userTurn', format })).toEqual(['params.format']);
    }
    // Not message content, not a key at all, a raw selector, or missing.
    for (const target of ['composer', 'sidebar', 'thinking', '.ds-think-content', 3]) {
      expect(issues({ target })).toEqual(['params.target']);
    }
    expect(issues({})).toEqual(['params.target']);
    expect(issues(undefined)).toEqual(['params.target']);
    for (const raw of [null, [], 'userTurn', 1, false]) {
      expect(issues(raw)).toEqual(['params']);
    }
  });

  describe.each(sites)('$name', ({ adapter, target, page, another }) => {
    it('puts one button before each target element and nowhere else', () => {
      document.body.innerHTML = page;
      const { count } = activate(adapter, target);

      expect(targets()).toEqual(['target']);
      expect(count()).toBe(1);
    });

    it("copies the element's text without Voyager's controls and confirms with a toast", async () => {
      document.body.innerHTML = page;
      activate(adapter, target);

      buttonOf(hosts()[0]).click();
      await vi.advanceTimersByTimeAsync(10);

      expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(COPIED);
      expect(toastDriver.all().map(({ message, tone }) => ({ message, tone }))).toEqual([
        { message: 'Copied to clipboard', tone: 'success' },
      ]);
    });

    it('an element added or re-rendered later gets exactly one button', async () => {
      document.body.innerHTML = page;
      activate(adapter, target);

      document.body.insertAdjacentHTML('beforeend', another('later'));
      const original = document.getElementById('target')!;
      const rerendered = original.cloneNode(true) as HTMLElement;
      rerendered.id = 'rerendered';
      original.replaceWith(rerendered);
      await vi.advanceTimersByTimeAsync(1_000);
      // A scan with nothing new must not add a second button.
      document.body.insertAdjacentHTML('beforeend', '<p>unrelated</p>');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(targets()).toEqual(['rerendered', 'later']);
    });

    it('turning the plugin off removes the buttons, the toasts and the observer', async () => {
      document.body.innerHTML = page;
      const original = document.body.innerHTML;
      activate(adapter, target);
      buttonOf(hosts()[0]).click();
      await vi.advanceTimersByTimeAsync(10);
      expect(toastDriver.all()).toHaveLength(1);

      await scope.dispose();

      expect(document.body.innerHTML).toBe(original);
      expect(document.querySelectorAll('[data-gv-layer]')).toHaveLength(0);
      document.body.insertAdjacentHTML('beforeend', another('after'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(hosts()).toHaveLength(0);
    });
  });

  it('reports a copy the browser refused instead of claiming success', async () => {
    document.body.innerHTML = sites[0].page;
    activate(sites[0].adapter, sites[0].target);
    clipboard.writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    buttonOf(hosts()[0]).click();
    await vi.advanceTimersByTimeAsync(10);

    expect(toastDriver.all().map(({ message, tone }) => ({ message, tone }))).toEqual([
      { message: 'Couldn’t copy the text', tone: 'error' },
    ]);
  });

  it('reads the rendered text, hiding its controls only for the read', async () => {
    document.body.innerHTML = sites[0].page;
    activate(sites[0].adapter, sites[0].target);
    const element = document.getElementById('target')!;
    // jsdom does not lay out; this stands in for the browser's rendered text.
    Object.defineProperty(element, 'innerText', {
      get: () =>
        Array.from(element.children)
          .filter((child) => (child as HTMLElement).style.display !== 'none')
          .map((child) => child.textContent)
          .join('\n') + '\n',
    });

    buttonOf(hosts()[0]).click();
    await vi.advanceTimersByTimeAsync(10);

    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith('Step one\nx = 1');
    expect(element.querySelector('button')!.hasAttribute('style')).toBe(false);
  });

  it('a page whose adapter lacks the target key gets no button', () => {
    document.body.innerHTML = sites[1].page;
    activate(sites[1].adapter, 'thinkingBlock');

    expect(hosts()).toHaveLength(0);
  });

  it('the button label names what it copies and follows the Voyager language', async () => {
    document.body.innerHTML = sites[0].page;
    activate(sites[0].adapter, 'thinkingBlock');
    const button = buttonOf(hosts()[0]);
    expect(button.getAttribute('aria-label')).toBe('Copy thinking');

    await setCachedLanguage('zh');

    expect(button.getAttribute('aria-label')).toBe('复制思考过程');
    expect(button.title).toBe('复制思考过程');
  });
});
