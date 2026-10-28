import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import type { SiteAdapter } from '../../types';
import { copyableText } from '../copyButton/text';
import { badgeLabel } from './badge';
import { countText } from './count';
import { type CounterBadgeParams, counterBadgePrimitive } from './index';
import { TURN_SETTLE_MS } from './turnBadges';

interface SiteFixture {
  readonly name: string;
  readonly adapter: SiteAdapter;
  /** A composer whose draft is `draft`, inside its composer root. */
  composer(draft: string[]): string;
  /** An assistant turn whose reply paragraph is `text`. */
  turn(text: string): string;
}

const paragraphs = (lines: string[]): string =>
  lines.length === 0 ? '<p><br></p>' : lines.map((line) => `<p>${line}</p>`).join('');

const sites: SiteFixture[] = [
  {
    name: 'ChatGPT',
    adapter: requireBundledSiteAdapter('chatgpt'),
    composer: (draft) =>
      '<form data-fixture-root><div data-composer-markdown class="ProseMirror" contenteditable="true">' +
      paragraphs(draft) +
      '</div><button type="submit">Send</button></form>',
    turn: (text) =>
      `<div data-chatgpt-selection-message-id="m1"><div class="markdown"><p>${text}</p></div></div>`,
  },
  {
    name: 'Claude',
    adapter: requireBundledSiteAdapter('claude'),
    composer: (draft) =>
      '<div data-composer-card-holder><div data-fixture-root>' +
      '<div data-testid="chat-input" class="ProseMirror" contenteditable="true">' +
      paragraphs(draft) +
      '</div><button data-testid="chat-input-send">Send</button></div></div>',
    turn: (text) =>
      `<div data-testid="assistant-message"><div class="font-claude-message"><p>${text}</p></div></div>`,
  },
  {
    name: 'DeepSeek',
    adapter: requireBundledSiteAdapter('deepseek'),
    composer: (draft) =>
      '<div data-fixture-root><div><textarea class="ds-scroll-area">' +
      draft.join('\n') +
      '</textarea></div><div class="ds-button--primary ds-button--circle" role="button">Send</div></div>',
    turn: (text) =>
      `<div class="ds-message"><div class="ds-assistant-message-main-content"><p>${text}</p></div></div>`,
  },
];

const scopes: PluginScope[] = [];

function activate(adapter: SiteAdapter, params: CounterBadgeParams): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  void counterBadgePrimitive.activate(scope, params, {
    doc: document,
    adapter,
    pluginId: 'test.counter-badge',
    settings: {},
    setTargetCounter: () => {},
  });
  return scope;
}

function badges(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-gv-counter-badge]'));
}

function onlyBadge(): HTMLElement {
  const found = badges();
  expect(found).toHaveLength(1);
  return found[0];
}

function composerOf(site: SiteFixture): HTMLElement {
  return document.querySelector<HTMLElement>(site.adapter.selectors.composer!)!;
}

/** Replace the draft the way the host does, then report it as typed input. */
function typeDraft(field: HTMLElement, lines: string[]): void {
  if (field instanceof HTMLTextAreaElement) field.value = lines.join('\n');
  else field.innerHTML = paragraphs(lines);
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  });
  await setCachedLanguage('en');
  document.head.replaceChildren();
  document.body.replaceChildren();
});

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  await setCachedLanguage('en');
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('counterBadge metrics', () => {
  it('counts code points without line breaks, so an astral emoji is one character', () => {
    expect(countText('a😀b', 'chars')).toBe(3);
    expect(countText('ab\ncd\r\nef', 'chars')).toBe(6);
    // A ZWJ family is five code points (three emoji, two joiners): the metric is code points, not graphemes.
    expect(countText('👨‍👩‍👧', 'chars')).toBe(5);
    expect(countText('', 'chars')).toBe(0);
  });

  it('counts each CJK character as a word and skips punctuation-only tokens', () => {
    expect(countText('日本語 hello world', 'words')).toBe(5);
    expect(countText('你好，世界。 — ok', 'words')).toBe(5);
    expect(countText('한국어 문장', 'words')).toBe(5);
    expect(countText('  \n ', 'words')).toBe(0);
  });

  it('counts only Han, kana and Hangul for cjkChars', () => {
    expect(countText('漢字かなカナ한글 abc 123 。', 'cjkChars')).toBe(8);
    expect(countText('plain text', 'cjkChars')).toBe(0);
  });

  it('counts lines, with an empty draft at zero and a trailing break opening a line', () => {
    expect(countText('', 'lines')).toBe(0);
    expect(countText('one', 'lines')).toBe(1);
    expect(countText('one\ntwo\r\nthree', 'lines')).toBe(3);
    expect(countText('one\n', 'lines')).toBe(2);
  });
});

describe('counterBadge params', () => {
  it('defaults the metric to chars', () => {
    expect(counterBadgePrimitive.validateParams({ target: 'composer' })).toEqual({
      success: true,
      data: { target: 'composer', metric: 'chars' },
    });
  });

  it.each([
    undefined,
    null,
    {},
    { target: 'userTurn' },
    { target: 'composer', metric: 'tokens' },
    { target: 'composer', extra: true },
  ])('rejects %j', (params) => {
    expect(counterBadgePrimitive.validateParams(params).success).toBe(false);
  });
});

describe.each(sites)('counterBadge composer on $name', (site) => {
  it('shows the draft count above the composer root and follows typing', async () => {
    document.body.innerHTML = `<main>${site.composer(['draft'])}</main>`;
    activate(site.adapter, { target: 'composer', metric: 'chars' });

    const badge = onlyBadge();
    const root = composerOf(site).closest(site.adapter.selectors.composerRoot!);
    expect(badge.parentElement).toBe(root);
    expect(badgeLabel(badge)).toBe('5 chars');

    typeDraft(composerOf(site), ['你好 😀', 'line two']);
    await vi.advanceTimersByTimeAsync(20);
    // 你 好 space 😀 + "line two" (8): the line break is not a character.
    expect(badgeLabel(badge)).toBe('12 chars');
  });

  it('stays visible above a composer card that clips its overflow', () => {
    document.body.innerHTML = `<main><div data-card style="overflow: hidden">${site.composer(['draft'])}</div></main>`;
    activate(site.adapter, { target: 'composer', metric: 'chars' });

    expect(onlyBadge().parentElement).toBe(document.querySelector('main'));
  });

  it('hides the badge while the draft is empty', async () => {
    document.body.innerHTML = `<main>${site.composer([])}</main>`;
    activate(site.adapter, { target: 'composer', metric: 'lines' });
    expect(onlyBadge().hidden).toBe(true);

    typeDraft(composerOf(site), ['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(20);
    expect(onlyBadge().hidden).toBe(false);
    expect(badgeLabel(onlyBadge())).toBe('3 lines');

    typeDraft(composerOf(site), []);
    await vi.advanceTimersByTimeAsync(20);
    expect(onlyBadge().hidden).toBe(true);
  });

  it('formats the number and label in the Voyager language', async () => {
    document.body.innerHTML = `<main>${site.composer(['x'.repeat(1234)])}</main>`;
    activate(site.adapter, { target: 'composer', metric: 'chars' });
    expect(badgeLabel(onlyBadge())).toBe('1,234 chars');

    await setCachedLanguage('zh');
    expect(badgeLabel(onlyBadge())).toBe('1,234 字符');
  });

  it('moves to a remounted composer without leaving a second badge', async () => {
    document.body.innerHTML = `<main>${site.composer(['old'])}</main>`;
    activate(site.adapter, { target: 'composer', metric: 'words' });
    expect(badgeLabel(onlyBadge())).toBe('1 word');

    // In-app navigation replaces the whole composer subtree.
    document.querySelector('main')!.innerHTML = site.composer(['new draft here']);
    await vi.advanceTimersByTimeAsync(300);

    const badge = onlyBadge();
    expect(badge.parentElement).toBe(
      composerOf(site).closest(site.adapter.selectors.composerRoot!),
    );
    expect(badgeLabel(badge)).toBe('3 words');
  });

  it('restores the page exactly when the plugin is turned off', async () => {
    document.body.innerHTML = `<main>${site.composer(['draft'])}</main>`;
    const before = document.body.innerHTML;
    const scope = activate(site.adapter, { target: 'composer', metric: 'chars' });
    composerOf(site).dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(badges()).toHaveLength(1);

    await scope.dispose();
    // The root's class attribute included: Voyager's anchor class leaves no empty attribute behind.
    expect(document.body.innerHTML).toBe(before);
    expect(document.head.querySelector('style')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the badge anchored to its root after the host rewrites the root className', async () => {
    document.body.innerHTML = `<main>${site.composer(['draft'])}</main>`;
    const root = composerOf(site).closest<HTMLElement>(site.adapter.selectors.composerRoot!)!;
    activate(site.adapter, { target: 'composer', metric: 'chars' });
    expect(getComputedStyle(root).position).toBe('relative');

    root.className = 'host-rerendered';
    typeDraft(composerOf(site), ['more']);
    await vi.advanceTimersByTimeAsync(20);
    expect(getComputedStyle(root).position).toBe('relative');
    expect(onlyBadge().parentElement).toBe(root);
  });

  it('leaves a root that positions itself untouched and keeps class changes the host made', async () => {
    document.body.innerHTML = `<main>${site.composer(['draft'])}</main>`;
    const root = composerOf(site).closest<HTMLElement>(site.adapter.selectors.composerRoot!)!;
    root.style.position = 'relative';
    const scope = activate(site.adapter, { target: 'composer', metric: 'chars' });
    expect(onlyBadge().parentElement).toBe(root);
    expect(root.hasAttribute('class')).toBe(false);
    await scope.dispose();

    root.style.removeProperty('position');
    root.removeAttribute('style');
    const again = activate(site.adapter, { target: 'composer', metric: 'chars' });
    root.classList.add('host-focused');
    await again.dispose();
    expect(root.className).toBe('host-focused');
  });
});

describe.each(sites)('counterBadge assistantTurn on $name', (site) => {
  it('appends one badge at the end of each reply, outside its text', () => {
    document.body.innerHTML = `<main>${site.turn('hello world')}${site.turn('日本語です')}</main>`;
    const turns = Array.from(
      document.querySelectorAll<HTMLElement>(site.adapter.selectors.assistantTurn!),
    ).filter((turn) => !turn.parentElement?.closest(site.adapter.selectors.assistantTurn!));
    activate(site.adapter, { target: 'assistantTurn', metric: 'words' });

    expect(badges()).toHaveLength(2);
    expect(turns.map((turn) => turn.lastChild)).toEqual(badges());
    expect(badges().map(badgeLabel)).toEqual(['2 words', '5 words']);
    // Copy, export and the count itself read text; the label is not part of it.
    expect(turns.map((turn) => copyableText(turn))).toEqual(['hello world', '日本語です']);
    expect(badges().every((badge) => badge.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('recounts a streaming reply once it settles, without rescanning for its own badge', async () => {
    document.body.innerHTML = `<main>${site.turn('Once')}</main>`;
    activate(site.adapter, { target: 'assistantTurn', metric: 'chars' });
    expect(badgeLabel(onlyBadge())).toBe('4 chars');
    expect(vi.getTimerCount()).toBe(0);

    const paragraph = document.querySelector('main p')!;
    for (const token of [' upon', ' a', ' time']) {
      paragraph.append(token);
      await vi.advanceTimersByTimeAsync(50);
    }
    // Still streaming: the count waits for the reply to settle.
    expect(badgeLabel(onlyBadge())).toBe('4 chars');

    // The host appends a new block after the badge, as a streamed paragraph does.
    const turn = document.querySelector<HTMLElement>(site.adapter.selectors.assistantTurn!)!;
    const outer = turn.parentElement?.closest<HTMLElement>(site.adapter.selectors.assistantTurn!);
    const reply = outer ?? turn;
    const extra = document.createElement('p');
    extra.textContent = 'The end';
    reply.append(extra);

    await vi.advanceTimersByTimeAsync(TURN_SETTLE_MS);
    const badge = onlyBadge();
    // "Once upon a time" (16) and "The end" (7).
    expect(badgeLabel(badge)).toBe('23 chars');
    expect(reply.lastChild).toBe(badge);
    // Moving the badge back to the end is its own mutation: nothing else is scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('badges a reply that arrives later and drops the badge of a removed one', async () => {
    document.body.innerHTML = `<main>${site.turn('first')}</main>`;
    activate(site.adapter, { target: 'assistantTurn', metric: 'chars' });
    expect(badges()).toHaveLength(1);

    const main = document.querySelector('main')!;
    main.insertAdjacentHTML('beforeend', site.turn('second!'));
    await vi.advanceTimersByTimeAsync(TURN_SETTLE_MS);
    expect(badges().map(badgeLabel)).toEqual(['5 chars', '7 chars']);

    main.firstElementChild!.remove();
    await vi.advanceTimersByTimeAsync(TURN_SETTLE_MS);
    expect(badges().map(badgeLabel)).toEqual(['7 chars']);
  });

  it('restores the page exactly when the plugin is turned off', async () => {
    document.body.innerHTML = `<main>${site.turn('a reply')}${site.turn('another')}</main>`;
    const before = document.body.innerHTML;
    const scope = activate(site.adapter, { target: 'assistantTurn', metric: 'lines' });
    expect(badges()).toHaveLength(2);

    await scope.dispose();
    expect(document.body.innerHTML).toBe(before);
    expect(document.head.querySelector('style')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
