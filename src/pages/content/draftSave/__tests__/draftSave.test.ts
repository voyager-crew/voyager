import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildInstructionBlock } from '../../folderProject/instructionBlock';
import {
  SEND_CHECK_INTERVAL_MS,
  addSentUserTurn,
  createContentEditable,
  createMainComposer,
  localStore,
  setupDraftSaveTests,
  setupMocks,
  startDraftPlugin,
} from './draftSaveHarness';

describe('draftSave', () => {
  setupDraftSaveTests();

  it('saves draft on input change when enabled', async () => {
    setupMocks();
    const input = createContentEditable();
    input.textContent = '';

    const cleanup = await startDraftPlugin();

    // Simulate typing
    input.textContent = 'Hello, this is my draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Advance past the debounce
    vi.advanceTimersByTime(1000);

    // Check that a draft was saved to local storage
    const draftKey = 'gvDraft_/app/test-conversation-123';
    expect(localStore[draftKey]).toBeDefined();
    const draft = localStore[draftKey] as {
      content: string;
      timestamp: number;
      path: string;
    };
    expect(draft.content).toBe('Hello, this is my draft');
    expect(draft.path).toBe('/app/test-conversation-123');

    cleanup();
  });

  it('strips folder project instructions before saving a draft', async () => {
    setupMocks();
    const input = createContentEditable();

    const cleanup = await startDraftPlugin();

    input.textContent = `${buildInstructionBlock('Inbox', 'Always answer tersely.')}User draft`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1000);

    const draft = localStore['gvDraft_/app/test-conversation-123'] as {
      content: string;
    };
    expect(draft.content).toBe('User draft');

    cleanup();
  });

  it('removes draft when input becomes empty', async () => {
    setupMocks();
    const input = createContentEditable();

    const cleanup = await startDraftPlugin();

    // Save a draft first
    input.textContent = 'Some content';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1000);

    const draftKey = 'gvDraft_/app/test-conversation-123';
    expect(localStore[draftKey]).toBeDefined();

    // Now clear the input
    input.textContent = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1000);

    expect(localStore[draftKey]).toBeUndefined();

    cleanup();
  });

  it('keeps a pending draft bound to the route where typing happened', async () => {
    setupMocks();
    const input = createContentEditable();

    const cleanup = await startDraftPlugin();

    input.textContent = 'Draft from the first conversation';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    window.location.pathname = '/app/second-conversation';
    input.textContent = '';
    vi.advanceTimersByTime(500);

    expect(localStore['gvDraft_/app/test-conversation-123']).toMatchObject({
      content: 'Draft from the first conversation',
      path: '/app/test-conversation-123',
    });
    expect(localStore['gvDraft_/app/second-conversation']).toBeUndefined();

    cleanup();
  });

  it('uses the live route when typing starts before the shared route poller catches up', async () => {
    setupMocks();
    const input = createContentEditable();

    const cleanup = await startDraftPlugin();

    window.location.pathname = '/app/second-conversation';
    input.textContent = 'Draft typed immediately after navigation';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1000);

    expect(localStore['gvDraft_/app/second-conversation']).toMatchObject({
      content: 'Draft typed immediately after navigation',
      path: '/app/second-conversation',
    });
    expect(localStore['gvDraft_/app/test-conversation-123']).toBeUndefined();

    cleanup();
  });

  it('does not re-save sent text when the first message creates a conversation route', async () => {
    setupMocks();
    window.location.pathname = '/app';
    const { input } = createMainComposer();

    const cleanup = await startDraftPlugin();

    input.textContent = 'Message that is about to be sent';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(localStore['gvDraft_/app']).toBeDefined();

    input.textContent = 'Updated message that is sent';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    window.location.pathname = '/app/new-conversation-id';
    addSentUserTurn('Updated message that is sent');
    input.textContent = '';
    vi.advanceTimersByTime(400);

    expect(localStore['gvDraft_/app']).toBeUndefined();
    expect(localStore['gvDraft_/app/new-conversation-id']).toBeUndefined();

    cleanup();
  });

  it('does not delete a stored draft when the host clears the composer without sending', async () => {
    setupMocks();
    const { input } = createMainComposer();
    const stop = await startDraftPlugin();
    input.textContent = 'Keep the unsent draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);

    input.textContent = '';
    await vi.advanceTimersByTimeAsync(2500);
    expect(localStore['gvDraft_/app/test-conversation-123']).toMatchObject({
      content: 'Keep the unsent draft',
    });
    stop();
  });

  it('does not delete the destination draft when navigation empties the input', async () => {
    setupMocks();
    const destinationKey = 'gvDraft_/app/second-conversation';
    localStore[destinationKey] = {
      content: 'Destination draft',
      timestamp: Date.now(),
      path: '/app/second-conversation',
    };
    const input = createContentEditable();
    input.textContent = 'Source draft';
    document.execCommand = vi.fn().mockReturnValue(true);

    const cleanup = await startDraftPlugin();

    // Let send detection observe non-empty content on the source route.
    vi.advanceTimersByTime(1000);
    window.location.pathname = '/app/second-conversation';
    input.textContent = '';
    vi.advanceTimersByTime(1000);

    expect(localStore[destinationKey]).toMatchObject({ content: 'Destination draft' });

    cleanup();
  });

  it('restores draft on startup when input is empty', async () => {
    vi.useRealTimers();
    setupMocks();

    // Pre-seed a draft
    const draftKey = 'gvDraft_/app/test-conversation-123';
    localStore[draftKey] = {
      content: 'My saved draft',
      timestamp: Date.now(),
      path: '/app/test-conversation-123',
    };

    const input = createContentEditable();
    input.textContent = '';

    // Mock execCommand for text insertion
    document.execCommand = vi.fn().mockReturnValue(true);

    const cleanup = await startDraftPlugin();

    // Wait for the async restore to complete (loadDraft + restore delay retries)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // execCommand should have been called with the draft content
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'My saved draft');

    cleanup();
  });

  describe('a restore still pending when the feature stops', () => {
    const draftKey = 'gvDraft_/app/test-conversation-123';

    function seedDraft(): void {
      localStore[draftKey] = {
        content: 'My saved draft',
        timestamp: Date.now(),
        path: '/app/test-conversation-123',
      };
    }

    function expectInert(input: HTMLElement): void {
      expect(document.execCommand).not.toHaveBeenCalled();
      input.textContent = 'Typed after stopping';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(2000);
      expect((localStore[draftKey] as { content: string }).content).toBe('My saved draft');
    }

    it('does not rebind or restore when a retry fires after stopping', async () => {
      setupMocks();
      seedDraft();
      document.execCommand = vi.fn().mockReturnValue(true);
      const stop = await startDraftPlugin();
      await vi.advanceTimersByTimeAsync(0);

      // The composer has not rendered yet, so restore is waiting on a retry.
      stop();
      const input = createContentEditable();
      await vi.advanceTimersByTimeAsync(5 * 500);

      expectInert(input);
    });

    it('does not rebind or restore when the draft load resolves after stopping', async () => {
      setupMocks();
      seedDraft();
      document.execCommand = vi.fn().mockReturnValue(true);
      const local = chrome.storage.local as unknown as { get: ReturnType<typeof vi.fn> };
      const immediateGet = local.get.getMockImplementation() as (
        key: unknown,
        callback: (r: unknown) => void,
      ) => void;
      local.get.mockImplementation((key: unknown, callback: (r: unknown) => void) => {
        setTimeout(() => immediateGet(key, callback), 50);
      });
      const input = createContentEditable();
      const stop = await startDraftPlugin();

      stop();
      await vi.advanceTimersByTimeAsync(5 * 500);

      expectInert(input);
    });
  });

  it('strips folder project instructions from an older stored draft on restore', async () => {
    vi.useRealTimers();
    setupMocks();

    localStore['gvDraft_/app/test-conversation-123'] = {
      content: `${buildInstructionBlock('Coding', 'Reply with tests first.')}Recovered user text`,
      timestamp: Date.now(),
      path: '/app/test-conversation-123',
    };

    createContentEditable();
    document.execCommand = vi.fn().mockReturnValue(true);

    const cleanup = await startDraftPlugin();

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'Recovered user text');

    cleanup();
  });

  it('does not look up the input while unrelated content streams into the page', async () => {
    setupMocks();
    let rectReads = 0;
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => {
        rectReads += 1;
        return { height: 100, width: 500, top: 0, left: 0, bottom: 100, right: 500 };
      },
    });
    document.body.appendChild(input);
    const cleanup = await startDraftPlugin();
    // Start right after a send-detection tick so the poller stays out of the window.
    await vi.advanceTimersByTimeAsync(SEND_CHECK_INTERVAL_MS);

    rectReads = 0;
    const querySpy = vi.spyOn(document, 'querySelectorAll');
    const chat = document.createElement('div');
    document.body.appendChild(chat);
    for (let i = 0; i < 30; i++) {
      const chunk = document.createElement('p');
      chunk.textContent = `Streamed chunk ${i}`;
      chat.appendChild(chunk);
      await vi.advanceTimersByTimeAsync(16);
    }

    expect(rectReads).toBe(0);
    expect(querySpy).not.toHaveBeenCalled();
    cleanup();
  });

  it('follows Gemini when it replaces the chat input', async () => {
    setupMocks();
    const original = createContentEditable();
    const cleanup = await startDraftPlugin();

    original.remove();
    const replacement = createContentEditable();
    await vi.advanceTimersByTimeAsync(16);

    replacement.textContent = 'Typed into the new composer';
    replacement.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1000);

    const draft = localStore['gvDraft_/app/test-conversation-123'] as { content: string };
    expect(draft.content).toBe('Typed into the new composer');
    cleanup();
  });

  describe('when Gemini switches between two mounted composers', () => {
    let stop: (() => void) | null = null;

    afterEach(() => {
      stop?.();
      stop = null;
    });

    function createComposer(): { el: HTMLElement; setVisible: (visible: boolean) => void } {
      let visible = true;
      const el = document.createElement('div');
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('role', 'textbox');
      Object.defineProperty(el, 'getBoundingClientRect', {
        value: () => ({ height: visible ? 100 : 0, width: visible ? 500 : 0, top: 0, left: 0 }),
      });
      document.body.appendChild(el);
      return { el, setVisible: (next) => (visible = next) };
    }

    async function startWithSwitchedComposer(): Promise<HTMLElement> {
      setupMocks();
      const previous = createComposer();
      const next = createComposer();
      next.setVisible(false);
      stop = await startDraftPlugin();
      // Gemini hides the bound composer and reveals the other one; both stay connected.
      previous.setVisible(false);
      next.setVisible(true);
      return next.el;
    }

    function type(input: HTMLElement, text: string): void {
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(1000);
    }

    it('saves typing in the composer the user focuses', async () => {
      const next = await startWithSwitchedComposer();

      next.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(16);
      type(next, 'Typed into the revealed composer');

      const draft = localStore['gvDraft_/app/test-conversation-123'] as { content: string };
      expect(draft?.content).toBe('Typed into the revealed composer');
    });

    it('saves input dispatched in the same tick as the focus that switched composers', async () => {
      const next = await startWithSwitchedComposer();

      // Prompt Manager focuses the composer and dispatches `input` synchronously.
      next.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      type(next, 'Inserted prompt');

      const draft = localStore['gvDraft_/app/test-conversation-123'] as { content: string };
      expect(draft?.content).toBe('Inserted prompt');
    });

    it('saves typing in the visible composer without a focus event', async () => {
      const next = await startWithSwitchedComposer();

      vi.advanceTimersByTime(SEND_CHECK_INTERVAL_MS);
      type(next, 'Typed without a focus event');

      const draft = localStore['gvDraft_/app/test-conversation-123'] as { content: string };
      expect(draft?.content).toBe('Typed without a focus event');
    });
  });
});
