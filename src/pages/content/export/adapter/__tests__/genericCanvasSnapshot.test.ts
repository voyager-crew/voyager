// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/native" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { createConversationCollector } from '../../conversationCollector';
import { resolveExportHost } from '../platformAdapters';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});

it('an unknown-host adapter never inherits the active Gemini Canvas repair on the same DOM', async () => {
  document.body.innerHTML =
    '<main id="chat-history"><article data-author="user" data-turn-id="one">Question</article><model-response><message-content>Answer</message-content><immersive-entry-chip></immersive-entry-chip></model-response></main><immersive-panel><renamed-code><h2 class="title-text">Remote canvas</h2><xap-code-editor><div class="xap-monaco-container" data-mode-id="javascript"><div class="view-lines"><div class="view-line">remote code</div></div></div></xap-code-editor></renamed-code></immersive-panel>';
  const generic = createConversationCollector(
    resolveExportHost('https://custom.example/app/custom').adapter,
  );
  stop = await installGeminiSelectorPatch({ 'canvas.codePanels': ['renamed-code'] });
  const native = createConversationCollector(resolveExportHost(location.href).adapter);
  native.snapshotOpenCanvasDocs();
  native.collectChatPairs();
  expect(document.querySelector('.gv-canvas-export-section')?.textContent).toContain('remote code');
  native.releaseCanvasDocs();
  generic.snapshotOpenCanvasDocs();
  generic.collectChatPairs();
  expect(document.querySelector('.gv-canvas-export-section')).toBeNull();
  expect(generic.collectChatPairs()[0].assistant).toBe('Answer');
});
