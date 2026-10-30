import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_EXPORT_SPEAKER_LABELS } from '../../types/export';
import type { ExtractedContent } from '../DOMContentExtractor';
import { createPDFPrintContainer } from '../pdfPrintDocument';

describe('PDF print document construction', () => {
  const metadata = {
    url: 'https://gemini.google.com/app/abcdefghijk',
    exportedAt: '2025-01-15T10:30:00.000Z',
    count: 1,
    title: 'Document title',
  };
  const captured: ExtractedContent = {
    html: '<p>Captured content</p>',
    text: 'Captured content',
    attachments: [],
    hasImages: false,
    hasFormulas: false,
    hasTables: false,
    hasCode: false,
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Gemini';
  });

  it('shows itself with an inline !important, which outranks a layered host print rule', () => {
    const container = createPDFPrintContainer([], metadata, DEFAULT_EXPORT_SPEAKER_LABELS);
    expect(container.style.getPropertyValue('display')).toBe('block');
    expect(container.style.getPropertyPriority('display')).toBe('important');
  });

  it('prefers captured rich content over changed live elements and plain text', () => {
    const stale = document.createElement('div');
    stale.textContent = 'Changed after capture';
    const container = createPDFPrintContainer(
      [
        {
          user: 'Plain user',
          assistant: 'Plain assistant',
          starred: true,
          userContent: captured,
          assistantContent: {
            ...captured,
            html: '<table><tr><td>Captured table</td></tr></table>',
          },
          userElement: stale,
          assistantElement: stale,
        },
      ],
      metadata,
      DEFAULT_EXPORT_SPEAKER_LABELS,
    );
    expect(container.querySelector('.gv-print-turn-user p')?.textContent).toBe('Captured content');
    expect(container.querySelector('.gv-print-turn-assistant td')?.textContent).toBe(
      'Captured table',
    );
    expect(container.textContent).not.toContain('Changed after capture');
    expect(container.textContent).not.toContain('Plain user');
    expect(container.textContent).not.toContain('Plain assistant');
    expect(container.querySelector('.gv-print-turn-starred .gv-print-star')?.textContent).toBe(
      '⭐',
    );
    expect(container.isConnected).toBe(false);
  });

  it('escapes plain text while preserving paragraphs, line breaks and turn order', () => {
    const container = createPDFPrintContainer(
      [
        { user: '<b>First</b>\nSecond\n\nThird', assistant: '', starred: false },
        { user: '', assistant: 'Last', starred: false, omitEmptySections: true },
      ],
      { ...metadata, count: 2 },
      DEFAULT_EXPORT_SPEAKER_LABELS,
    );
    const first = container.querySelector('.gv-print-turn-user .gv-print-turn-text')!;
    expect(first.querySelector('b')).toBeNull();
    expect(first.querySelectorAll('p')).toHaveLength(2);
    expect(first.querySelectorAll('br')).toHaveLength(1);
    expect(first.textContent).toBe('<b>First</b>SecondThird');
    expect(container.querySelectorAll('.gv-print-turn-user')).toHaveLength(1);
    expect(container.querySelector('.gv-print-turn-assistant em')?.textContent).toBe('No content');
    expect(
      Array.from(container.querySelectorAll('.gv-print-turn-number'), (node) => node.textContent),
    ).toEqual(['Turn 1', 'Turn 2']);
    expect(container.querySelector('.gv-print-meta a')?.textContent).toBe(
      'Gemini Conversation abcdefgh',
    );
    expect(container.querySelector('.gv-print-footer')?.textContent).toContain(
      '2 conversation turns',
    );
  });

  it('keeps sections backed by a captured record even when their content is empty', () => {
    const container = createPDFPrintContainer(
      [
        {
          user: '',
          assistant: '',
          starred: false,
          omitEmptySections: true,
          userContent: { ...captured, html: '', text: '' },
        },
      ],
      metadata,
      DEFAULT_EXPORT_SPEAKER_LABELS,
    );
    expect(container.querySelector('.gv-print-turn-user em')?.textContent).toBe('No content');
    expect(container.querySelector('.gv-print-turn-assistant')).toBeNull();
  });
});
