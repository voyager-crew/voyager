import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  createContentEditable,
  localStore,
  setupDraftSaveTests,
  setupMocks,
  startDraftPlugin,
} from './draftSaveHarness';

describe('draftSave', () => {
  setupDraftSaveTests();

  describe('the Gemini draft policy', () => {
    const draftKey = 'gvDraft_/app/test-conversation-123';

    function storedDrafts(): string[] {
      return Object.keys(localStore).filter((key) => key.startsWith('gvDraft'));
    }

    it('preserves the three-stage blank-line folding for existing Gemini drafts', async () => {
      setupMocks();
      document.execCommand = vi.fn().mockReturnValue(true);
      const input = createContentEditable();
      let stop = await startDraftPlugin();

      // Input and store each fold `\n\n` into `\n`: four newlines are stored as one.
      input.textContent = 'First\n\n\n\nSecond';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(1000);
      expect((localStore[draftKey] as { content: string }).content).toBe('First\nSecond');

      // A refresh restores what was stored.
      stop();
      input.textContent = '';
      stop = await startDraftPlugin();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.execCommand).toHaveBeenLastCalledWith('insertText', false, 'First\nSecond');
      stop();

      // A draft stored before the input stage existed is folded once more on restore.
      localStore[draftKey] = { content: 'First\n\n\n\nSecond', timestamp: 1, path: '/app/x' };
      stop = await startDraftPlugin();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.execCommand).toHaveBeenLastCalledWith('insertText', false, 'First\n\nSecond');
      stop();
    });

    it('treats a placeholder-only input as empty', async () => {
      setupMocks();
      localStore[draftKey] = { content: 'My saved draft', timestamp: 1, path: '/app/x' };
      document.execCommand = vi.fn().mockReturnValue(true);
      const input = createContentEditable();
      input.setAttribute('data-placeholder', 'Ask Gemini');
      input.textContent = 'Ask Gemini';

      const stop = await startDraftPlugin();
      await vi.advanceTimersByTimeAsync(0);

      expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'My saved draft');
      stop();
    });

    it('keeps the gvDraft_ prefix and full pathname for Gemini drafts', async () => {
      setupMocks();
      window.location.pathname = '/u/1/gem/abc123/c9f0';
      const input = createContentEditable();
      const stop = await startDraftPlugin();

      input.textContent = 'Draft in a Gem on the second account';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(1000);

      expect(storedDrafts()).toEqual(['gvDraft_/u/1/gem/abc123/c9f0']);
      expect(localStore['gvDraft_/u/1/gem/abc123/c9f0']).toMatchObject({
        content: 'Draft in a Gem on the second account',
        path: '/u/1/gem/abc123/c9f0',
      });
      stop();
    });

    it('restores nothing when the page turns out to be Enterprise while the draft loads', async () => {
      setupMocks();
      onTestFinished(() => {
        document.body.className = '';
      });
      localStore[draftKey] = { content: 'Personal draft', timestamp: 1, path: '/app/x' };
      document.execCommand = vi.fn().mockReturnValue(true);
      const local = chrome.storage.local as unknown as { get: ReturnType<typeof vi.fn> };
      const immediateGet = local.get.getMockImplementation() as (
        key: unknown,
        callback: (r: unknown) => void,
      ) => void;
      let answer: () => void = () => {};
      local.get.mockImplementationOnce((key: unknown, callback: (r: unknown) => void) => {
        answer = () => immediateGet(key, callback);
      });
      const input = createContentEditable();
      const stop = await startDraftPlugin();

      document.body.classList.add('enterprise-shell');
      answer();
      await vi.advanceTimersByTimeAsync(5 * 500);

      expect(document.execCommand).not.toHaveBeenCalled();
      expect(input.textContent).toBe('');
      expect(localStore[draftKey]).toMatchObject({ content: 'Personal draft' });
      stop();
    });

    it('restores nothing when the page turns out to be Enterprise before a restore retry', async () => {
      setupMocks();
      onTestFinished(() => {
        document.body.className = '';
      });
      localStore[draftKey] = { content: 'Personal draft', timestamp: 1, path: '/app/x' };
      document.execCommand = vi.fn().mockReturnValue(true);
      const stop = await startDraftPlugin();
      await vi.advanceTimersByTimeAsync(0);

      // The composer renders only after Enterprise surfaced; the next retry finds it.
      document.body.classList.add('enterprise-shell');
      const input = createContentEditable();
      await vi.advanceTimersByTimeAsync(5 * 500);

      expect(document.execCommand).not.toHaveBeenCalled();
      expect(input.textContent).toBe('');
      stop();
    });

    it.each([
      ['URL', () => Object.assign(window.location, { search: '?workspace=1' })],
      ['DOM', () => document.body.classList.add('enterprise-shell')],
    ])(
      'writes no draft when the page turns out to be Gemini Enterprise by %s hint',
      async (_hint, turnEnterprise) => {
        setupMocks();
        onTestFinished(() => {
          document.body.className = '';
        });
        const destinationKey = 'gvDraft_/app/second-conversation';
        localStore[destinationKey] = { content: 'Destination', timestamp: 1, path: '/app/x' };
        document.execCommand = vi.fn().mockReturnValue(true);
        const input = createContentEditable();
        const stop = await startDraftPlugin();

        turnEnterprise();
        input.textContent = 'Typed on Enterprise';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(1000);
        window.location.pathname = '/app/second-conversation';
        input.textContent = '';
        await vi.advanceTimersByTimeAsync(3000);

        expect(storedDrafts()).toEqual([destinationKey]);
        expect(localStore[destinationKey]).toMatchObject({ content: 'Destination' });
        expect(document.execCommand).not.toHaveBeenCalled();
        stop();
      },
    );
  });
});
