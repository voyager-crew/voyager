/**
 * Golden JSON, Markdown and PDF output for one Gemini conversation, one
 * ChatGPT conversation on each of its DOMs (retained containers, crawled
 * virtual thread) and one Deep Research report, read from the page the way
 * each export reads it. These bytes are the serialized export format:
 * a refactor of collection or extraction must leave them unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import {
  createContentExtractor,
  extractTurnContent,
} from '@/features/export/services/DOMContentExtractor';
import type { ChatTurn, ConversationMetadata } from '@/features/export/types/export';
import { ExportFormat } from '@/features/export/types/export';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';

import { collectForkChatPairs } from '../../fork/chatPairs';
import { buildChatGptAdapter } from '../adapter/platform/chatgpt';
import { buildGeminiAdapter } from '../adapter/platform/gemini';
import { createConversationCollector } from '../conversationCollector';
import { createChatGptExportSite } from '../sites/chatgpt';
import { createGeminiExportSite } from '../sites/gemini';
import { exportText, normalizeMarkdown, printedTurns } from './exportOutputGoldenHarness';

const GEMINI_CONVERSATION = `
  <main>
    <div id="chat-history">
      <div class="conversation-container" id="r_aaaaaaaa01">
        <user-query>
          <div class="user-query-container">
            <div class="query-text-line">Explain the integral</div>
            <div class="query-text-line">with an example</div>
          </div>
        </user-query>
        <model-response>
          <div class="response-container">
            <model-thoughts><message-content><div class="markdown">hidden reasoning</div></message-content></model-thoughts>
            <message-content>
              <div class="markdown markdown-main-panel">
                <h2>Overview</h2>
                <p>Inline <span class="math-inline" data-math="x^2">x2</span> and <b>bold</b> text.</p>
                <div class="math-block" data-math="\\int_0^1 x\\,dx"></div>
                <ul><li>first</li><li>second <code>value</code></li></ul>
                <code-block><div class="code-block"><div class="code-block-decoration"><span>Python</span></div><pre><code data-test-id="code-content">print("hi")</code></pre></div></code-block>
                <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
                <blockquote><p>quoted</p></blockquote>
                <hr>
                <p>Done.</p>
              </div>
            </message-content>
          </div>
        </model-response>
      </div>
      <div class="conversation-container" id="r_bbbbbbbb02">
        <user-query><div class="user-query-container"><div class="query-text-line">Thanks</div></div></user-query>
        <model-response>
          <div class="response-container"><message-content><div class="markdown"><p>You are welcome.</p></div></message-content></div>
        </model-response>
      </div>
    </div>
  </main>
`;

const CHATGPT_CONVERSATION = `
  <main>
    <div data-turn-id-container="client-created-root"></div>
    <div data-turn-id-container="11111111-aaaa">
      <section data-turn="user">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">First line
Second line</div></div>
      </section>
    </div>
    <div data-turn-id-container="22222222-bbbb">
      <section data-turn="assistant">
        <div data-message-author-role="assistant">
          <div class="markdown prose">
            <p>Energy is <span data-math-source="E=mc^2"><span class="katex">E=mc2</span></span> here.</p>
            <span data-math-source="\\sum_i x_i"><span class="katex-display"><span class="katex">sum</span></span></span>
            <pre><code class="language-ts">const x = 1;</code></pre>
            <ol><li>one</li><li>two</li></ol>
            <style>.card { color: red; }</style>
            <button>Copy</button>
          </div>
        </div>
      </section>
    </div>
  </main>
`;

const DEEP_RESEARCH_REPORT = `
  <deep-research-immersive-panel>
    <thinking-panel><div class="markdown">thinking notes</div></thinking-panel>
    <message-content>
      <div class="markdown">
        <h1>Solar Report</h1>
        <p>Panels convert <span class="math-inline" data-math="h\\nu">hv</span> into current.</p>
        <h2>Findings</h2>
        <ul><li>Efficiency rose.</li></ul>
      </div>
    </message-content>
  </deep-research-immersive-panel>
`;

const geminiExportAdapter = buildGeminiAdapter(geminiAdapter);
const chatgptExportAdapter = buildChatGptAdapter(chatgptAdapter);

describe('Gemini conversation export output', () => {
  async function geminiTurns(): Promise<ChatTurn[]> {
    document.body.innerHTML = GEMINI_CONVERSATION;
    const conversationId = buildConversationIdFromUrl(location.href);
    vi.spyOn(StarredMessagesService, 'getAllStarredMessages').mockResolvedValue({
      messages: {
        [conversationId]: [
          {
            conversationId,
            conversationUrl: location.href,
            turnId: 's-aaaaaaaa01',
            content: 'Explain the integral with an example',
            starredAt: 1,
          },
        ],
      },
    });
    const site = createGeminiExportSite(geminiExportAdapter);
    const ids = site.turns.messages().map((message) => message.messageId);
    expect(ids).toEqual(['s-aaaaaaaa01:u', 's-aaaaaaaa01:a', 's-bbbbbbbb02:u', 's-bbbbbbbb02:a']);
    return site.turns.build(new Set(ids), {});
  }

  const metadata: ConversationMetadata = {
    url: 'https://gemini.google.com/app/abc123',
    exportedAt: '2026-01-02T03:04:05.000Z',
    count: 2,
    title: 'Integral help',
    platform: geminiExportAdapter.site.label,
  };

  it('writes the chat JSON', async () => {
    const json = await exportText(await geminiTurns(), metadata, { format: ExportFormat.JSON });
    expect(json).toMatchInlineSnapshot(`
      "{
        "format": "gemini-voyager.chat.v1",
        "url": "https://gemini.google.com/app/abc123",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "count": 2,
        "title": "Integral help",
        "items": [
          {
            "user": "Explain the integral\\nwith an example",
            "assistant": "## Overview\\nInline $x^2$ and **bold** text.\\n\\n$$\\n\\\\int_0^1 x\\\\,dx\\n$$\\n\\n- first\\n- second \`value\`\\n\\n\`\`\`python\\nprint(\\"hi\\")\\n\`\`\`\\n\\n| A | B |\\n| --- | --- |\\n| 1 | 2 |\\n\\n> quoted\\n\\n---\\nDone.",
            "starred": true
          },
          {
            "user": "Thanks",
            "assistant": "You are welcome.",
            "starred": false
          }
        ]
      }"
    `);
  });

  it('writes the Markdown', async () => {
    const markdown = await exportText(await geminiTurns(), metadata, {
      format: ExportFormat.MARKDOWN,
    });
    expect(normalizeMarkdown(markdown)).toMatchInlineSnapshot(`
      "# Integral help

      **Date**: <date>
      **Turns**: 2
      **Source**: [Gemini Chat](https://gemini.google.com/app/abc123)

      ---

      ## Turn 1 ⭐

      ### 👤 User

      Explain the integral
      with an example

      ### 🤖 Assistant

      ## Overview
      Inline $x^2$ and **bold** text.

      $$
      \\int_0^1 x\\,dx
      $$

      - first
      - second \`value\`

      \`\`\`python
      print("hi")
      \`\`\`

      | A | B |
      | --- | --- |
      | 1 | 2 |

      > quoted

      ---
      Done.

      ## Turn 2

      ### 👤 User

      Thanks

      ### 🤖 Assistant

      You are welcome.

      ---

      *Exported from [Voyager](https://github.com/voyager-crew/voyager)*<br2>
      *Generated on <date>"
    `);
  });

  it('writes the Markdown with prompts as turn headings', async () => {
    const markdown = await exportText(await geminiTurns(), metadata, {
      format: ExportFormat.MARKDOWN,
      usePromptAsTurnHeading: true,
    });
    expect(normalizeMarkdown(markdown)).toMatchInlineSnapshot(`
      "# Integral help

      **Date**: <date>
      **Turns**: 2
      **Source**: [Gemini Chat](https://gemini.google.com/app/abc123)

      ---

      ## Turn 1: Explain the integral with an example ⭐

      ### 🤖 Assistant

      ## Overview
      Inline $x^2$ and **bold** text.

      $$
      \\int_0^1 x\\,dx
      $$

      - first
      - second \`value\`

      \`\`\`python
      print("hi")
      \`\`\`

      | A | B |
      | --- | --- |
      | 1 | 2 |

      > quoted

      ---
      Done.

      ## Turn 2: Thanks

      ### 🤖 Assistant

      You are welcome.

      ---

      *Exported from [Voyager](https://github.com/voyager-crew/voyager)*<br2>
      *Generated on <date>"
    `);
  });

  it('prints the PDF turns', async () => {
    expect(printedTurns(await geminiTurns(), metadata)).toMatchInlineSnapshot(`
      "
            <div class="gv-print-turn gv-print-turn-starred">
              <div class="gv-print-turn-header">
                <span class="gv-print-turn-number">Turn 1</span>
                <span class="gv-print-star">⭐</span>
              </div>
              <div class="gv-print-turn-user">
                <div class="gv-print-turn-label">👤 User</div>
                <div class="gv-print-turn-text"><p>Explain the integral</p>
      <p>with an example</p></div>
              </div>
                <div class="gv-print-turn-assistant">
                  <div class="gv-print-turn-label">🤖 Assistant</div>
                  <div class="gv-print-turn-text"><h2>Overview</h2>
      <p>Inline <span class="math-inline" data-math="x^2">x2</span> and <strong>bold</strong> text.</p>
      <div class="math-block" data-math="\\int_0^1 x\\,dx"></div>
      <ul><li>first</li><li>second <code>value</code></li></ul>
      <pre><code class="language-python">print("hi")</code></pre>
      <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
      <blockquote><p>quoted</p></blockquote>
      <hr>
      <p>Done.</p></div>
                </div>
            </div>
            <div class="gv-print-turn ">
              <div class="gv-print-turn-header">
                <span class="gv-print-turn-number">Turn 2</span>
              </div>
              <div class="gv-print-turn-user">
                <div class="gv-print-turn-label">👤 User</div>
                <div class="gv-print-turn-text"><p>Thanks</p></div>
              </div>
                <div class="gv-print-turn-assistant">
                  <div class="gv-print-turn-label">🤖 Assistant</div>
                  <div class="gv-print-turn-text"><p>You are welcome.</p></div>
                </div>
            </div>
            "
    `);
  });

  it('keeps export ids whether or not fork pairing ran first', () => {
    document.body.innerHTML = `
      <main>
        <div class="user-query-container">first prompt</div>
        <div class="response-container"><message-content>first answer</message-content></div>
        <div class="user-query-container">second prompt</div>
        <div class="response-container"><message-content>second answer</message-content></div>
      </main>
    `;
    const collector = createConversationCollector(geminiExportAdapter);
    const before = collector.collectSelectionMessages().map((message) => message.messageId);

    collectForkChatPairs();
    const after = collector.collectSelectionMessages().map((message) => message.messageId);

    expect(after).toEqual(before);
    expect(before).toEqual(['u-0:u', 'u-0:a', 'u-1:u', 'u-1:a']);
  });
});

describe('ChatGPT earlier-DOM conversation export output', () => {
  async function chatgptTurns(): Promise<ChatTurn[]> {
    document.body.innerHTML = CHATGPT_CONVERSATION;
    const ids = new Set(['11111111-aaaa', '22222222-bbbb']);
    return await createChatGptExportSite(chatgptExportAdapter).turns.build(ids, {});
  }

  const metadata: ConversationMetadata = {
    url: 'https://chatgpt.com/c/abc',
    exportedAt: '2026-01-02T03:04:05.000Z',
    count: 1,
    title: 'Physics',
    platform: chatgptExportAdapter.site.label,
  };

  it('writes the chat JSON', async () => {
    const json = await exportText(await chatgptTurns(), metadata, { format: ExportFormat.JSON });
    expect(json).toMatchInlineSnapshot(`
      "{
        "format": "gemini-voyager.chat.v1",
        "url": "https://chatgpt.com/c/abc",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "count": 1,
        "title": "Physics",
        "items": [
          {
            "user": "First line\\nSecond line",
            "assistant": "Energy is $E=mc^2$ here.\\n\\n$$\\n\\\\sum_i x_i\\n$$\\n\\n\`\`\`ts\\nconst x = 1;\\n\`\`\`\\n\\n1. one\\n2. two",
            "starred": false
          }
        ]
      }"
    `);
  });

  it('writes the Markdown', async () => {
    const markdown = await exportText(await chatgptTurns(), metadata, {
      format: ExportFormat.MARKDOWN,
    });
    expect(normalizeMarkdown(markdown)).toMatchInlineSnapshot(`
      "# Physics

      **Date**: <date>
      **Turns**: 1
      **Source**: [ChatGPT Chat](https://chatgpt.com/c/abc)

      ---

      ## Turn 1

      ### 👤 User

      First line
      Second line

      ### 🤖 Assistant

      Energy is $E=mc^2$ here.

      $$
      \\sum_i x_i
      $$

      \`\`\`ts
      const x = 1;
      \`\`\`

      1. one
      2. two

      ---

      *Exported from [Voyager](https://github.com/voyager-crew/voyager)*<br2>
      *Generated on <date>"
    `);
  });

  it('prints the PDF turns', async () => {
    expect(printedTurns(await chatgptTurns(), metadata)).toMatchInlineSnapshot(`
      "
            <div class="gv-print-turn ">
              <div class="gv-print-turn-header">
                <span class="gv-print-turn-number">Turn 1</span>
              </div>
              <div class="gv-print-turn-user">
                <div class="gv-print-turn-label">👤 User</div>
                <div class="gv-print-turn-text"><p>First line<br>Second line</p></div>
              </div>
                <div class="gv-print-turn-assistant">
                  <div class="gv-print-turn-label">🤖 Assistant</div>
                  <div class="gv-print-turn-text"><p>Energy is <span class="math-inline" data-math="E=mc^2"><span class="katex">E=mc2</span></span> here.</p>
      <div class="math-block" data-math="\\sum_i x_i"><span class="katex-display"><span class="katex">sum</span></span></div>
      <pre><code class="language-ts">const x = 1;</code></pre>
      <ol><li>one</li><li>two</li></ol></div>
                </div>
            </div>
            "
    `);
  });
});

describe('Deep Research report export output', () => {
  function reportTurns(): ChatTurn[] {
    document.body.innerHTML = DEEP_RESEARCH_REPORT;
    const reportRoot = document.querySelector<HTMLElement>(
      'deep-research-immersive-panel > message-content > .markdown',
    )!;
    const reportTurn: ChatTurn = {
      user: '',
      assistant: '',
      starred: false,
      omitEmptySections: true,
      assistantElement: reportRoot,
    };
    return [extractTurnContent(reportTurn, createContentExtractor(geminiExportAdapter))];
  }

  const metadata: ConversationMetadata = {
    url: 'https://gemini.google.com/app/report',
    exportedAt: '2026-01-02T03:04:05.000Z',
    count: 1,
    title: 'Solar Report',
  };

  it('writes the report JSON', async () => {
    const json = await exportText(reportTurns(), metadata, {
      format: ExportFormat.JSON,
      layout: 'document',
      filename: 'Solar-Report.json',
    });
    expect(json).toMatchInlineSnapshot(`
      "{
        "format": "gemini-voyager.report.v1",
        "url": "https://gemini.google.com/app/report",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "title": "Solar Report",
        "content": {
          "markdown": "# Solar Report\\nPanels convert $h\\\\nu$ into current.\\n\\n## Findings\\n\\n- Efficiency rose.",
          "html": "<h1>Solar Report</h1>\\n<p>Panels convert <span class=\\"math-inline\\" data-math=\\"h\\\\nu\\">hv</span> into current.</p>\\n<h2>Findings</h2>\\n<ul><li>Efficiency rose.</li></ul>"
        }
      }"
    `);
  });

  it('writes the report Markdown', async () => {
    const markdown = await exportText(reportTurns(), metadata, {
      format: ExportFormat.MARKDOWN,
      layout: 'document',
      filename: 'Solar-Report.md',
    });
    expect(normalizeMarkdown(markdown)).toMatchInlineSnapshot(`
      "# Solar Report
      Panels convert $h\\nu$ into current.

      ## Findings

      - Efficiency rose.

      ---

      Source: https://gemini.google.com/app/report
      Exported at: 2026-01-02T03:04:05.000Z"
    `);
  });
});
