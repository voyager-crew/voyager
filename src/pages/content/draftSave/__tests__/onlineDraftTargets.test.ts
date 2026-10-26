import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findGeminiDraftInput } from '@/core/gemini/composer/draft';
import { createSendKeyCoordinator } from '@/core/services/composer/sendKeys/sendKeyCoordinator';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { createOnlineDraftHarness, showDraftInputs, typeDraft } from './onlineDraftHarness';

describe('Gemini draft targets with online composer fixes', () => {
  let harness: ReturnType<typeof createOnlineDraftHarness>;
  let stopSelectors: (() => void) | undefined;
  const field = (id = 'main') => document.getElementById(id) as HTMLTextAreaElement;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createOnlineDraftHarness();
    document.body.innerHTML = `<div data-email="first@example.test"></div>
      <div class="edit-container"><textarea id="old" placeholder="Ask">old message edit</textarea></div>
      <div class="input-area"><textarea id="main" class="online" placeholder="Ask"></textarea>
        <button class="send-button" aria-label="Send message">Send</button></div>`;
    showDraftInputs();
  });

  afterEach(async () => {
    await harness.stop();
    stopSelectors?.();
    stopSelectors = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it.each([false, true])(
    'saves and restores the same draft bytes with online=%s',
    async (online) => {
      if (online)
        stopSelectors = await installGeminiSelectorPatch({
          'composer.draftCandidates': ['.online'],
        });
      const scope = harness.start();
      await vi.advanceTimersByTimeAsync(0);
      typeDraft(field(), 'αβ\n\n\n\nsecond line 🌱');
      await vi.advanceTimersByTimeAsync(1100);
      expect(harness.records['gvDraft_/u/0/app/source']).toEqual({
        content: 'αβ\nsecond line 🌱',
        path: '/u/0/app/source',
        timestamp: expect.any(Number),
      });
      await scope.dispose();
      field().value = '';
      harness.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(field().value).toBe('αβ\nsecond line 🌱');
      expect(field('old').value).toBe('old message edit');
    },
  );

  it('a profile aimed at an old message cannot overwrite its edit or save it as the main draft', async () => {
    stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': ['#old'] });
    harness.records['gvDraft_/u/0/app/source'] = { content: 'main draft' };
    harness.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(field().value).toBe('main draft');
    expect(field('old').value).toBe('old message edit');
    typeDraft(field('old'), 'edited old question');
    typeDraft(field(), 'new main draft');
    await vi.advanceTimersByTimeAsync(1100);
    expect(harness.records['gvDraft_/u/0/app/source']).toMatchObject({ content: 'new main draft' });
  });

  it.each([{ candidates: ['#other'] }, { candidates: ['#other', '#main'] }])(
    'a partial or reordered candidate list cannot save the second composer: %j',
    async ({ candidates }) => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="input-area"><textarea id="other">other composer text</textarea></div>',
      );
      showDraftInputs();
      stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': candidates });
      harness.records['gvDraft_/u/0/app/source'] = { content: 'first composer draft' };
      harness.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(field().value).toBe('first composer draft');
      expect(field('other').value).toBe('other composer text');
      typeDraft(field(), 'first composer edit');
      await vi.advanceTimersByTimeAsync(1100);
      expect(harness.records['gvDraft_/u/0/app/source']).toMatchObject({
        content: 'first composer edit',
      });
    },
  );

  it('restores a changed input locator only when the native main owner independently proves it', async () => {
    document.querySelector('.input-area')!.className = 'text-input-field';
    field().removeAttribute('placeholder');
    expect(findGeminiDraftInput(document)).toBeNull();
    stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': ['.online'] });
    harness.records['gvDraft_/u/0/app/source'] = { content: 'restored with the new locator' };
    harness.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(field().value).toBe('restored with the new locator');
    typeDraft(field(), 'new locator saves too');
    await vi.advanceTimersByTimeAsync(1100);
    expect(harness.records['gvDraft_/u/0/app/source']).toMatchObject({
      content: 'new locator saves too',
    });
  });

  it.each([
    '<div role="dialog"><div class="text-input-field"><textarea id="decoy"></textarea></div></div>',
    '<model-response><div class="text-input-field"><textarea id="decoy"></textarea></div></model-response>',
    '<div class="text-input-field gv-test"><textarea id="decoy"></textarea></div>',
    '<div class="text-input-field"><textarea id="decoy" readonly></textarea></div>',
    '<div class="text-input-field" hidden><textarea id="decoy"></textarea></div>',
    '<div class="text-input-field" aria-disabled="true"><textarea id="decoy"></textarea></div>',
    '<div class="text-input-field" style="visibility: hidden"><textarea id="decoy"></textarea></div>',
    '<div><textarea id="decoy"></textarea></div>',
  ])('keeps a saved draft out of an unproven online field: %s', async (markup) => {
    document.querySelector('.input-area')!.remove();
    document.body.insertAdjacentHTML('beforeend', markup);
    showDraftInputs();
    stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': ['#decoy'] });
    harness.records['gvDraft_/u/0/app/source'] = { content: 'preserved main draft' };
    harness.start();
    await vi.advanceTimersByTimeAsync(2600);
    expect(field('decoy').value).toBe('');
    expect(harness.records['gvDraft_/u/0/app/source']).toEqual({ content: 'preserved main draft' });
  });

  it('keeps the draft saved when two new main inputs make an online target ambiguous', async () => {
    document.querySelector('.input-area')!.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="text-input-field"><textarea id="first"></textarea><textarea id="second"></textarea></div>',
    );
    showDraftInputs();
    stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': ['#first'] });
    harness.records['gvDraft_/u/0/app/source'] = { content: 'preserved ambiguous draft' };
    harness.start();
    await vi.advanceTimersByTimeAsync(2600);
    expect(field('first').value).toBe('');
    expect(harness.records['gvDraft_/u/0/app/source']).toEqual({
      content: 'preserved ambiguous draft',
    });
  });

  it.each([{ candidates: ['#decoy'] }, { candidates: ['.online', '#decoy'] }])(
    'an online candidate outside the proven owner cannot take a saved draft: %j',
    async ({ candidates }) => {
      document.querySelector('.input-area')!.className = 'text-input-field';
      field().removeAttribute('placeholder');
      document.body.insertAdjacentHTML('beforeend', '<textarea id="decoy"></textarea>');
      showDraftInputs();
      stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': candidates });
      harness.records['gvDraft_/u/0/app/source'] = { content: 'keep until one owner is proven' };
      harness.start();
      await vi.advanceTimersByTimeAsync(2600);
      expect(field().value).toBe('');
      expect(field('decoy').value).toBe('');
      expect(harness.records['gvDraft_/u/0/app/source']).toEqual({
        content: 'keep until one owner is proven',
      });
    },
  );

  it.each(['truncated', 'wrong'])(
    'Ctrl+Enter does not restore sent text after the %s remote draft profile is rejected',
    async (rejected) => {
      document.querySelector('.input-area')!.className = 'renamed-send-owner';
      if (rejected === 'truncated') {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<div class="renamed-other-owner"><textarea id="other" placeholder="Ask">second composer</textarea></div>',
        );
      }
      showDraftInputs();
      stopSelectors = await installGeminiSelectorPatch({
        'composer.draftCandidates': rejected === 'truncated' ? ['.online'] : ['#old'],
        'composer.sendContainers': ['.renamed-send-owner'],
      });
      harness.records['gvDraft_/u/0/app/source'] = { content: 'send this saved draft' };
      const scope = harness.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(field().value).toBe('send this saved draft');
      const sent = vi.fn(() => {
        field().value = '';
      });
      document.querySelector<HTMLButtonElement>('button')!.addEventListener('click', sent);
      const coordinator = createSendKeyCoordinator('gemini', { isSafari: () => false });
      coordinator.registerMainMode({ source: 'draft-send-test', mode: 'ctrlEnterSends' });
      try {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        field().dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(sent).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(500);
        await scope.dispose();
        harness.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(field().value).toBe('');
        expect(harness.records['gvDraft_/u/0/app/source']).toBeUndefined();
        expect(field('old').value).toBe('old message edit');
      } finally {
        coordinator.stop();
      }
    },
  );

  it.each(['route', 'account'])(
    'a late online restore cannot cross a changed %s',
    async (changed) => {
      stopSelectors = await installGeminiSelectorPatch({ 'composer.draftCandidates': ['.online'] });
      harness.records['gvDraft_/u/0/app/source'] = { content: 'source account draft' };
      let finishLoad: ((value: Record<string, unknown>) => void) | undefined;
      (chrome.storage.local.get as unknown as Mock).mockImplementation(
        (_key: unknown, callback: (value: Record<string, unknown>) => void) => {
          finishLoad = callback;
        },
      );
      harness.start();
      if (changed === 'route') harness.route.pathname = '/u/1/app/destination';
      else
        document.querySelector('[data-email]')!.setAttribute('data-email', 'second@example.test');
      finishLoad?.({ 'gvDraft_/u/0/app/source': harness.records['gvDraft_/u/0/app/source'] });
      await vi.advanceTimersByTimeAsync(0);
      expect(field().value).toBe('');
      typeDraft(field(), 'destination text');
      await vi.advanceTimersByTimeAsync(1100);
      expect(field().value).toBe('destination text');
      if (changed === 'route')
        expect(harness.records['gvDraft_/u/0/app/source']).toEqual({
          content: 'source account draft',
        });
      expect(harness.records[`gvDraft_${harness.route.pathname}`]).toMatchObject({
        content: 'destination text',
      });
    },
  );
});
