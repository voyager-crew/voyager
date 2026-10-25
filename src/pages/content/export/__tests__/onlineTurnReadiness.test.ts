import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import { resolveExportAdapter } from '../adapter/platformAdapters';
import { waitForAnyElement } from '../domWait';
import { openSidebarConversationForExport } from '../sidebarConversationNavigation';
import { createGeminiExportSite } from '../sites/gemini';
import { computeConversationFingerprint } from '../topNodePreload';

describe('Gemini export readiness with online turn profiles', () => {
  let stopSelectors: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    history.replaceState({}, '', '/u/1/app/ready');
    document.body.innerHTML = '<main></main>';
  });

  afterEach(() => {
    stopSelectors?.();
    stopSelectors = undefined;
    vi.useRealTimers();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('finds the same existing user turn immediately for sidebar export when online selectors miss', async () => {
    document.querySelector('main')!.innerHTML =
      '<div class="user-query-container" id="prompt">Question</div>';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<nav><div data-test-id="conversation"><a href="/u/1/app/ready">Ready</a><button id="menu">Menu</button></div></nav>',
    );
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.missing-online-user'] });
    const site = createGeminiExportSite(resolveExportAdapter());
    if (site.entryPoints.kind !== 'gemini') throw new Error('Expected Gemini entry points');
    const started = Date.now();

    await expect(
      openSidebarConversationForExport(
        document.getElementById('menu')!,
        site.entryPoints.userSelectors,
        (key) => key,
      ),
    ).resolves.toBe(true);
    expect(Date.now()).toBe(started);
  });

  it('finds a late online-only user turn within the original resumed-export wait', async () => {
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.online-user'] });
    const site = createGeminiExportSite(resolveExportAdapter());
    const pending = waitForAnyElement(site.history!.userSelectors, 1000);
    await vi.advanceTimersByTimeAsync(500);
    document.querySelector('main')!.innerHTML = '<div class="online-user" id="late">Question</div>';

    await expect(pending).resolves.toBe(document.getElementById('late'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one timeout while both online and bundled user turns are absent', async () => {
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.online-user'] });
    const site = createGeminiExportSite(resolveExportAdapter());
    const pending = waitForAnyElement(site.history!.userSelectors, 1000);
    const started = Date.now();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBeNull();
    expect(Date.now() - started).toBe(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fingerprints both sides from the bundled view when no online user is usable', async () => {
    document.querySelector('main')!.innerHTML = `
      <div class="user-query-container">Question</div>
      <div class="response-container">Answer</div>
      <div class="online-assistant">Unrelated online match</div>`;
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.missing-online-user'],
      'turn.assistant': ['.online-assistant'],
      'turn.assistantFallback': ['.missing-online-fallback'],
    });
    const site = createGeminiExportSite(resolveExportAdapter());

    expect(
      computeConversationFingerprint(document.body, site.history!.fingerprintSelectors!(), 10)
        .count,
    ).toBe(2);
  });
});
