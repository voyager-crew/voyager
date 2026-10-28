import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeLexical, mountFakeLexical } from '@/tests/fakeLexical';
import { installNativeEditingMock } from '@/tests/nativeEditing';
import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { quoteReplyPrimitive } from './index';

const kimi = requireBundledSiteAdapter('kimi');
const rect = new DOMRect(20, 40, 160, 20);
const scopes: PluginScope[] = [];
const restores: Array<() => void> = [];
let editor: FakeLexical;

// Kimi's reply and its Lexical composer, as measured live (2026-10-24).
function mountPage(draft: string): HTMLElement {
  document.body.innerHTML =
    '<div class="segment-assistant"><div class="thinking-container"><div class="paragraph">Thinking</div></div>' +
    '<div class="markdown"><div class="paragraph" id="selected">First<br>Second</div></div></div>' +
    '<div class="chat-editor-content"><div class="chat-input-editor" contenteditable="true" role="textbox"></div>' +
    '<div class="send-button-container disabled"></div></div>';
  const field = document.querySelector<HTMLElement>(kimi.selectors.composer!)!;
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(rect);
  editor = mountFakeLexical(field, draft);
  restores.push(() => editor.restore());
  return field;
}

function quoteSelection(): void {
  const scope = new PluginScope();
  scopes.push(scope);
  void quoteReplyPrimitive.activate(
    scope,
    {},
    { doc: document, adapter: kimi, pluginId: 'test', settings: {}, setTargetCounter: () => {} },
  );
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('selected')!);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  document.querySelector<HTMLButtonElement>('.gv-quote-reply-button')!.click();
}

beforeEach(async () => {
  await setCachedLanguage('en');
  restores.push(installNativeEditingMock());
  for (const key of ['getBoundingClientRect', 'getClientRects'] as const) {
    const previous = Object.getOwnPropertyDescriptor(Range.prototype, key);
    Object.defineProperty(Range.prototype, key, {
      configurable: true,
      value: key === 'getClientRects' ? () => [rect] : () => rect,
    });
    restores.push(() => {
      if (previous) Object.defineProperty(Range.prototype, key, previous);
      else Reflect.deleteProperty(Range.prototype, key);
    });
  }
});

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  for (const restore of restores.splice(0).reverse()) restore();
  vi.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('quoteReply on a Lexical composer (Kimi)', () => {
  it('adds the quote below a draft already in the composer', async () => {
    const field = mountPage('Voyager 测试');

    quoteSelection();
    await Promise.resolve();

    expect(editor.text()).toBe('Voyager 测试\n\n> First\n> Second\n');
    expect(field.querySelectorAll('[data-lexical-text]')).toHaveLength(3);
    expect(document.activeElement).toBe(field);
  });

  it('quotes into an empty composer', async () => {
    mountPage('');

    quoteSelection();
    await Promise.resolve();

    expect(editor.text()).toBe('> First\n> Second\n');
  });
});
