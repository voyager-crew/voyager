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

  it('embeds one cover when the same video is linked again', () => {
    const url = 'https://www.youtube.com/watch?v=IOM0oAhLQV4';
    const text = grokMessageMarkdown({
      message: [
        `方便。[T3 Code First Impressions](${url})`,
        '',
        '参考：',
        '',
        `- ${url}`,
        '- https://youtu.be/IOM0oAhLQV4',
      ].join('\n'),
      webSearchResults: [{ url, title: 'T3 Code First Impressions: Why I am Using It' }],
    });

    expect(text.match(/img\.youtube\.com\/vi\/IOM0oAhLQV4/g)).toHaveLength(1);
    expect(text).toContain(
      `[![T3 Code First Impressions](https://img.youtube.com/vi/IOM0oAhLQV4/hqdefault.jpg)](${url})`,
    );
    expect(text).toContain(`- ${url}`);
    expect(text).toContain('- https://youtu.be/IOM0oAhLQV4');
    expect(text).not.toContain('**Sources**');
  });

  it('keeps one cover for a cited video and lists it under Sources', () => {
    const url = 'https://www.youtube.com/watch?v=IOM0oAhLQV4';
    const text = grokMessageMarkdown({
      message: `对比。${url}\n\n再看一次 ${url}`,
      citedWebSearchResults: [{ url, title: 'T3 Code First Impressions' }],
    });

    expect(text.match(/img\.youtube\.com\/vi\/IOM0oAhLQV4/g)).toHaveLength(1);
    expect(text).toContain(`再看一次 ${url}`);
    expect(text).toContain('1. [T3 Code First Impressions]');
    expect(text).not.toContain('[[1]]');
  });

  it('uses a markdown link label as the YouTube title', () => {
    expect(grokMessageMarkdown({ message: '[对比视频](https://youtu.be/JMYspR42HFM)' })).toBe(
      '[![对比视频](https://img.youtube.com/vi/JMYspR42HFM/hqdefault.jpg)](https://youtu.be/JMYspR42HFM)',
    );
  });

  it('embeds adjacent markdown links and leaves an image that already points at YouTube', () => {
    expect(
      grokMessageMarkdown({
        message: '[One](https://youtu.be/JMYspR42HFM)[Two](https://youtu.be/dQw4w9WgXcQ)',
      }),
    ).toBe(
      '[![One](https://img.youtube.com/vi/JMYspR42HFM/hqdefault.jpg)](https://youtu.be/JMYspR42HFM)' +
        '[![Two](https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://youtu.be/dQw4w9WgXcQ)',
    );
    expect(
      grokMessageMarkdown({
        message: '![clip](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
      }),
    ).toBe('![clip](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');
  });

  it('lists a cited page and drops the rest of the search, including a repeated url', () => {
    const text = branchText('仓库见正文。', {
      webSearchResults: [
        { url: 'https://layerfs.ai/', title: 'LayerFS' },
        { url: 'https://layerfs.ai/', title: 'duplicate' },
        { url: 'javascript:alert(1)', title: 'nope' },
        { url: 'https://example.com/unrelated', title: 'LayeredFS for Switch' },
      ],
      citedWebSearchResults: [
        { url: 'https://github.com/Ephemeral-AI-Lab/layerfs', title: '' },
        { url: 'https://github.com/Ephemeral-AI-Lab/layerfs/', title: 'LayerFS repo' },
      ],
    });

    expect(text).toBe(
      [
        '仓库见正文。',
        '',
        '**Sources**',
        '',
        '1. [LayerFS repo](https://github.com/Ephemeral-AI-Lab/layerfs)',
      ].join('\n'),
    );
  });

  it('does not add Sources or retitle a post when the reply cites nothing', () => {
    expect(
      grokMessageMarkdown({
        message: '仓库见正文。https://x.com/yifanxu_ephai/status/2121565771004592535',
        webSearchResults: [{ url: 'https://layerfs.ai/', title: 'LayerFS' }],
        xposts: [
          {
            username: 'yifanxu_ephai',
            postId: '2121565771004592535',
            text: 'LayerFS draft',
          },
        ],
        xSearchResults: {
          results: [{ username: 'theo', postId: '2119970535056846996', text: 'noise' }],
        },
      }),
    ).toBe('仓库见正文。https://x.com/yifanxu_ephai/status/2121565771004592535');
  });

  it('marks a cited post in the sentence and keeps the post text for Sources', () => {
    const tweet = `@yifanxu_ephai 想看 paper 里具体的机制，尤其是 LayerFS 怎么影响 agent 的学习过程。`;
    const text = grokMessageMarkdown({
      message:
        '只有作者自己承认的短板，以及少量集成 bug。https://twitter.com/thevernaldawn/status/2121576880029749274?s=20',
      xposts: [
        { username: 'thevernaldawn', postId: '2121576880029749274', text: tweet },
        {
          username: 'SciresM',
          postId: '1010957526945316864',
          text: 'Still more issues to fix in LayeredFS, but took down a pretty irritating one just now.',
        },
      ],
      citedXposts: [{ username: 'thevernaldawn', postId: '2121576880029749274', text: tweet }],
      xSearchResults: {
        results: [
          {
            username: 'ChainLinkGod',
            postId: '2047750285779710326',
            text: 'The reason why I am so critical of LayerZero',
          },
        ],
      },
    });

    const [body, sources] = text.split('\n\n**Sources**\n\n');
    expect(body).toBe(
      '只有作者自己承认的短板，以及少量集成 bug。[[1]](https://x.com/thevernaldawn/status/2121576880029749274)',
    );
    expect(body).not.toContain(tweet);
    expect(sources).toBe(`1. [${tweet}](https://x.com/thevernaldawn/status/2121576880029749274)`);
    expect(text).not.toContain('SciresM');
    expect(text).not.toContain('LayerZero');
  });

  it('treats a t.co citation and the expanded page with the same title as one source', () => {
    const title =
      'GitHub - Ephemeral-AI-Lab/layerfs: Ephemeral Workspaces, durable shared history.';
    const text = grokMessageMarkdown({
      message:
        '见论文。' +
        '<' +
        'grok:render card_id="c1" card_type="citation_card" type="render_inline_citation">' +
        '<' +
        '/grok:render>',
      cardAttachmentsJson: [
        JSON.stringify({
          id: 'c1',
          cardType: 'citation_card',
          type: 'render_inline_citation',
          url: 'https://t.co/hwcUUBzhYw',
        }),
      ],
      webSearchResults: [
        { url: 'https://github.com/Ephemeral-AI-Lab/layerfs', title },
        { url: 'https://t.co/hwcUUBzhYw', title },
        {
          url: 'https://x.com/SciresM/status/1010957526945316864',
          title: 'Still more issues in LayeredFS',
        },
      ],
      citedWebSearchResults: [{ url: 'https://t.co/hwcUUBzhYw', title }],
    });

    expect(text).toBe(
      [
        `见论文。[[1]](https://github.com/Ephemeral-AI-Lab/layerfs)`,
        '',
        '**Sources**',
        '',
        `1. [${title}](https://github.com/Ephemeral-AI-Lab/layerfs)`,
      ].join('\n'),
    );
    expect(text).not.toContain('t.co');
    expect(text).not.toContain('SciresM');
  });

  it('follows an expanded url field when the titles differ', () => {
    const text = grokMessageMarkdown({
      message: '见仓库。https://t.co/hwcUUBzhYw。',
      citedWebSearchResults: [
        {
          url: 'https://t.co/hwcUUBzhYw',
          expandedUrl: 'https://github.com/Ephemeral-AI-Lab/layerfs',
          title: 'LayerFS',
        },
      ],
    });

    expect(text).toBe(
      [
        '见仓库。[[1]](https://github.com/Ephemeral-AI-Lab/layerfs)。',
        '',
        '**Sources**',
        '',
        '1. [LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs)',
      ].join('\n'),
    );
  });

  it('numbers a citation card and a cited post the body never links', () => {
    const text = grokMessageMarkdown({
      message:
        'Hello  <grok:render card_id="05a0cb" card_type="citation_card"><argument name="citation_id">48</argument></grok:render> world',
      cardAttachmentsJson: [
        '{"id":"05a0cb","cardType":"citation_card","url":"https://layerfs.ai/"}',
        '{not json',
      ],
      webSearchResults: [
        { url: 'https://layerfs.ai/', title: 'LayerFS' },
        { url: 'https://example.com/other', title: 'Uncited' },
      ],
      citedXposts: [
        { username: 'yifanxu_ephai', postId: '2118119208718606448', text: 'LayerFS 发布两周了。' },
      ],
    });

    expect(text).toBe(
      [
        'Hello [[1]](https://layerfs.ai/) world',
        '',
        '**Sources**',
        '',
        '1. [LayerFS](https://layerfs.ai/)',
        '2. [LayerFS 发布两周了。](https://x.com/yifanxu_ephai/status/2118119208718606448)',
      ].join('\n'),
    );
    expect(text).not.toContain('Uncited');
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
