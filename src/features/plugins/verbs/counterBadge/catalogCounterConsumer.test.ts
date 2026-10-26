// @vitest-environment-options {"url":"https://chatgpt.com/c/test"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import {
  catalogConsumerContext,
  catalogConsumerPage,
  catalogConsumerPatch,
  moveToDialog,
  PluginScope,
} from '../catalogConsumerFixture';
import { badgeLabel, COUNTER_ANCHOR_CLASS } from './badge';
import { startComposerBadge } from './composerBadge';
import { counterBadgePrimitive, type CounterTarget } from './index';
import { startTurnBadges } from './turnBadges';

let scope: PluginScope;
let retire: (() => void) | undefined;
let countTargets: (() => number) | undefined;
const badges = () => Array.from(document.querySelectorAll<HTMLElement>('[data-gv-counter-badge]'));
function start(target: CounterTarget): void {
  void counterBadgePrimitive.activate(
    scope,
    { target, metric: 'chars' },
    {
      ...catalogConsumerContext(),
      setTargetCounter: (read) => {
        countTargets = read;
      },
    },
  );
}
function composer(native = false): HTMLTextAreaElement {
  document.body.innerHTML = `<form data-chatgpt-composer><textarea class="input" ${native ? 'id="prompt-textarea"' : ''}>Draft</textarea><button type="submit">Send</button></form>`;
  return document.querySelector('textarea')!;
}
async function repairComposer(): Promise<void> {
  const lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'chatgpt', catalogRevision: 1, selectors: { composer: '.input' } }),
  });
  await lifetime.ready;
  retire = lifetime.stop;
}

beforeEach(() => {
  vi.useFakeTimers();
  setCachedLanguage('en');
  scope = new PluginScope();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 100,
    top: 100,
    bottom: 140,
    left: 0,
    right: 300,
    width: 300,
    height: 40,
    toJSON: () => ({}),
  });
});
afterEach(async () => {
  await scope.dispose();
  retire?.();
  retire = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('a renamed composer keeps its live badge despite its own anchor decoration', async () => {
  const field = composer();
  await repairComposer();
  start('composer');
  expect(badges().map(badgeLabel)).toEqual(['5 chars']);
  field.value = 'A longer draft';
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(20);
  expect(badges().map(badgeLabel)).toEqual(['14 chars']);
  expect(countTargets?.()).toBe(1);
});

it('a queued composer update cannot keep a badge on an editor moved into a dialog', async () => {
  const field = composer();
  await repairComposer();
  start('composer');
  expect(badges().map(badgeLabel)).toEqual(['5 chars']);
  const form = field.closest('form')!;
  field.value = 'Different private draft';
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  moveToDialog(form);
  await vi.advanceTimersByTimeAsync(20);
  expect(badges()).toHaveLength(0);
  expect(countTargets?.()).toBe(0);
  document.body.append(form);
  await vi.advanceTimersByTimeAsync(300);
  expect(badges().map(badgeLabel)).toEqual(['23 chars']);
});

it('an input event releases a badge whose remote editor no longer has native ownership', async () => {
  const field = composer();
  await repairComposer();
  start('composer');
  expect(badges()).toHaveLength(1);
  moveToDialog(field.closest('form')!);
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(badges()).toHaveLength(0);
  document.body.append(field.closest('form')!);
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(20);
  expect(badges().map(badgeLabel)).toEqual(['5 chars']);
});

it('retired badge decoration cannot certify a forged native anchor', async () => {
  const field = composer();
  const form = field.closest('form')!;
  await repairComposer();
  start('composer');
  expect(badges()).toHaveLength(1);
  await scope.dispose();
  form.classList.add(COUNTER_ANCHOR_CLASS);
  scope = new PluginScope();
  start('composer');
  expect(badges()).toHaveLength(0);
  await scope.dispose();
  form.classList.remove(COUNTER_ANCHOR_CLASS);
  scope = new PluginScope();
  start('composer');
  expect(badges().map(badgeLabel)).toEqual(['5 chars']);
});

it('reply recounts release a once-valid badge and reject new dialog aliases', async () => {
  catalogConsumerPage();
  retire = await catalogConsumerPatch();
  start('assistantTurn');
  const baseline = badges().map(badgeLabel);
  expect(baseline).toHaveLength(1);
  const answer = document.querySelector('.answer')!;
  moveToDialog(answer);
  await vi.advanceTimersByTimeAsync(450);
  expect(badges()).toHaveLength(0);
  expect(countTargets?.()).toBe(0);
  document.querySelector('main')!.append(answer);
  await vi.advanceTimersByTimeAsync(450);
  expect(badges().map(badgeLabel)).toEqual(baseline);
  const preview = answer.cloneNode(true) as HTMLElement;
  preview.querySelector('[data-gv-counter-badge]')?.remove();
  moveToDialog(preview);
  await vi.advanceTimersByTimeAsync(450);
  expect(badges()).toHaveLength(0);
  preview.parentElement!.remove();
  await vi.advanceTimersByTimeAsync(450);
  expect(badges().map(badgeLabel)).toEqual(baseline);
});

it.each(['composer', 'assistantTurn'] as const)(
  '%s badge preserves visible counts through bundled and remote data on the same DOM',
  async (target) => {
    if (target === 'composer') composer(true);
    else catalogConsumerPage(true);
    start(target);
    const before = badges().map((badge) => ({
      label: badgeLabel(badge),
      owner: badge.parentElement,
    }));
    expect(before).toHaveLength(1);
    await scope.dispose();
    scope = new PluginScope();
    if (target === 'composer') await repairComposer();
    else retire = await catalogConsumerPatch();
    start(target);
    expect(
      badges().map((badge) => ({ label: badgeLabel(badge), owner: badge.parentElement })),
    ).toEqual(before);
  },
);

it.each(['composer', 'assistantTurn'] as const)(
  '%s bundled badges keep the unguarded reader DOM query cost',
  async (target) => {
    if (target === 'composer') composer(true);
    else catalogConsumerPage(true);
    const adapter = requireBundledSiteAdapter('chatgpt');
    const reads = vi.spyOn(document, 'querySelectorAll');
    const stop =
      target === 'composer'
        ? startComposerBadge({
            doc: document,
            composer: adapter.selectors.composer,
            composerRoot: adapter.selectors.composerRoot,
            metric: 'chars',
          })
        : startTurnBadges({
            doc: document,
            turn: adapter.selectors.assistantTurn,
            metric: 'chars',
          });
    const directCost = reads.mock.calls.length;
    const baseline = badges().map(badgeLabel);
    stop();
    reads.mockClear();
    start(target);
    expect(reads.mock.calls.length).toBe(directCost);
    expect(badges().map(badgeLabel)).toEqual(baseline);
  },
);

it.each(['composer', 'assistantTurn'] as const)(
  '%s language refresh releases badges after their native owner becomes a dialog',
  async (target) => {
    let owner: Element;
    if (target === 'composer') {
      owner = composer().closest('form')!;
      await repairComposer();
    } else {
      catalogConsumerPage();
      owner = document.querySelector('.answer')!;
      retire = await catalogConsumerPatch();
    }
    start(target);
    const baseline = badges().map(badgeLabel);
    expect(baseline).toHaveLength(1);
    moveToDialog(owner);
    setCachedLanguage('zh');
    expect(badges()).toHaveLength(0);
    (target === 'composer' ? document.body : document.querySelector('main')!).append(owner);
    setCachedLanguage('en');
    expect(badges().map(badgeLabel)).toEqual(baseline);
  },
);
