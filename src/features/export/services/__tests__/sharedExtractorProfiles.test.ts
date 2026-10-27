import { describe, expect, it, vi } from 'vitest';

import { resolveExportHost } from '@/pages/content/export/adapter/platformAdapters';

import { createContentExtractor } from '../DOMContentExtractor';

vi.mock(
  '@/features/plugins/catalog/sites/gemini/selector-data/content-packaged.json',
  async (importOriginal) => {
    const original = await importOriginal<{ default: Record<string, string[]> }>();
    return {
      default: {
        ...original.default,
        'export.markdown': ['.gemini-answer-v2'],
        'export.messageFallback': ['.gemini-answer-v2'],
        'export.leftoverRoot': ['.gemini-response-v2'],
      },
    };
  },
);

describe('shared export content', () => {
  it('keeps ChatGPT prose and formatting when Gemini changes its packaged answer names', () => {
    const extractor = createContentExtractor(
      resolveExportHost('https://chatgpt.com/c/current').adapter,
    );
    const host = document.createElement('article');
    host.innerHTML =
      '<div class="markdown"><h3>Reply</h3><p>ChatGPT prose</p></div><aside>Page controls</aside>';
    const exported = extractor.extractAssistantContent(host);
    expect(exported.text).toBe('### Reply\nChatGPT prose');
    expect(exported.html).toBe('<h3>Reply</h3>\n<p>ChatGPT prose</p>');
  });
});
