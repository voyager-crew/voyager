import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { confirmDriver } from '@/tests/confirmDriver';
import { toastDriver } from '@/tests/toastDriver';

import { ExportFormat } from '../../../../features/export/types/export';
import { nativeHealthReporter } from '../../nativeHealth';
import { makeTurns, mountThreadFixture } from '../adapter/__tests__/chatgptThreadFixture';
import { buildChatGptAdapter } from '../adapter/platform/chatgpt';
import type { ChatTurn, ConversationCollector, ExportMessage } from '../conversationCollector';
import type { ExportDictionaries } from '../exportLocale';
import type { ExportSite, ExportTurnReader, ExportTurnSession } from '../exportSite';
import { PENDING_EXPORT_SESSION_KEY, createPendingExportState } from '../pendingExportState';
import { createChatGptExportSite } from '../sites/chatgpt';

const mocks = vi.hoisted(() => ({
  exportPendingConversation: vi.fn(),
}));

vi.mock('../generatedUiScreenshots', () => ({
  captureGeneratedUiScreenshots: vi.fn(async () => {}),
  ensureGeneratedUiScreenshotPermission: vi.fn(async () => {}),
  removeGeneratedUiScreenshotSections: vi.fn(),
}));
vi.mock('../pendingExportState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pendingExportState')>()),
  exportPendingConversation: mocks.exportPendingConversation,
}));

const { createExportRunner } = await import('../exportRun');
const screenshots = await import('../generatedUiScreenshots');

const dict = {
  en: {
    pm_export: 'Export now',
    export_toast_images_omitted: '{count} images stayed as links',
    export_error_generic: 'Export failed: {error}',
    export_dialog_warning: 'Nothing to export yet',
    export_read_history_unavailable: 'Could not read the full history; scroll up and retry',
    export_md_include_source_confirm: 'Keep search image links?',
    export_md_include_source_include: 'Include links',
    export_md_include_source_exclude: 'Leave out',
    pm_cancel: 'Cancel',
  },
} as unknown as ExportDictionaries;

/** Advance fake time until `condition` holds (runs stay in fake time end to end). */
async function until(condition: () => boolean): Promise<void> {
  for (let elapsed = 0; elapsed < 5000 && !condition(); elapsed += 50) {
    await vi.advanceTimersByTimeAsync(50);
  }
  expect(condition()).toBe(true);
}

async function settle(running: Promise<void>): Promise<void> {
  let done = false;
  void running.then(() => {
    done = true;
  });
  await until(() => done);
}

/** A host without lazy history whose messages and turns come from `page`. */
function fakeSite(page: ConversationCollector): ExportSite {
  return {
    id: 'test',
    label: 'Test Chat',
    entryPoints: { kind: 'toolbar' },
    title: () => 'A conversation',
    page,
    turns: { scrollsWhileBuilding: false, ...pageReader(page) },
  };
}

function pageReader(page: ConversationCollector): ExportTurnReader {
  return {
    messages: () => page.collectSelectionMessages(),
    build: async (ids) => page.turnsForMessageIds(ids),
  };
}

function preparedSession(page: ConversationCollector, release: () => void): ExportTurnSession {
  return { ...pageReader(page), release };
}

function fakeCollector(messages: ExportMessage[]): ConversationCollector {
  return {
    collectChatPairs: () => [],
    collectSelectionMessages: () => messages,
    turnsForMessageIds: (ids) =>
      Array.from(ids).map(
        (id) => ({ user: `turn ${id}`, assistant: '', starred: false }) as ChatTurn,
      ),
    assistantMessageIdFor: () => null,
    topUserElement: () => null,
    conversationRoot: () => document.body,
    snapshotOpenCanvasDocs: vi.fn(),
    releaseCanvasDocs: vi.fn(),
  };
}

function renderMessages(): ExportMessage[] {
  return ['1:u', '1:a'].map((messageId) => {
    const hostElement = document.createElement('div');
    document.body.appendChild(hostElement);
    return {
      messageId,
      role: messageId.endsWith(':u') ? 'user' : 'assistant',
      hostElement,
      text: messageId,
      starred: false,
    } as ExportMessage;
  });
}

function selectionBar(): HTMLElement | null {
  return document.querySelector('[data-gv-export-select-bar="true"]');
}

function clickBarAction(action: string): void {
  document.querySelector<HTMLButtonElement>(`[data-gv-export-action="${action}"]`)!.click();
}

describe('createExportRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('exports the selected messages and reports what the finished file left out', async () => {
    const found = vi.spyOn(nativeHealthReporter, 'reportFound');
    const result = { success: true, omittedImageCount: 2 };
    mocks.exportPendingConversation.mockResolvedValue(result);
    const release = vi.fn();
    const collector = fakeCollector(renderMessages());
    const prepareConversation = vi.fn(async () => preparedSession(collector, release));
    const site = fakeSite(collector);
    const runner = createExportRunner({
      site: { ...site, turns: { ...site.turns, prepare: prepareConversation } },
    });
    const prepare = vi.fn(async () => {});

    const running = runner.run(
      { format: ExportFormat.PDF, fontSize: 14 },
      { dict, lang: 'en' },
      prepare,
    );
    await until(() => selectionBar() !== null);
    // A whole-thread read starts with everything selected.
    await until(
      () =>
        document.querySelector<HTMLElement>('[data-gv-export-action="selectAll"]')?.dataset
          .checked === 'true',
    );
    clickBarAction('export');
    await settle(running);

    expect(prepare).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(prepareConversation).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      expectedUrl: location.href,
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(found).toHaveBeenCalledWith('export');
    const [state, turns, metadata, includeImageSource] =
      mocks.exportPendingConversation.mock.calls[0];
    expect(state).toMatchObject({ format: ExportFormat.PDF, fontSize: 14 });
    expect(turns.map((turn: ChatTurn) => turn.user)).toEqual(['turn 1:u', 'turn 1:a']);
    expect(metadata).toMatchObject({ title: 'A conversation', platform: 'Test Chat', count: 2 });
    expect(includeImageSource).toBe(true);

    expect(toastDriver.all()).toMatchObject([
      { message: '2 images stayed as links', tone: 'warning' },
    ]);
    expect(selectionBar()).toBeNull();
  });

  it('a failing build reports the error without writing a file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const site = fakeSite(fakeCollector(renderMessages()));
    const runner = createExportRunner({
      site: {
        ...site,
        turns: {
          ...site.turns,
          build: async () => {
            throw new Error('Build unavailable');
          },
        },
      },
    });
    const running = runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' });
    await until(() => selectionBar() !== null);
    expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
    clickBarAction('selectAll');
    clickBarAction('export');
    await settle(running);
    expect(selectionBar()).toBeNull();
    expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
    expect(toastDriver.all()).toMatchObject([
      { message: 'Export failed: Build unavailable', tone: 'error' },
    ]);
  });

  it('shows the export error instead of reporting success', async () => {
    mocks.exportPendingConversation.mockResolvedValue({
      success: false,
      error: 'boom',
      omittedImageCount: 2,
    });
    const runner = createExportRunner({ site: fakeSite(fakeCollector(renderMessages())) });

    const running = runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' });
    await until(() => selectionBar() !== null);
    clickBarAction('selectAll');
    clickBarAction('export');
    await settle(running);

    expect(toastDriver.all()).toMatchObject([
      { message: 'Export failed: boom', tone: 'error', role: 'alert' },
    ]);
  });

  it('warns and reports missing turns with a fresh health recheck', async () => {
    const missing = vi.spyOn(nativeHealthReporter, 'reportMissing');
    const found = vi.spyOn(nativeHealthReporter, 'reportFound');
    const collector = fakeCollector([]);
    const runner = createExportRunner({ site: fakeSite(collector) });

    await settle(runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' }));

    expect(toastDriver.all()).toMatchObject([
      { message: 'Nothing to export yet', tone: 'warning' },
    ]);
    expect(found).not.toHaveBeenCalled();
    expect(missing).toHaveBeenCalledWith(
      'export',
      expect.objectContaining({ route: 'conversation' }),
    );
    const probe = missing.mock.calls[0][1];
    expect(probe.recheck()).toBe(false);
    collector.collectChatPairs = () => [
      { user: 'Loaded later', assistant: '', starred: false, turnId: '1' },
    ];
    expect(probe.recheck()).toBe(true);
    expect(selectionBar()).toBeNull();
    expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
  });

  it('tells the reader the history could not be read instead of asking them to wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Older history never arrives, so the crawl gives up on the whole thread (issue #1071).
    mountThreadFixture({ turns: makeTurns(8), initiallyLoaded: 3, historyDelayMs: Infinity });
    const chatgpt = createChatGptExportSite(buildChatGptAdapter(chatgptAdapter));
    // Polls run jsdom's slow getComputedStyle; 1 ms ones timed this out under load.
    const fastCrawl = { pollMs: 10, settleMs: 4, historyIdleMs: 25, historyStallMs: 150 };
    const runner = createExportRunner({
      site: {
        ...chatgpt,
        turns: {
          ...chatgpt.turns,
          // The site passes crawl options through; its type names only the shared ones.
          prepare: (options) => {
            const crawl = { ...options, timing: fastCrawl };
            return chatgpt.turns.prepare!(crawl);
          },
        },
      },
    });

    await settle(runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' }));

    expect(toastDriver.all()).toMatchObject([
      { message: 'Could not read the full history; scroll up and retry', tone: 'warning' },
    ]);
    expect(selectionBar()).toBeNull();
    expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
  });

  describe('a Markdown export with web search images', () => {
    function collectorWithSearchImages(): ConversationCollector {
      const collector = fakeCollector(renderMessages());
      collector.turnsForMessageIds = (ids) =>
        Array.from(ids).map((id) => {
          const assistantElement = document.createElement('div');
          assistantElement.innerHTML = '<div class="attachment-container search-images"></div>';
          return { user: `turn ${id}`, assistant: '', starred: false, assistantElement };
        });
      return collector;
    }

    async function exportAll(): Promise<{ running: Promise<void> }> {
      mocks.exportPendingConversation.mockResolvedValue({ success: true });
      const runner = createExportRunner({ site: fakeSite(collectorWithSearchImages()) });
      const running = runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' });
      await until(() => selectionBar() !== null);
      clickBarAction('selectAll');
      clickBarAction('export');
      await until(() => confirmDriver.isOpen());
      // Wrapped: an async function would otherwise wait for the run it returns.
      return { running };
    }

    it('asks whether to keep the image links and exports without them on Leave out', async () => {
      const { running } = await exportAll();

      expect(confirmDriver.message()).toBe('Keep search image links?');
      expect(confirmDriver.labels()).toEqual(['Cancel', 'Leave out', 'Include links']);
      expect(confirmDriver.focusedLabel()).toBe('Include links');
      confirmDriver.answer('Leave out');
      await settle(running);

      expect(mocks.exportPendingConversation).toHaveBeenCalledTimes(1);
      expect(mocks.exportPendingConversation.mock.calls[0][3]).toBe(false);
    });

    it('drops the export when the question is dismissed', async () => {
      const { running } = await exportAll();

      confirmDriver.pressEscape();
      await settle(running);

      expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
      expect(toastDriver.all()).toEqual([]);
    });

    it.each([
      ['Escape', () => confirmDriver.pressEscape()],
      ['Cancel', () => confirmDriver.answer('Cancel')],
    ])('gives focus back to the composer after %s drops the export', async (_, dismiss) => {
      const collector = collectorWithSearchImages();
      const site = fakeSite(collector);
      type Turns = ReturnType<ConversationCollector['turnsForMessageIds']>;
      let finishBuild: (turns: Turns) => void = () => {};
      const build = () =>
        new Promise<Turns>((resolve) => {
          finishBuild = resolve;
        });
      const runner = createExportRunner({ site: { ...site, turns: { ...site.turns, build } } });
      const running = runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' });
      await until(() => selectionBar() !== null);
      clickBarAction('selectAll');
      clickBarAction('export');
      await until(() => selectionBar() === null);
      const composer = document.createElement('textarea');
      composer.value = 'unfinished draft';
      document.body.append(composer);
      composer.focus();

      finishBuild(collector.turnsForMessageIds(new Set(['1:u', '1:a'])));
      await until(() => confirmDriver.isOpen());
      dismiss();
      await settle(running);

      expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
      expect(composer.value).toBe('unfinished draft');
      expect(document.activeElement).toBe(composer);
    });

    it('drops the answer when the conversation changed while it was open', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { running } = await exportAll();
      const before = location.href;

      history.pushState({}, '', '/another-conversation');
      confirmDriver.answer('Include links');
      await settle(running);
      history.pushState({}, '', before);

      expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
      expect(toastDriver.all()).toMatchObject([{ tone: 'error' }]);
    });
  });

  it('second Export click during the permission wait does not start a second export', async () => {
    mocks.exportPendingConversation.mockResolvedValue({ success: true });
    let grant: () => void = () => {};
    vi.mocked(screenshots.ensureGeneratedUiScreenshotPermission).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          grant = resolve;
        }),
    );
    const runner = createExportRunner({ site: fakeSite(fakeCollector(renderMessages())) });

    const running = runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' });
    await until(() => selectionBar() !== null);
    clickBarAction('selectAll');
    clickBarAction('export');
    await vi.advanceTimersByTimeAsync(50);
    clickBarAction('export');
    await vi.advanceTimersByTimeAsync(50);
    expect(selectionBar()).not.toBeNull();
    expect(screenshots.removeGeneratedUiScreenshotSections).not.toHaveBeenCalled();

    grant();
    await settle(running);

    expect(mocks.exportPendingConversation).toHaveBeenCalledTimes(1);
    expect(mocks.exportPendingConversation.mock.calls[0][1]).toHaveLength(2);
    expect(toastDriver.all().filter((toast) => toast.tone === 'error')).toEqual([]);
  });

  it('cancel dismisses the selection and ends the run without exporting', async () => {
    const runner = createExportRunner({ site: fakeSite(fakeCollector(renderMessages())) });

    const running = runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' });
    await until(() => selectionBar() !== null);
    runner.cancel();
    await settle(running);

    expect(selectionBar()).toBeNull();
    expect(document.querySelector('.gv-export-msg-selector')).toBeNull();
    expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
  });

  it('waits for the source preparation and keeps its resources until selection is cancelled', async () => {
    const collector = fakeCollector([]);
    const release = vi.fn();
    let completePreparation: () => void = () => {};
    const site = fakeSite(collector);
    const prepare = () =>
      new Promise<ExportTurnSession>((resolve) => {
        completePreparation = () => {
          collector.collectSelectionMessages = () => renderMessages();
          resolve(preparedSession(collector, release));
        };
      });
    const runner = createExportRunner({ site: { ...site, turns: { ...site.turns, prepare } } });

    const running = runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(selectionBar()).toBeNull();
    completePreparation();
    await until(() => selectionBar() !== null);
    expect(release).not.toHaveBeenCalled();

    runner.cancel();
    await settle(running);
    expect(release).toHaveBeenCalledTimes(1);
    expect(selectionBar()).toBeNull();
    expect(mocks.exportPendingConversation).not.toHaveBeenCalled();
  });

  it('a new run replaces the selection of the previous one', async () => {
    mocks.exportPendingConversation.mockResolvedValue({ success: true });
    const runner = createExportRunner({ site: fakeSite(fakeCollector(renderMessages())) });

    const first = runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' });
    await until(() => selectionBar() !== null);
    const second = runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' });
    await settle(first);
    await until(() => selectionBar() !== null);
    expect(document.querySelectorAll('[data-gv-export-select-bar="true"]')).toHaveLength(1);

    clickBarAction('selectAll');
    clickBarAction('export');
    await settle(second);

    expect(mocks.exportPendingConversation).toHaveBeenCalledTimes(1);
    expect(mocks.exportPendingConversation.mock.calls[0][0]).toMatchObject({
      format: ExportFormat.MARKDOWN,
    });
  });

  it('offers the loaded turns of a very long conversation instead of stopping the export', async () => {
    const runner = createExportRunner({
      site: {
        ...fakeSite(fakeCollector(renderMessages())),
        history: { userSelectors: () => ['.u'], assistantSelectors: () => ['.a'] },
      },
    });
    sessionStorage.setItem(
      PENDING_EXPORT_SESSION_KEY,
      JSON.stringify({
        ...createPendingExportState(ExportFormat.JSON, location.href, Date.now()),
        attempt: 400,
      }),
    );

    const resuming = runner.resumePending();
    await until(() => selectionBar() !== null);

    expect(toastDriver.all()).toMatchObject([
      { message: expect.stringContaining('only its most recent part'), tone: 'warning' },
    ]);
    runner.cancel();
    await settle(resuming);
  });

  it('stays silent when preparation is cancelled', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = createExportRunner({ site: fakeSite(fakeCollector(renderMessages())) });

    await settle(
      runner.run({ format: ExportFormat.JSON }, { dict, lang: 'en' }, async () => {
        throw new DOMException('Export cancelled', 'AbortError');
      }),
    );

    expect(errorSpy).not.toHaveBeenCalled();
    expect(selectionBar()).toBeNull();
  });
});
