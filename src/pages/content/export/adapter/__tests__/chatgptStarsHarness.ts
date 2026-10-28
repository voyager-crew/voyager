import { type MockInstance, afterEach, beforeEach, vi } from 'vitest';

import { hashString } from '@/core/utils/hash';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { turnSummary } from '@/features/timeline/adapters/catalog/turnHash';

import type { ChatGptCrawlTiming } from '../chatgptCrawl';
import { buildChatGptAdapter } from '../platform/chatgpt';

export const FAST: Partial<ChatGptCrawlTiming> = {
  pollMs: 1,
  settleMs: 4,
  mountTimeoutMs: 400,
  historyIdleMs: 25,
  historyStallMs: 150,
};
export const extractor = createContentExtractor(buildChatGptAdapter(chatgptAdapter));
export let libraryRead: MockInstance<(id: string) => Promise<StarredMessage[]>>;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

export function star(rawBubbleText: string): StarredMessage {
  const bubble = document.createElement('div');
  bubble.textContent = rawBubbleText;
  return {
    turnId: `c-7-${hashString(turnSummary(bubble))}~2`,
    content: 'Truncated Library preview',
    conversationId: 'chatgpt:conv:conv',
    conversationUrl: 'https://chatgpt.com/u/1/c/conv',
    starredAt: 1,
  };
}

export function mountRetained(): void {
  document.body.innerHTML = `
    <main>
      <div data-turn-id-container="prompt-uuid">
        <div data-message-author-role="user">
          <div data-user-message-bubble><div>First</div><div>Second</div></div>
          <button>Copy message</button>
        </div>
      </div>
      <div data-turn-id-container="reply-uuid">
        <div data-message-author-role="assistant"><p>Answer</p></div>
      </div>
    </main>`;
}

/** A ChatGPT conversation page with an empty Library and inert scrolling around every case. */
export function setupChatGptStarTests(): void {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal('location', new URL('https://chatgpt.com/u/1/c/conv'));
    libraryRead = vi
      .spyOn(StarredMessagesService, 'getStarredMessagesForConversation')
      .mockResolvedValue([]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
}
