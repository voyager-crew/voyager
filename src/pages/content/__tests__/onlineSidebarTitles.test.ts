import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePDFPrintTitle } from '@/features/export/services/pdfPrintTitles';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { extractThinkingPanels } from '../deepResearch/extractor';
import { buildGeminiAdapter } from '../export/adapter/platform/gemini';
import { resolveSidebarConversationTarget } from '../export/sidebarConversationTarget';
import { createGeminiTimelineStoragePolicy } from '../timeline/GeminiTimelineStorage';
import { installGeminiSelectorPatch } from './geminiOnlineSelectorFixture';

describe('online Gemini sidebar titles', () => {
  let stopSelectors: (() => void) | undefined;

  beforeEach(() => {
    history.replaceState({}, '', '/u/1/app/current');
    document.title = 'Gemini';
    document.body.innerHTML = `
      <mat-list-item aria-current="page"><span mat-line id="second">Second choice</span></mat-list-item>
      <mat-list-item class="mdc-list-item--activated"><span mat-line id="first">Priority title</span></mat-list-item>
      <deep-research-immersive-panel><thinking-panel><div class="item-container">
        <thought-item><div class="thought-header">Plan</div><div class="gds-body-m gds-italic">Read sources</div></thought-item>
      </div></thinking-panel></deep-research-immersive-panel>`;
  });

  afterEach(() => {
    stopSelectors?.();
    stopSelectors = undefined;
    document.body.replaceChildren();
    document.title = 'Gemini';
    history.replaceState({}, '', '/');
  });

  function readTitles() {
    const policy = createGeminiTimelineStoragePolicy(window.location.href);
    return {
      pdf: resolvePDFPrintTitle({ url: window.location.href, exportedAt: '', count: 1 }, 'cover'),
      export: buildGeminiAdapter(geminiAdapter).extractConversationTitle(),
      timeline: policy.getConversationTitle([]),
      research: extractThinkingPanels()?.title,
    };
  }

  it('prints the row title instead of a More options label matched online', async () => {
    document.body.innerHTML = `
      <div data-test-id="conversation" jslog="c_current">
        <a href="/u/1/app/current"></a><span class="gds-body-m">Native report</span>
        <button class="online-more">More options</button>
      </div>`;
    const bundled = readTitles();
    stopSelectors = await installGeminiSelectorPatch({ 'sidebar.titleFallback': ['.online-more'] });

    expect(readTitles().pdf).toBe('Native report');
    expect(readTitles()).toEqual(bundled);
  });

  it('retries the complete native title read when an online link is a button', async () => {
    document.body.innerHTML = `
      <div data-test-id="conversation" jslog="c_current">
        <button id="unrelated" aria-label="Wrong title">Action</button>
        <a href="/u/1/app/current" aria-label="Trusted native title">Chat</a>
      </div>`;
    const adapter = buildGeminiAdapter(geminiAdapter);
    const bundled = adapter.extractConversationTitle();
    const bundledPrint = readTitles().pdf;
    stopSelectors = await installGeminiSelectorPatch({
      'sidebar.conversationLinks': ['#unrelated'],
    });

    expect(adapter.extractConversationTitle()).toBe(bundled);
    expect(adapter.extractConversationTitle()).toBe('Trusted native title');
    expect(readTitles().pdf).toBe(bundledPrint);
    expect(readTitles().pdf).toBe('Trusted native title');
  });

  it('reads the same ID-bound native title for export and print through an alias', async () => {
    document.body.innerHTML = `
      <div data-test-id="conversation" jslog="c_current">
        <h3 class="renamed-heading">Native report</h3>
        <a href="/u/1/app/current">Open</a>
      </div>`;
    const bundled = readTitles();
    const row = document.querySelector('[data-test-id="conversation"]');
    stopSelectors = await installGeminiSelectorPatch({
      'sidebar.conversationLinks': ['a[href="/u/1/app/current"]'],
    });

    expect(readTitles().export).toBe(bundled.export);
    expect(readTitles().pdf).toBe(bundled.pdf);
    expect(readTitles().pdf).toBe('Native report');
    expect(document.querySelector('[data-test-id="conversation"]')).toBe(row);
  });

  it('keeps the chosen export conversation when online labels name another chat', async () => {
    document.body.innerHTML = `
      <div data-test-id="conversation"><h3>Wanted chat</h3><span class="misleading">Other chat</span>
        <a href="/u/1/app/wanted">Open</a></div>
      <div data-test-id="conversation"><h3>Other chat</h3><span class="misleading">Wanted chat</span>
        <a href="/u/1/app/other">Open</a></div>
      <button id="menu" aria-label="More options for Wanted chat">Menu</button>`;
    const trigger = document.getElementById('menu')!;
    const bundled = resolveSidebarConversationTarget(trigger);
    stopSelectors = await installGeminiSelectorPatch({
      'sidebar.row': ['#menu'],
    });

    expect(resolveSidebarConversationTarget(trigger)).toEqual(bundled);
    expect(resolveSidebarConversationTarget(trigger)).toMatchObject({
      conversationId: 'wanted',
      title: 'Wanted chat',
      url: `${window.location.origin}/u/1/app/wanted`,
    });
  });
});
