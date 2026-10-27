import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findGeminiDraftInput } from '@/core/gemini/composer/draft';
import { findGeminiChatInput } from '@/core/gemini/composer/inputs';
import { insertIntoComposer, readComposer } from '@/core/services/composer';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { createOnlineDraftHarness, showDraftInputs } from './onlineDraftHarness';

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

describe('renamed Gemini main input ownership', () => {
  let harness: ReturnType<typeof createOnlineDraftHarness>;
  let stopSelectors: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createOnlineDraftHarness();
    // jsdom has no editing engine; exercise the existing Quill DOM fallback.
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  });

  afterEach(async () => {
    await harness.stop();
    stopSelectors?.();
    stopSelectors = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
    else Reflect.deleteProperty(document, 'execCommand');
  });

  it.each(['input-area-v2', 'input-container'])(
    'text inserted into a renamed %s composer is saved and restored as its draft',
    async (owner) => {
      document.body.innerHTML = `<${owner}><section id="field" class="ql-editor" contenteditable="true"></section></${owner}>`;
      showDraftInputs();
      stopSelectors = await installGeminiSelectorPatch({
        'composer.candidates': ['#field'],
        'composer.draftCandidates': ['#field'],
      });
      const scope = harness.start();
      await vi.advanceTimersByTimeAsync(0);
      const field = findGeminiChatInput()!;
      expect(field).toBe(document.getElementById('field'));
      expect(insertIntoComposer(field, 'quoted text', 'replace')).toBe(true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(harness.records['gvDraft_/u/0/app/source']).toMatchObject({ content: 'quoted text' });
      await scope.dispose();
      field.textContent = '';
      harness.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(readComposer(field)).toBe('quoted text');
    },
  );

  it('a hidden renamed editor cannot receive an insertion while draft save rejects it', async () => {
    document.body.innerHTML =
      '<div class="text-input-field" style="visibility: hidden"><section id="field" contenteditable="true">draft</section></div>';
    showDraftInputs();
    stopSelectors = await installGeminiSelectorPatch({
      'composer.candidates': ['#field'],
      'composer.draftCandidates': ['#field'],
    });
    expect(findGeminiChatInput({ requireVisible: false })).toBeNull();
    expect(findGeminiDraftInput(document)).toBeNull();
    const field = document.getElementById('field')!;
    field.parentElement!.style.visibility = 'visible';
    expect(findGeminiChatInput({ requireVisible: false })).toBe(field);
    expect(findGeminiDraftInput(document)).toBe(field);
    expect(readComposer(field)).toBe('draft');
  });
});
