import { describe, expect, it } from 'vitest';

import type { ChatTurn, ConversationMetadata } from '@/features/export/types/export';
import { ExportFormat } from '@/features/export/types/export';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { mountThreadFixture } from '../adapter/__tests__/chatgptThreadFixture';
import type { ChatGptCrawlTiming } from '../adapter/chatgptCrawl';
import { createChatGptTurnSource } from '../adapter/chatgptTurnSource';
import { buildChatGptAdapter } from '../adapter/platform/chatgpt';
import { exportText, normalizeMarkdown, printedTurns } from './exportOutputGoldenHarness';

const chatgptExportAdapter = buildChatGptAdapter(chatgptAdapter);

describe('ChatGPT crawled conversation export output', () => {
  const FAST: Partial<ChatGptCrawlTiming> = {
    pollMs: 1,
    settleMs: 4,
    mountTimeoutMs: 400,
    historyIdleMs: 25,
    historyStallMs: 150,
  };

  /** The current DOM: the export crawls the virtualized thread and reads every message. */
  async function crawledTurns(): Promise<ChatTurn[]> {
    mountThreadFixture({
      turns: [
        { key: 'turn-01', height: 1500, user: 'What is energy?', assistant: 'Energy is work.' },
        {
          key: 'turn-02',
          height: 1500,
          user: 'First line\nSecond line',
          assistant: 'Two lines noted.',
        },
      ],
    });
    const session = await createChatGptTurnSource(chatgptExportAdapter).prepare({
      timing: FAST,
    });
    const ids = session!.messages().map((message) => message.messageId);
    expect(ids).toEqual(['turn-01:u', 'turn-01:a', 'turn-02:u', 'turn-02:a']);
    const turns = await session!.build(new Set(ids), {});
    session!.release();
    return turns;
  }

  const metadata: ConversationMetadata = {
    url: 'https://chatgpt.com/c/abc',
    exportedAt: '2026-01-02T03:04:05.000Z',
    count: 2,
    title: 'Energy',
    platform: chatgptExportAdapter.site.label,
  };

  it('writes the chat JSON', async () => {
    const json = await exportText(await crawledTurns(), metadata, { format: ExportFormat.JSON });
    expect(json).toMatchInlineSnapshot(`
      "{
        "format": "gemini-voyager.chat.v1",
        "url": "https://chatgpt.com/c/abc",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "count": 2,
        "title": "Energy",
        "items": [
          {
            "user": "What is energy?",
            "assistant": "Energy is work.",
            "starred": false
          },
          {
            "user": "First line\\nSecond line",
            "assistant": "Two lines noted.",
            "starred": false
          }
        ]
      }"
    `);
  });

  it('writes the Markdown', async () => {
    const markdown = await exportText(await crawledTurns(), metadata, {
      format: ExportFormat.MARKDOWN,
    });
    expect(normalizeMarkdown(markdown)).toMatchInlineSnapshot(`
      "# Energy

      **Date**: <date>
      **Turns**: 2
      **Source**: [ChatGPT Chat](https://chatgpt.com/c/abc)

      ---

      ## Turn 1

      ### 👤 User

      What is energy?

      ### 🤖 Assistant

      Energy is work.

      ## Turn 2

      ### 👤 User

      First line
      Second line

      ### 🤖 Assistant

      Two lines noted.

      ---

      *Exported from [Voyager](https://github.com/voyager-crew/voyager)*<br2>
      *Generated on <date>"
    `);
  });

  it('prints the PDF turns', async () => {
    expect(printedTurns(await crawledTurns(), metadata)).toMatchInlineSnapshot(`
      "
            <div class="gv-print-turn ">
              <div class="gv-print-turn-header">
                <span class="gv-print-turn-number">Turn 1</span>
              </div>
              <div class="gv-print-turn-user">
                <div class="gv-print-turn-label">👤 User</div>
                <div class="gv-print-turn-text"><p>What is energy?</p></div>
              </div>
                <div class="gv-print-turn-assistant">
                  <div class="gv-print-turn-label">🤖 Assistant</div>
                  <div class="gv-print-turn-text"><p>Energy is work.</p></div>
                </div>
            </div>
            <div class="gv-print-turn ">
              <div class="gv-print-turn-header">
                <span class="gv-print-turn-number">Turn 2</span>
              </div>
              <div class="gv-print-turn-user">
                <div class="gv-print-turn-label">👤 User</div>
                <div class="gv-print-turn-text"><p>First line<br>Second line</p></div>
              </div>
                <div class="gv-print-turn-assistant">
                  <div class="gv-print-turn-label">🤖 Assistant</div>
                  <div class="gv-print-turn-text"><p>Two lines noted.</p></div>
                </div>
            </div>
            "
    `);
  });
});
