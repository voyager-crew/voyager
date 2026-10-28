import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastDriver } from '@/tests/toastDriver';
import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import type { SiteAdapter } from '../../types';
import type { PrimitiveContext } from '../types';
import { tableCopyPrimitive } from './index';
import { TABLE_COPY_CLASS } from './toolbar';

const FORMULA =
  '<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi>' +
  '<annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>' +
  '<span class="katex-html" aria-hidden="true">x2</span></span>';
const TABLE = (id: string) =>
  `<table id="${id}"><thead><tr><th>Term</th></tr></thead><tbody><tr><td>${FORMULA}</td></tr></tbody></table>`;

/** A reply with a table, a table in its thinking block (DeepSeek) and a table the user pasted. */
const sites: { name: string; adapter: SiteAdapter; page: string; reply: string }[] = [
  {
    name: 'DeepSeek',
    adapter: requireBundledSiteAdapter('deepseek'),
    page:
      `<div class="ds-message"><div class="ds-collapsible-text">${TABLE('user')}</div></div>` +
      '<div class="ds-message"><div class="ds-think-content">' +
      TABLE('thinking') +
      `</div><div class="ds-assistant-message-main-content"><div class="ds-markdown">${TABLE('answer')}</div></div></div>`,
    reply: '.ds-markdown',
  },
  {
    name: 'ChatGPT',
    adapter: requireBundledSiteAdapter('chatgpt'),
    page:
      `<div data-message-author-role="user"><div data-user-message-bubble="true">${TABLE('user')}</div></div>` +
      `<div data-chatgpt-selection-message-id="m1"><div class="markdown">${TABLE('answer')}</div></div>`,
    reply: '.markdown',
  },
];

const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>() };
let scope: PluginScope;

function activate(adapter: SiteAdapter) {
  let counter: () => number = () => -1;
  const context: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'test.table-copy',
    settings: {},
    setTargetCounter: (count) => (counter = count),
  };
  void tableCopyPrimitive.activate(scope, {}, context);
  return { count: () => counter() };
}

const toolbars = () => Array.from(document.querySelectorAll<HTMLElement>(`.${TABLE_COPY_CLASS}`));
const button = (toolbar: HTMLElement, format: 'markdown' | 'tsv') =>
  toolbar.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-format="${format}"]`)!;

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

describe('tableCopy primitive', () => {
  it('accepts empty params and rejects selector overrides or any other keys', () => {
    expect(tableCopyPrimitive.validateParams(undefined)).toEqual({ success: true, data: {} });
    expect(tableCopyPrimitive.validateParams({})).toEqual({ success: true, data: {} });
    for (const key of ['turn', 'table', 'unknown']) {
      expect(tableCopyPrimitive.validateParams({ [key]: 'table.answer' })).toEqual({
        success: false,
        error: [{ path: `params.${key}`, message: 'unknown parameter' }],
      });
    }
    for (const raw of [null, [], 'table', 1, false]) {
      expect(tableCopyPrimitive.validateParams(raw)).toEqual({
        success: false,
        error: [{ path: 'params', message: 'must be an object' }],
      });
    }
  });

  describe.each(sites)('$name', ({ adapter, page, reply }) => {
    it('puts a toolbar above reply tables only, not the thinking block or the user message', () => {
      document.body.innerHTML = page;
      const { count } = activate(adapter);

      expect(toolbars()).toHaveLength(1);
      expect(toolbars()[0].nextElementSibling?.id).toBe('answer');
      expect(count()).toBe(1);
    });

    it('copying a table with a formula keeps the LaTeX and confirms with a toast', async () => {
      document.body.innerHTML = page;
      activate(adapter);

      button(toolbars()[0], 'markdown').click();
      await vi.advanceTimersByTimeAsync(10);
      expect(clipboard.writeText).toHaveBeenLastCalledWith('| Term |\n| --- |\n| $x^2$ |');
      expect(toastDriver.messages()).toEqual(['Table copied']);

      button(toolbars()[0], 'tsv').click();
      await vi.advanceTimersByTimeAsync(10);
      expect(clipboard.writeText).toHaveBeenLastCalledWith('Term\n$x^2$');
    });

    it('turning the plugin off removes the toolbars and restores the page', async () => {
      document.body.innerHTML = page;
      const original = document.body.innerHTML;
      activate(adapter);
      expect(document.body.innerHTML).not.toBe(original);

      await scope.dispose();

      expect(toolbars()).toHaveLength(0);
      expect(document.body.innerHTML).toBe(original);
    });

    it('a table that streams in or is rebuilt gets one toolbar once the reply settles', async () => {
      document.body.innerHTML = page;
      activate(adapter);
      const container = document.querySelector(reply)!;

      container.innerHTML = TABLE('rebuilt') + TABLE('second');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(toolbars().map((toolbar) => toolbar.nextElementSibling?.id)).toEqual([
        'rebuilt',
        'second',
      ]);
    });
  });

  it('reports a copy the browser refused instead of claiming success', async () => {
    document.body.innerHTML = sites[0].page;
    activate(sites[0].adapter);
    clipboard.writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    button(toolbars()[0], 'markdown').click();
    await vi.advanceTimersByTimeAsync(10);

    expect(toastDriver.all().map(({ message, tone }) => ({ message, tone }))).toEqual([
      { message: 'Couldn’t copy the table', tone: 'error' },
    ]);
  });

  it('rendered buttons follow the Voyager language', async () => {
    document.body.innerHTML = sites[0].page;
    activate(sites[0].adapter);
    const markdown = button(toolbars()[0], 'markdown');
    expect(markdown.getAttribute('aria-label')).toBe('Copy table as Markdown');

    await setCachedLanguage('zh');

    expect(markdown.getAttribute('aria-label')).toBe('将表格复制为 Markdown');
    expect(markdown.title).toBe('将表格复制为 Markdown');
  });

  it('a page without a reply adapter selector gets no toolbar', () => {
    document.body.innerHTML = sites[0].page;
    activate({
      ...sites[0].adapter,
      selectors: { ...sites[0].adapter.selectors, assistantTurn: '' },
    });

    expect(toolbars()).toHaveLength(0);
  });
});
