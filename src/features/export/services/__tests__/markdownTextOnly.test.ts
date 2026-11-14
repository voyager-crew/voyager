import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatTurn, ConversationMetadata } from '../../types/export';
import { ExportFormat } from '../../types/export';
import { ConversationExportService } from '../ConversationExportService';
import { MarkdownFormatter } from '../MarkdownFormatter';
import { packageMarkdownImages } from '../markdownImageArchive';
import { stripMarkdownImages } from '../markdownTextOnly';

vi.mock('../markdownImageArchive', () => ({
  packageMarkdownImages: vi.fn(async () => ({ filename: 'chat.zip', omittedImageCount: 0 })),
}));

const metadata: ConversationMetadata = {
  url: 'https://chatgpt.com/c/abc',
  exportedAt: '2026-11-14T10:00:00.000Z',
  count: 1,
  title: 'Garden plan',
  platform: 'ChatGPT',
};

const turns: ChatTurn[] = [
  {
    user: '',
    assistant: '',
    starred: false,
    userContent: {
      text: '![Uploaded image 1](blob:https://chatgpt.com/u1)\n\nWhat grows here?',
      html: '',
      hasImages: true,
      hasFormulas: false,
      hasTables: false,
      hasCode: false,
      attachments: [],
    },
    assistantContent: {
      text: [
        'Here is the bed layout.',
        '',
        '![Generated image](https://files.example.com/bed.png)',
        '*Source: [Garden site](https://garden.example.com)*',
        '',
        'Tomatoes go in the sunny corner ![icon](data:image/png;base64,AAAA) today.',
        '',
        '```md',
        '![kept](https://example.com/in-code.png)',
        '```',
      ].join('\n'),
      html: '',
      hasImages: true,
      hasFormulas: false,
      hasTables: false,
      hasCode: true,
      attachments: [],
    },
  },
];

describe('text-only Markdown export', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(packageMarkdownImages).mockClear();
  });

  it('downloads one .md without image embeds and never packages or fetches images', async () => {
    const download = vi.spyOn(MarkdownFormatter, 'download').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await ConversationExportService.export(turns, metadata, {
      format: ExportFormat.MARKDOWN,
      markdownTextOnly: true,
    });

    expect(result).toMatchObject({ success: true, filename: 'Garden-plan.md' });
    expect(packageMarkdownImages).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledOnce();
    const [markdown, filename] = download.mock.calls[0]!;
    expect(filename).toBe('Garden-plan.md');
    expect(markdown).not.toContain('](blob:');
    expect(markdown).not.toContain('bed.png');
    expect(markdown).not.toContain('data:image');
    expect(markdown).toContain('What grows here?');
    expect(markdown).toContain(
      'Here is the bed layout.\n\n*Source: [Garden site](https://garden.example.com)*\n\n',
    );
    expect(markdown).toContain('Tomatoes go in the sunny corner today.');
    expect(markdown).toContain('```md\n![kept](https://example.com/in-code.png)\n```');
  });

  it('still packages images into a zip when the option is off', async () => {
    vi.spyOn(MarkdownFormatter, 'download').mockImplementation(() => {});

    const result = await ConversationExportService.export(turns, metadata, {
      format: ExportFormat.MARKDOWN,
    });

    expect(packageMarkdownImages).toHaveBeenCalledOnce();
    expect(result.filename).toBe('chat.zip');
  });
});

describe('stripMarkdownImages', () => {
  it('drops image-only lines without piling up blank lines', () => {
    expect(
      stripMarkdownImages('Intro\n\n![a](https://x/a.png)\n\n![b](https://x/b.png)\n\nEnd'),
    ).toBe('Intro\n\nEnd');
  });

  it('drops a link that only wraps an image and keeps inline code', () => {
    expect(
      stripMarkdownImages('See [![shot](https://x/s.png)](https://x/page) and `![a](b)` here.'),
    ).toBe('See and `![a](b)` here.');
  });

  it('removes images whose alt text holds an escaped bracket', () => {
    expect(stripMarkdownImages('A ![x \\] y](https://x/y.png) B')).toBe('A B');
  });
});
