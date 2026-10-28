import { describe, expect, it, vi } from 'vitest';

import { buildChatGptTurnsForSelection } from '../chatgpt';
import {
  extractor,
  libraryRead,
  mountRetained,
  setupChatGptStarTests,
  star,
} from './chatgptStarsHarness';

setupChatGptStarTests();

describe('ChatGPT Library stars on retained containers', () => {
  it('a streaming reply with a Library star exports the completed answer', async () => {
    vi.useFakeTimers();
    mountRetained();
    libraryRead.mockResolvedValue([star('FirstSecond')]);
    const reply = document.querySelector<HTMLElement>('[data-message-author-role="assistant"]')!;
    reply.textContent = 'Partial answer';
    reply.setAttribute('data-message-streaming', 'true');
    window.setTimeout(() => {
      reply.textContent = 'Completed answer';
      reply.removeAttribute('data-message-streaming');
    }, 100);
    const outcome = buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor }).then(
      (turns) => ({ turns, error: null }),
      (error: unknown) => ({ turns: null, error }),
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(await outcome).toMatchObject({
      error: null,
      turns: [{ user: '', assistant: 'Completed answer', starred: true }],
    });
  });

  it('materializes an unselected virtual prompt for an assistant-only star and restores scroll', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main style="overflow-y:auto">
        <div data-turn-id-container="prompt-uuid"><section data-turn="user"></section></div>
        <div data-turn-id-container="reply-uuid"><section data-turn="assistant">
          <div data-message-author-role="assistant"><p>Answer</p></div>
        </section></div>
      </main>`;
    const scroller = document.querySelector('main')!;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
    scroller.scrollTop = 250;
    libraryRead.mockResolvedValue([star('Offscreen prompt')]);
    const prompt = document.querySelector<HTMLElement>('[data-turn-id-container="prompt-uuid"]')!;
    const reply = document.querySelector<HTMLElement>('[data-turn-id-container="reply-uuid"]')!;
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockImplementation(
      function (this: HTMLElement) {
        scroller.scrollTop = 0;
        if (this === prompt) {
          prompt.innerHTML = '<div data-message-author-role="user">Offscreen prompt</div>';
          reply.innerHTML = '<section data-turn="assistant"></section>';
        } else if (this === reply) {
          reply.innerHTML = '<div data-message-author-role="assistant"><p>Answer</p></div>';
        }
      },
    );

    const build = buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(build).resolves.toMatchObject([{ user: '', assistant: 'Answer', starred: true }]);
    expect(scroller.scrollTop).toBe(250);
  });

  it('rejects a branch switch during the offscreen prompt and return scroll instead of starring a new answer', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <div data-turn-id-container="oldprompt"><section data-turn="user"></section></div>
        <div data-turn-id-container="oldreply">
          <div data-message-author-role="assistant"><p>Old answer</p></div>
        </div>
      </main>`;
    const prompt = document.querySelector<HTMLElement>('[data-turn-id-container="oldprompt"]')!;
    const reply = document.querySelector<HTMLElement>('[data-turn-id-container="oldreply"]')!;
    libraryRead.mockResolvedValue([star('Old prompt')]);
    const scrolls: string[] = [];
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockImplementation(
      function (this: HTMLElement) {
        scrolls.push(this.getAttribute('data-turn-id-container')!);
        if (this === prompt) {
          prompt.innerHTML = '<div data-message-author-role="user">Old prompt</div>';
          reply.innerHTML = '<section data-turn="assistant"></section>';
        } else if (this === reply) {
          prompt.setAttribute('data-turn-id-container', 'newprompt');
          reply.setAttribute('data-turn-id-container', 'newreply');
          prompt.innerHTML = '<div data-message-author-role="user">New prompt</div>';
          reply.innerHTML =
            '<div data-message-author-role="assistant"><p>New branch answer</p></div>';
        }
      },
    );

    const outcome = buildChatGptTurnsForSelection(new Set(['oldreply']), { extractor }).then(
      (turns) => ({ turns, error: null }),
      (error: unknown) => ({ turns: null, error }),
    );
    await vi.advanceTimersByTimeAsync(1000);

    const result = await outcome;
    expect(scrolls).toEqual(['oldprompt', 'oldreply']);
    expect(result.error).toMatchObject({ message: 'chatgpt_export_thread_changed' });
    expect(result.turns).toBeNull();
  });

  it('rejects a prompt learned on mount when the return scroll changes its text under the same ids', async () => {
    vi.useFakeTimers();
    mountRetained();
    const prompt = document.querySelector<HTMLElement>('[data-turn-id-container="prompt-uuid"]')!;
    const reply = document.querySelector<HTMLElement>('[data-turn-id-container="reply-uuid"]')!;
    prompt.innerHTML = '<section data-turn="user"></section>';
    libraryRead.mockResolvedValue([star('Old prompt')]);
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockImplementation(
      function (this: HTMLElement) {
        if (this === prompt) {
          prompt.innerHTML = '<div data-message-author-role="user">Old prompt</div>';
          reply.innerHTML = '<section data-turn="assistant"></section>';
        } else if (this === reply) {
          prompt.innerHTML = '<div data-message-author-role="user">New prompt</div>';
          reply.innerHTML = '<div data-message-author-role="assistant"><p>Answer</p></div>';
        }
      },
    );
    const outcome = buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor }).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toMatchObject({ message: 'chatgpt_export_thread_changed' });
  });

  it('a zero-star assistant export does not materialize its offscreen prompt', async () => {
    mountRetained();
    document.querySelector('[data-turn-id-container="prompt-uuid"]')!.innerHTML = '';

    const turns = await buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor });

    expect(turns).toMatchObject([{ user: '', assistant: 'Answer', starred: false }]);
    expect(libraryRead).toHaveBeenCalledTimes(1);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('rejects a prompt edited during the Library read instead of assigning its old star', async () => {
    mountRetained();
    libraryRead.mockImplementation(async () => {
      document.querySelector('[data-user-message-bubble]')!.textContent = 'Edited prompt';
      return [star('FirstSecond')];
    });

    await expect(
      buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor }),
    ).rejects.toThrow('chatgpt_export_thread_changed');
  });

  it.each(['<section data-turn="user"></section>', '<div data-message-author-role="user"></div>'])(
    'allows a prompt to unmount to %s during the Library read and hashes it after remounting',
    async (placeholder) => {
      vi.useFakeTimers();
      mountRetained();
      const prompt = document.querySelector<HTMLElement>('[data-turn-id-container="prompt-uuid"]')!;
      libraryRead.mockImplementation(async () => {
        prompt.innerHTML = placeholder;
        return [star('FirstSecond')];
      });
      vi.mocked(HTMLElement.prototype.scrollIntoView).mockImplementation(
        function (this: HTMLElement) {
          if (this === prompt) {
            prompt.innerHTML = '<div data-message-author-role="user">FirstSecond</div>';
          }
        },
      );

      const build = buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor });
      await vi.advanceTimersByTimeAsync(500);

      await expect(build).resolves.toMatchObject([
        { user: '', assistant: 'Answer', starred: true },
      ]);
    },
  );

  it('surfaces a Library read failure at the retained final build', async () => {
    mountRetained();
    libraryRead.mockRejectedValue(new Error('Library unavailable'));

    await expect(
      buildChatGptTurnsForSelection(new Set(['reply-uuid']), { extractor }),
    ).rejects.toThrow('Library unavailable');
  });
});
