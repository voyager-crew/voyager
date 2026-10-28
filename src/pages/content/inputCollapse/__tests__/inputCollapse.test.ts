import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for inputCollapse feature
 */
import { type LifecycleHarness, installLifecycleHarness } from '../../__tests__/lifecycleHarness';

const languageSubscribers = vi.hoisted(() => new Set<() => void>());

// Mock i18n
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: (callback: () => void) => {
    languageSubscribers.add(callback);
    return () => languageSubscribers.delete(callback);
  },
  getTranslationSync: (key: string) => {
    const translations: Record<string, string> = {
      inputCollapsePlaceholder: 'Message Gemini',
    };
    return translations[key] || key;
  },
}));

const COLLAPSED = 'gv-input-collapsed';
const STYLE_ID = 'gemini-voyager-input-collapse';

function blur(container: HTMLElement): void {
  const focusOutEvent = new Event('focusout', { bubbles: true });
  Object.defineProperty(focusOutEvent, 'relatedTarget', { value: null, writable: false });
  container.dispatchEvent(focusOutEvent);
}

let stops: Array<() => void> = [];

/** The actual collapse session shared by the plugin handler and public helpers. */
async function start(whenNotEmpty = false): Promise<() => void> {
  const { startCollapseSession } = await import('../runtime');
  const stop = startCollapseSession(whenNotEmpty);
  stops.push(stop);
  return stop;
}

describe('inputCollapse', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/app/abc123def456');
  });

  afterEach(() => {
    for (const stop of stops) stop();
    stops = [];
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  async function createMockContainer(
    content: string = '',
    extra: (container: HTMLElement, textarea: HTMLElement) => void = () => {},
  ): Promise<HTMLElement> {
    const container = document.createElement('div');
    // Don't pre-mark as processed - let MutationObserver handle it
    container.className = 'element-to-collapse';
    // Set a background color so getInputContainer will find it
    container.style.backgroundColor = '#f0f0f0';
    container.style.display = 'flex';

    const textarea = document.createElement('rich-textarea');
    textarea.textContent = content;
    container.appendChild(textarea);

    const placeholder = document.createElement('div');
    placeholder.className = 'gv-collapse-placeholder';
    container.appendChild(placeholder);
    extra(container, textarea);

    document.body.appendChild(container);

    // Wait for MutationObserver to process the new container
    // In fake timers mode, we need to advance time to trigger microtasks
    await vi.runAllTimersAsync();

    return container;
  }

  it('follows the page theme instead of the system theme for the collapsed pill', async () => {
    await start();
    const container = await createMockContainer();
    blur(container);
    await vi.advanceTimersByTimeAsync(300);
    document.documentElement.dataset.gvScheme = 'dark';
    expect(window.getComputedStyle(container).boxShadow).toBe('0 4px 12px rgba(0, 0, 0, 0.3)');
    document.documentElement.dataset.gvScheme = 'light';
    expect(window.getComputedStyle(container).boxShadow).toBe('0 2px 8px rgba(0, 0, 0, 0.08)');
    delete document.documentElement.dataset.gvScheme;
  });

  describe('Default behavior (collapse only when empty)', () => {
    beforeEach(async () => {
      await start();
    });

    it('collapses when input is empty and loses focus', async () => {
      const container = await createMockContainer('');

      blur(container);
      vi.advanceTimersByTime(200);

      expect(container.classList.contains(COLLAPSED)).toBe(true);
    });

    it('debounces input discovery across mutation bursts', async () => {
      const container = document.createElement('div');
      container.style.backgroundColor = '#f0f0f0';
      container.style.display = 'flex';
      container.appendChild(document.createElement('rich-textarea'));

      document.body.appendChild(container);
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(99);
      expect(container.querySelector('.gv-collapse-placeholder')).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(container.querySelector('.gv-collapse-placeholder')).not.toBeNull();
    });

    it('does not collapse when input has content and loses focus', async () => {
      const container = await createMockContainer('test content');

      blur(container);
      vi.advanceTimersByTime(200);

      expect(container.classList.contains(COLLAPSED)).toBe(false);
    });

    it('expands on click when collapsed', async () => {
      const container = await createMockContainer('');

      // First collapse it
      blur(container);
      vi.advanceTimersByTime(200);
      expect(container.classList.contains(COLLAPSED)).toBe(true);

      // Then click to expand
      container.dispatchEvent(new Event('click', { bubbles: true }));
      expect(container.classList.contains(COLLAPSED)).toBe(false);
    });

    it('never auto-collapses on the new chat page or the gems editor', async () => {
      const container = await createMockContainer('');

      for (const path of ['/app', '/u/1/app', '/gems/create', '/u/0/gems/edit/abc']) {
        window.history.replaceState(null, '', path);
        blur(container);
        vi.advanceTimersByTime(300);
        expect(container.classList.contains(COLLAPSED), path).toBe(false);
      }

      window.history.replaceState(null, '', '/u/1/app/abc123def456');
      blur(container);
      vi.advanceTimersByTime(300);
      expect(container.classList.contains(COLLAPSED)).toBe(true);
    });

    it('keeps an input with an attachment expanded unless collapse-when-not-empty is on', async () => {
      const container = await createMockContainer('', (root) => {
        root.appendChild(document.createElement('uploader-file-preview'));
      });

      blur(container);
      vi.advanceTimersByTime(300);
      expect(container.classList.contains(COLLAPSED)).toBe(false);

      const { setCollapseWhenNotEmpty } = await import('../runtime');
      setCollapseWhenNotEmpty(true);
      blur(container);
      vi.advanceTimersByTime(300);
      expect(container.classList.contains(COLLAPSED)).toBe(true);
    });
  });

  describe('Allow collapse when not empty (new feature)', () => {
    beforeEach(async () => {
      await start(true);
    });

    it('collapses when input is empty and loses focus', async () => {
      const container = await createMockContainer('');

      blur(container);
      vi.advanceTimersByTime(200);

      expect(container.classList.contains(COLLAPSED)).toBe(true);
    });

    it('collapses even when input has content and loses focus', async () => {
      const container = await createMockContainer('test content');

      blur(container);
      vi.advanceTimersByTime(200);

      expect(container.classList.contains(COLLAPSED)).toBe(true);
    });

    it('expands on click when collapsed with content', async () => {
      const container = await createMockContainer('test content');

      // Collapse it first
      blur(container);
      vi.advanceTimersByTime(200);
      expect(container.classList.contains(COLLAPSED)).toBe(true);

      // Verify content is preserved
      const textarea = container.querySelector('rich-textarea');
      expect(textarea?.textContent).toBe('test content');

      // Click to expand
      container.dispatchEvent(new Event('click', { bubbles: true }));
      expect(container.classList.contains(COLLAPSED)).toBe(false);
    });
  });

  describe('Lifecycle', () => {
    const startEnabled = (): Promise<() => void> => start();

    it('does not collapse after the feature stops while a collapse is queued', async () => {
      const stop = await startEnabled();
      const container = await createMockContainer('');

      blur(container);
      vi.advanceTimersByTime(100); // focusout delay done; the 150ms collapse is queued
      stop();
      vi.advanceTimersByTime(500);

      expect(container.classList.contains(COLLAPSED)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not steal focus after stop when an expand is pending', async () => {
      const stop = await startEnabled();
      let editor!: HTMLElement;
      const container = await createMockContainer('', (_root, textarea) => {
        editor = document.createElement('div');
        editor.className = 'ql-editor';
        textarea.appendChild(editor);
      });
      const focus = vi.fn();
      editor.focus = focus;

      blur(container);
      vi.advanceTimersByTime(300);
      container.dispatchEvent(new Event('click', { bubbles: true }));
      vi.advanceTimersByTime(1);
      expect(focus).toHaveBeenCalledTimes(1);

      blur(container);
      vi.advanceTimersByTime(300);
      expect(container.classList.contains(COLLAPSED)).toBe(true);
      container.dispatchEvent(new Event('click', { bubbles: true }));
      stop();
      vi.advanceTimersByTime(10);

      expect(focus).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves the new instance alone when an old stop runs late', async () => {
      const stopOld = await startEnabled();
      stopOld();
      await start();
      const container = await createMockContainer('');

      stopOld();
      blur(container);
      vi.advanceTimersByTime(300);
      expect(container.classList.contains(COLLAPSED)).toBe(true);
      expect(document.getElementById(STYLE_ID)).not.toBeNull();
    });

    it('lets a second start take over and ignores the retired stop', async () => {
      const stopOld = await startEnabled();
      await start();
      const container = await createMockContainer('');

      stopOld();
      blur(container);
      vi.advanceTimersByTime(300);
      expect(container.classList.contains(COLLAPSED)).toBe(true);
      // The retired session stopped following the language; only the new one listens.
      expect(languageSubscribers.size).toBe(1);
    });

    it("leaves other features' processed markers alone on stop", async () => {
      const stop = await startEnabled();
      const other = document.createElement('div');
      other.className = 'gv-processed';
      document.body.appendChild(other);
      const container = await createMockContainer('');
      expect(container.querySelector('.gv-collapse-placeholder')).not.toBeNull();

      stop();

      expect(other.classList.contains('gv-processed')).toBe(true);
      expect(container.className).toBe('');
      expect(container.querySelector('.gv-collapse-placeholder')).toBeNull();
    });

    it('keeps Esc for Vim when Vim mode is on and collapses only without it', async () => {
      await startEnabled();
      const container = await createMockContainer('', (_root, textarea) => {
        const input = document.createElement('textarea');
        input.id = 'question-input';
        input.getBoundingClientRect = () =>
          ({ width: 300, height: 40, top: 0, left: 0 }) as DOMRect;
        textarea.appendChild(input);
      });
      const input = container.querySelector<HTMLTextAreaElement>('#question-input')!;
      const pressEscape = (): void => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      };

      const { startInputVimMode } = await import('../../chatInput/vimMode');
      const stopVim = await startInputVimMode({
        forceEnabled: true,
        composerSelector: '#question-input',
      });
      input.focus();
      expect(document.activeElement).toBe(input);
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressEscape();
      expect(container.classList.contains(COLLAPSED)).toBe(false);

      stopVim();
      input.focus();
      pressEscape();
      expect(container.classList.contains(COLLAPSED)).toBe(true);
    });
  });

  describe('Lifecycle ledger', () => {
    let harness: LifecycleHarness;

    beforeEach(() => {
      harness = installLifecycleHarness();
    });

    afterEach(() => {
      for (const stop of stops) stop();
      stops = [];
      harness.restore();
    });

    it('keeps one collapse runtime when started twice without a stop', async () => {
      await start();
      const stopLatest = await start();
      expect(document.getElementById(STYLE_ID)).not.toBeNull();

      stopLatest();

      expect(document.getElementById(STYLE_ID)).toBeNull();
      expect(harness.ledger.openStorageListeners()).toBe(0);
      expect(harness.ledger.openListeners()).toEqual([]);
      expect(harness.ledger.openObservers()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
