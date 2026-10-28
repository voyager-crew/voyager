import { describe, expect, it, vi } from 'vitest';

import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { CatalogTimelineAdapter } from '@/features/timeline/adapters/catalog/CatalogTimelineAdapter';
import { CatalogTurnOwnership } from '@/features/timeline/adapters/catalog/CatalogTurnOwnership';

import { createChatGptExportSite } from '../../sites/chatgpt';
import { buildChatGptTurnsForSelection } from '../chatgpt';
import { createChatGptThreadPreparer, type ChatGptThreadSession } from '../chatgptThreadExport';
import { buildChatGptAdapter } from '../platform/chatgpt';
import {
  FAST,
  extractor,
  libraryRead,
  mountRetained,
  setupChatGptStarTests,
  star,
} from './chatgptStarsHarness';
import { makeTurns, mountThreadFixture } from './chatgptThreadFixture';

setupChatGptStarTests();

describe('ChatGPT Library stars on a crawled thread', () => {
  it('rejects a reply regenerated while its Library read is pending', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(3) });
    const session = await createChatGptThreadPreparer().prepare({ extractor, timing: FAST });
    if (!session) throw new Error('thread was not prepared');
    libraryRead.mockImplementation(async () => {
      fixture.replaceTurn('turn-03', { replyId: 'regenerated-reply' });
      return [star('Question 3')];
    });
    try {
      await expect(session.build(new Set(['turn-03:a']), {})).rejects.toThrow(
        'chatgpt_export_thread_changed',
      );
      expect(session.containers()).toEqual([]);
    } finally {
      session.release();
    }
  });

  it('does not revive a session released during its Library read', async () => {
    mountThreadFixture({ turns: makeTurns(2) });
    const session = await createChatGptThreadPreparer().prepare({ extractor, timing: FAST });
    if (!session) throw new Error('thread was not prepared');
    libraryRead.mockImplementation(async () => {
      session.release();
      return [star('Question 1')];
    });

    await expect(session.build(new Set(['turn-01:a']), {})).rejects.toThrow(
      'chatgpt_export_thread_incomplete',
    );
    expect(session.containers()).toEqual([]);
  });

  it('surfaces a Library failure in a crawled session build', async () => {
    mountThreadFixture({ turns: makeTurns(2) });
    const session = await createChatGptThreadPreparer().prepare({ extractor, timing: FAST });
    if (!session) throw new Error('thread was not prepared');
    libraryRead.mockRejectedValue(new Error('Library unavailable'));
    try {
      await expect(session.build(new Set(['turn-01:a']), {})).rejects.toThrow(
        'Library unavailable',
      );
    } finally {
      session.release();
    }
  });
});

describe('ChatGPT timeline and export star identity', () => {
  it.each(['retained', 'crawled'] as const)(
    'exports the real %s timeline marker star from the raw inner bubble despite controls and export line breaks',
    async (kind) => {
      let session: ChatGptThreadSession | null = null;
      if (kind === 'retained') mountRetained();
      else {
        const fixture = mountThreadFixture({
          turns: [{ key: 'one', height: 200, user: 'FirstSecond', assistant: 'Answer' }],
        });
        fixture.main.querySelector('[data-user-message-bubble] [dir="auto"]')!.innerHTML =
          '<div>First</div><div>Second</div>';
      }
      const ownership = new CatalogTurnOwnership({
        routeId: () => location.href,
        starId: () => 'chatgpt:conv:conv',
      });
      ownership.begin();
      const timeline = new CatalogTimelineAdapter(
        {
          siteId: chatgptAdapter.id,
          siteLabel: chatgptAdapter.label,
          turnSelector: chatgptAdapter.selectors.userTurn,
          assistantTurnSelector: chatgptAdapter.selectors.assistantTurn,
          conversationIdPattern: chatgptAdapter.conversationIdPattern,
          position: 'right',
          pluginId: 'voyager.chatgpt-timeline',
          coachmarkId: 'test',
        },
        ownership,
      );
      const markers = timeline.turns.read([]).markers;
      expect(markers).toHaveLength(1);
      const marker = markers[0]!;
      timeline.turns.stop();
      libraryRead.mockResolvedValue([{ ...star('unused'), turnId: marker.id }]);
      if (kind === 'crawled') {
        session = await createChatGptThreadPreparer().prepare({ extractor, timing: FAST });
        if (!session) throw new Error('Expected a crawled thread');
      }
      try {
        const turns = session
          ? await session.build(new Set(['one:u', 'one:a']), {})
          : await buildChatGptTurnsForSelection(new Set(['prompt-uuid', 'reply-uuid']), {
              extractor,
            });
        expect(turns).toMatchObject([{ assistant: 'Answer', starred: true }]);
        expect(turns[0]!.user).toContain('First\nSecond');
        expect(marker.summary).toBe('FirstSecond');
        expect(libraryRead).toHaveBeenCalledWith('chatgpt:conv:conv');
        expect(libraryRead).toHaveBeenCalledTimes(1);
      } finally {
        session?.release();
      }
    },
  );
});

describe('ChatGPT export Library inputs', () => {
  it.each(['/', '/?temporary-chat=true'])(
    'exports an unnamed route %s without reading a Library namespace',
    async (path) => {
      mountRetained();
      vi.stubGlobal('location', new URL(path, 'https://chatgpt.com'));
      expect(
        await buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor }),
      ).toMatchObject([{ starred: false }]);
      expect(libraryRead).not.toHaveBeenCalled();
    },
  );

  it('keeps offscreen duplicate prompts starred through positional aliases and reads a removed star at the next build', async () => {
    const prompt = 'Repeated prompt with text beyond a short Library preview';
    libraryRead.mockResolvedValue([star(prompt)]);
    const fixture = mountThreadFixture({
      turns: [
        { key: 'first', height: 1500, user: prompt, assistant: 'First reply' },
        { key: 'second', height: 1500, user: prompt, assistant: 'Second reply' },
        { key: 'last', height: 1500, user: 'Different', assistant: 'Last reply' },
      ],
    });
    const session = await createChatGptThreadPreparer().prepare({ extractor, timing: FAST });
    if (!session) throw new Error('Expected a crawled thread');
    try {
      expect(fixture.mountedKeys()).not.toContain('first');
      expect(
        await session.build(new Set(['first:a', 'second:u', 'second:a', 'last:a']), {}),
      ).toMatchObject([
        { user: '', assistant: 'First reply', starred: true },
        { user: prompt, assistant: 'Second reply', starred: true },
        { user: '', assistant: 'Last reply', starred: false },
      ]);
      libraryRead.mockResolvedValue([]);
      expect(await session.build(new Set(['first:a']), {})).toMatchObject([{ starred: false }]);
    } finally {
      session.release();
    }
  });

  it('marks final turns from the Library through the prepared export site reader', async () => {
    mountThreadFixture({
      turns: [{ key: 'one', height: 200, user: 'Question', assistant: 'Answer' }],
    });
    libraryRead.mockResolvedValue([star('Question')]);
    const session = await createChatGptExportSite(
      buildChatGptAdapter(chatgptAdapter),
    ).turns.prepare?.({});
    if (!session) throw new Error('Expected a prepared export reader');
    try {
      expect(await session.build(new Set(['one:a']), {})).toMatchObject([
        { user: '', assistant: 'Answer', starred: true },
      ]);
    } finally {
      session.release();
    }
  });
});

describe.each(['retained', 'crawled'] as const)(
  '%s export while Library input is pending',
  (kind) => {
    async function reader() {
      if (kind === 'retained') {
        mountRetained();
        return {
          turns: createChatGptExportSite(buildChatGptAdapter(chatgptAdapter)).turns,
          selected: new Set(['reply-uuid']),
        };
      }
      mountThreadFixture({
        turns: [{ key: 'one', height: 200, user: 'Question', assistant: 'Answer' }],
      });
      const session = await createChatGptThreadPreparer().prepare({ extractor, timing: FAST });
      if (!session) throw new Error('Expected a crawled thread');
      return { turns: session, selected: new Set(['one:a']) };
    }

    function pendingLibraryRead(): (messages: StarredMessage[]) => void {
      let resolve!: (messages: StarredMessage[]) => void;
      libraryRead.mockImplementationOnce(
        () =>
          new Promise((reply) => {
            resolve = reply;
          }),
      );
      return (messages) => resolve(messages);
    }

    it('rejects a Library reply after cancellation', async () => {
      const { turns, selected } = await reader();
      try {
        const release = pendingLibraryRead();
        const controller = new AbortController();
        const pending = turns.build(selected, { signal: controller.signal });
        await vi.waitFor(() => expect(libraryRead).toHaveBeenCalled());
        controller.abort();
        release([star('Question')]);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      } finally {
        if ('release' in turns) turns.release();
      }
    });

    it('rejects a Library reply after the captured account route changes', async () => {
      const { turns, selected } = await reader();
      try {
        const release = pendingLibraryRead();
        const pending = turns.build(selected, {});
        await vi.waitFor(() => expect(libraryRead).toHaveBeenCalled());
        vi.stubGlobal('location', new URL('https://chatgpt.com/u/3/c/conv'));
        release([star('Question')]);
        await expect(pending).rejects.toThrow('chatgpt_export_conversation_changed');
      } finally {
        if ('release' in turns) turns.release();
      }
    });
  },
);
