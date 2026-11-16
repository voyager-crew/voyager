import type { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import grokData from '@/features/plugins/catalog/sites/grok/site.json';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import type { CatalogSnapshot } from './catalogReader';
import { readCatalogOrGrokConversation, selectGrokBranch } from './grokConversation';
import { grokMessageMarkdown } from './grokMessageMarkdown';

declare const jsdom: JSDOM;

const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEPT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function branchText(
  message: string,
  extra: Record<string, unknown> = {},
  sender = 'assistant',
): string {
  const text = selectGrokBranch(
    { responseNodes: [{ responseId: USER }, { responseId: KEPT, parentResponseId: USER }] },
    [
      { responseId: USER, sender: 'human', message: 'Prompt' },
      { responseId: KEPT, sender, message, parentResponseId: USER, ...extra },
    ],
    KEPT,
  )?.messages.at(-1)?.text;
  if (text === undefined) throw new Error('branch was dropped');
  return text;
}

describe('Grok export cards', () => {
  it('turns watch, short and youtu.be links into covers and keeps a code sample', () => {
    const text = branchText(
      [
        '对比视频：https://www.youtube.com/watch?v=JMYspR42HFM.',
        'short https://www.youtube.com/shorts/abcdefghijk?feature=share',
        'bare https://youtu.be/dQw4w9WgXcQ',
        '```',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        '```',
        'inline `https://youtu.be/dQw4w9WgXcQ` stays',
      ].join('\n'),
      {
        webSearchResults: [
          {
            url: 'https://www.youtube.com/watch?v=JMYspR42HFM',
            title: 'Claude Code vs Codex vs Cursor',
          },
        ],
      },
    );

    expect(text).toContain(
      '对比视频：[![Claude Code vs Codex vs Cursor](https://img.youtube.com/vi/JMYspR42HFM/hqdefault.jpg)](https://www.youtube.com/watch?v=JMYspR42HFM).',
    );
    expect(text).toContain(
      '[![YouTube video](https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg)](https://www.youtube.com/shorts/abcdefghijk?feature=share)',
    );
    expect(text).toContain(
      '[![YouTube video](https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://youtu.be/dQw4w9WgXcQ)',
    );
    expect(text).toContain('```\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n```');
    expect(text).toContain('inline `https://youtu.be/dQw4w9WgXcQ` stays');
    expect(text).not.toContain('**Sources**');
  });

  it('uses a markdown link label as the YouTube title', () => {
    expect(grokMessageMarkdown({ message: '[对比视频](https://youtu.be/JMYspR42HFM)' })).toBe(
      '[![对比视频](https://img.youtube.com/vi/JMYspR42HFM/hqdefault.jpg)](https://youtu.be/JMYspR42HFM)',
    );
  });

  it('lists search sources that are not already in the reply', () => {
    const text = branchText('仓库见正文。', {
      webSearchResults: [
        { url: 'https://layerfs.ai/', title: 'LayerFS' },
        { url: 'https://layerfs.ai/', title: 'duplicate' },
        { url: 'javascript:alert(1)', title: 'nope' },
      ],
      citedWebSearchResults: [{ url: 'https://github.com/Ephemeral-AI-Lab/layerfs', title: '' }],
    });

    expect(text).toBe(
      [
        '仓库见正文。',
        '',
        '**Sources**',
        '',
        '- [LayerFS](https://layerfs.ai/)',
        '- https://github.com/Ephemeral-AI-Lab/layerfs',
      ].join('\n'),
    );
  });

  it('turns an X post into a titled link and does not invent one when the payload has none', () => {
    const titled = grokMessageMarkdown({
      message: 'https://x.com/yifanxu_ephai/status/2121565771004592535',
      xposts: [
        {
          username: 'yifanxu_ephai',
          postId: '2121565771004592535',
          text: 'LayerFS draft',
        },
      ],
    });
    expect(titled).toBe('[LayerFS draft](https://x.com/yifanxu_ephai/status/2121565771004592535)');

    expect(
      grokMessageMarkdown({
        message: 'https://x.com/yifanxu_ephai/status/2121565771004592535',
        xposts: [],
      }),
    ).toBe('https://x.com/yifanxu_ephai/status/2121565771004592535');
  });

  it('appends an X post the reply did not already link', () => {
    expect(
      grokMessageMarkdown({
        message: '见讨论。',
        xSearchResults: {
          results: [{ username: 'theo', postId: '2119970535056846996', text: '' }],
        },
      }),
    ).toBe('见讨论。\n\n- [@theo](https://x.com/theo/status/2119970535056846996)');
  });

  it('keeps a citation as a link when the card payload names the URL', () => {
    const text = grokMessageMarkdown({
      message:
        'Hello  <grok:render card_id="05a0cb" card_type="citation_card"><argument name="citation_id">48</argument></grok:render> world',
      cardAttachmentsJson: [
        '{"id":"05a0cb","cardType":"citation_card","url":"https://layerfs.ai/"}',
        '{not json',
      ],
      webSearchResults: [{ url: 'https://layerfs.ai/', title: 'LayerFS' }],
    });
    expect(text).toBe('Hello [LayerFS](https://layerfs.ai/) world');
  });

  it('still drops a citation widget that has no card payload', () => {
    expect(
      branchText(
        'Hello  <grok:render card_id="05a0cb" card_type="citation_card"><argument name="citation_id">48</argument></grok:render> world',
      ),
    ).toBe('Hello world');
  });

  it('embeds a YouTube link from the page when the endpoint is missed', async () => {
    const validated = validateSiteAdapterData(grokData);
    if (!validated.success) throw new Error('grok site');
    const original = location.href;
    jsdom.reconfigure({
      url: 'https://grok.com/c/01234567-89ab-cdef-0123-456789abcdef',
    });
    const element = document.createElement('div');
    const text = '对比视频：https://www.youtube.com/watch?v=JMYspR42HFM';
    const snapshot: CatalogSnapshot = {
      id: 'dom-1',
      role: 'assistant',
      content: {
        text,
        html: '',
        attachments: [],
        hasImages: false,
        hasFormulas: false,
        hasTables: false,
        hasCode: false,
      },
      text,
      element,
      host: new WeakRef(element),
      fingerprint: 'dom',
    };
    try {
      const result = await readCatalogOrGrokConversation(
        validated.data,
        buildCatalogExportAdapter(validated.data),
        { expectedUrl: location.href },
        {
          fetch: async () => new Response('no', { status: 500 }),
          readDom: vi.fn(async () => ({ snapshots: [snapshot], completeness: 'unknown' as const })),
        },
      );
      expect(result.snapshots[0]?.text).toBe(
        '对比视频：[![YouTube video](https://img.youtube.com/vi/JMYspR42HFM/hqdefault.jpg)](https://www.youtube.com/watch?v=JMYspR42HFM)',
      );
      expect(result.snapshots[0]?.content.hasImages).toBe(true);
    } finally {
      jsdom.reconfigure({ url: original });
    }
  });
});
