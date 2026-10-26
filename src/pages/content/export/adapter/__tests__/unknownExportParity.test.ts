// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://custom.example/app/abcdef1234" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { aistudioAdapter } from '@/features/plugins/sites/adapters/aistudio';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { createConversationCollector } from '../../conversationCollector';
import { resolveExportSite, exportSiteFor } from '../../sites/resolveExportSite';
import { buildGeminiAdapter } from '../platform/gemini';
import { resolveExportAdapter, resolveExportHost } from '../platformAdapters';
import { mountUnknownExportFixture, unknownExportSnapshot } from './unknownExportFixture';

const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('unknown-host export baseline isolation', () => {
  it('keeps the same DOM, turn IDs, content order and serialized platform as the historical fallback', () => {
    mountUnknownExportFixture();
    const previous = unknownExportSnapshot(buildGeminiAdapter(geminiAdapter));
    const current = unknownExportSnapshot(resolveExportAdapter());
    expect(current).toEqual(previous);
    expect(current.platform).toBe('Gemini');
    expect(current.conversationId).toBe('abcdef1234');
    expect(current.ids).toEqual(['first:u', 'first:a', 'second:u', 'second:a', 'third:u']);
    expect(current.roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(current.turns[0].userContent?.attachments).toEqual([{ name: 'notes.pdf', type: 'pdf' }]);
    expect(current.turns[0].assistantContent?.text).toContain('const x = 1;');
    expect(current.turns[0].assistantContent?.text).toContain(
      '![one](https://example.com/one.png)',
    );
    expect(current.turns[0].assistantContent?.text).not.toContain('Private reasoning');
  });

  it('an active Gemini repair cannot discard a custom host’s saved automatic turn choice', async () => {
    document.body.innerHTML =
      '<main><section id="chat-history"><section class="custom" data-turn-id="custom"><p class="query-text-line">Custom question</p></section><model-response><message-content>Custom answer</message-content></model-response></section></main>';
    localStorage.setItem('geminiTimelineUserTurnSelectorAuto', '.custom');
    const before = unknownExportSnapshot(resolveExportAdapter());
    stops.push(await installGeminiSelectorPatch({ 'turn.user': ['.gemini-only'] }));
    const after = unknownExportSnapshot(resolveExportAdapter());
    expect(after).toEqual(before);
    expect(after.ids).toEqual(['custom:u', 'custom:a']);
    expect(after.pairs[0]).toMatchObject({ user: 'Custom question', assistant: 'Custom answer' });
    const site = resolveExportSite();
    expect(site.history?.userSelectors()[0]).toBe('.custom');
    if (site.entryPoints.kind === 'gemini')
      expect(site.entryPoints.userSelectors()[0]).toBe('.custom');
  });

  it('Gemini content and image fixes cannot change the custom host’s exported bytes', async () => {
    mountUnknownExportFixture();
    const before = unknownExportSnapshot(resolveExportAdapter());
    stops.push(
      await installGeminiSelectorPatch({
        'content.answer': ['.gemini-answer'],
        'content.userLines': ['.gemini-line'],
        'imageExport.searchHosts': ['.gemini-image'],
      }),
    );
    expect(unknownExportSnapshot(resolveExportAdapter())).toEqual(before);
    const user = document.querySelector<HTMLElement>('user-query')!;
    user.innerHTML = '<p class="gemini-line">First</p><p class="gemini-line">Second</p>';
    expect(createContentExtractor(resolveExportAdapter()).extractUserContent(user).text).toBe('');
  });

  it('a Gemini-only renamed Canvas does not attach content to a custom host’s response', async () => {
    document.body.innerHTML =
      '<main id="chat-history"><article data-author="user" data-turn-id="one">Question</article><model-response><message-content>Answer</message-content><immersive-entry-chip></immersive-entry-chip></model-response></main><renamed-code><h2 class="title-text">Remote canvas</h2><xap-code-editor><div class="xap-monaco-container" data-mode-id="javascript"><div class="view-lines"><div class="view-line">remote code</div></div></div></xap-code-editor></renamed-code>';
    stops.push(await installGeminiSelectorPatch({ 'canvas.codePanels': ['renamed-code'] }));
    const collector = createConversationCollector(resolveExportAdapter());
    collector.snapshotOpenCanvasDocs();
    collector.collectChatPairs();
    expect(document.querySelector('.gv-canvas-export-section')).toBeNull();
    const panel = document.createElement('code-immersive-panel');
    panel.innerHTML = document.querySelector('renamed-code')!.innerHTML;
    document.querySelector('renamed-code')!.replaceWith(panel);
    collector.snapshotOpenCanvasDocs();
    collector.collectChatPairs();
    expect(document.querySelector('.gv-canvas-export-section')?.textContent).toContain(
      'remote code',
    );
    collector.releaseCanvasDocs();
  });

  it('generic readiness preserves its old ordered query cost without reading Gemini’s live collection', async () => {
    stops.push(await installGeminiSelectorPatch({ 'turn.user': ['.gemini-only'] }));
    const site = resolveExportSite();
    const query = vi.spyOn(document, 'querySelector');
    const queryAll = vi.spyOn(document, 'querySelectorAll');
    const selectors = site.history!.userSelectors();
    expect(query).not.toHaveBeenCalled();
    expect(queryAll).not.toHaveBeenCalled();
    expect(selectors[0]).toBe('.user-query-bubble-with-background');
    expect(selectors.at(-1)).toBe('div[role="listitem"][data-user="true"]');
    document.body.innerHTML = '<div role="listitem" data-user="true">Last fallback</div>';
    expect(document.querySelector(selectors.join(','))?.textContent).toBe('Last fallback');
  });

  it('retains the unavailable-export boundary for AI Studio and the existing known exporters', () => {
    expect(exportSiteFor(aistudioAdapter, 'https://aistudio.google.com/prompts/a')).toBeNull();
    expect(() => resolveExportHost('https://aistudio.google.com/prompts/a')).toThrow('unavailable');
    expect(resolveExportHost('https://gemini.google.com/app/a').id).toBe('gemini');
    expect(resolveExportHost('https://chatgpt.com/c/a').id).toBe('chatgpt');
  });
});

it('a Gemini answer repair cannot replace the custom host’s original export element', async () => {
  document.body.innerHTML =
    '<main id="chat-history"><article data-author="user" data-turn-id="one"><p class="query-text-line">Question</p></article><model-response id="answer"><section class="gemini-answer"><p>Answer</p></section></model-response></main>';
  const original = document.getElementById('answer');
  const before = createConversationCollector(resolveExportAdapter()).collectSelectionMessages();
  expect(before.find((message) => message.role === 'assistant')?.exportElement).toBe(original);
  stops.push(await installGeminiSelectorPatch({ 'content.answer': ['.gemini-answer'] }));
  const after = createConversationCollector(resolveExportAdapter()).collectSelectionMessages();
  expect(after.find((message) => message.role === 'assistant')?.exportElement).toBe(original);
  expect(after.map(({ messageId, text }) => ({ messageId, text }))).toEqual(
    before.map(({ messageId, text }) => ({ messageId, text })),
  );
});
