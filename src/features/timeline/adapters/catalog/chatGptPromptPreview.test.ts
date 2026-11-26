import { describe, expect, it } from 'vitest';

import { chatGptPromptPreview } from './chatGptPromptPreview';

const ambient =
  '<in-app-browser-context source="ambient-ui-state">Browser metadata</in-app-browser-context>';

describe('ChatGPT history previews', () => {
  it('shows the request without the selected passage and headings', () => {
    const raw = '# Selected text:\n\n## Selection 1\nExcerpt\n\n## My request:\nExplain it';
    expect(chatGptPromptPreview(raw).trim()).toBe('Explain it');
  });

  it('removes the request heading paired with browser metadata', () => {
    expect(chatGptPromptPreview(`${ambient}\n\n## My request: Check this`).trim()).toBe(
      'Check this',
    );
  });

  it('preserves a request heading that is part of an ordinary prompt', () => {
    const heading = '## My request:\nCheck this';
    expect(chatGptPromptPreview(heading)).toBe(heading);
  });
});
