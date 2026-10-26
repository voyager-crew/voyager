import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { applySidebarTitles } from '../gemini/nativeTitles';
import { bindNativeConversationRow, type NativeRowSelection } from '../nativeConversationDrag';
import { NativeDeleteTracker } from '../nativeDeleteTracker';
import { getNativeConversationElements } from '../nativeSidebarDom';
import type { ConversationReference } from '../types';
import { mountSidebar } from './sidebarRuntimeHarness';

vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));

const FIRST_ID = 'abcdef0123456789';
const SECOND_ID = 'fedcba9876543210';

function row(id: string, title: string, native = true): HTMLElement {
  const element = document.createElement('div');
  if (native) element.setAttribute('data-test-id', 'conversation');
  element.setAttribute('jslog', `["c_${id}"]`);
  element.innerHTML = `<a href="/app/${id}"><span class="title-text">${title}</span></a>`;
  return element;
}

function reference(id: string, title: string): ConversationReference {
  return {
    conversationId: `c_${id}`,
    title,
    url: `https://gemini.google.com/app/${id}`,
    addedAt: 1,
  };
}

describe('online sidebar matches retain packaged record identity', () => {
  let originalUrl: string;
  let stopSnapshot: (() => void) | undefined;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    originalUrl = window.location.href;
    window.history.replaceState({}, '', `/app/${SECOND_ID}`);
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    cleanups.splice(0).forEach((stop) => stop());
    stopSnapshot?.();
    stopSnapshot = undefined;
    document.body.replaceChildren();
    window.history.replaceState({}, '', originalUrl);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps a filed record while its native row remains outside a wrong online sidebar root', async () => {
    const { recentsSection } = mountSidebar();
    const nativeRow = row(FIRST_ID, 'A retained conversation');
    recentsSection.append(nativeRow);
    const wrongSidebar = document.createElement('div');
    wrongSidebar.className = 'online-wrong-sidebar';
    document.body.append(wrongSidebar);
    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.overflow': ['.online-wrong-sidebar'],
      'sidebar.row': ['.online-missing-row'],
    });
    let records = [reference(FIRST_ID, 'A retained conversation')];
    const tracker = new NativeDeleteTracker({
      getContext: () => ({
        sidebar: wrongSidebar,
        storageKey: 'gvFolderData',
        accountIsolationEnabled: false,
        isDestroyed: false,
      }),
      onConfirmedDelete: (id) => {
        records = records.filter((record) => record.conversationId !== `c_${id}`);
      },
    });
    cleanups.push(() => tracker.stop());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const confirm = document.createElement('button');
    confirm.dataset.testId = 'confirm-delete-button';
    dialog.append(confirm);
    document.body.append(dialog);
    tracker.rememberCandidate(FIRST_ID);
    tracker.handleDialogClick(confirm);
    await vi.advanceTimersByTimeAsync(600);

    expect(records).toEqual([reference(FIRST_ID, 'A retained conversation')]);
    nativeRow.remove();
    await vi.advanceTimersByTimeAsync(300);
    expect(records).toEqual([]);
  });

  it('updates the right filed title from native evidence and preserves custom titles and folder membership', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const first = row(FIRST_ID, 'Actual first title');
    const second = row(SECOND_ID, 'Actual second title');
    second.className = 'online-wrong-row';
    first.insertAdjacentHTML(
      'beforeend',
      '<span class="online-wrong-title">Unrelated label</span>',
    );
    recentsSection.append(first, second);
    const folderContents = {
      thesis: [reference(FIRST_ID, 'Old first title')],
      personal: [{ ...reference(SECOND_ID, 'My own title'), customTitle: true }],
    };
    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.row': ['.online-wrong-row'],
      'sidebar.title': ['.online-wrong-title'],
    });

    expect(applySidebarTitles(folderContents, sidebar, 42)).toBe(true);
    expect(folderContents.thesis[0]).toEqual({
      ...reference(FIRST_ID, 'Actual first title'),
      updatedAt: 42,
    });
    expect(folderContents.personal).toEqual([
      { ...reference(SECOND_ID, 'My own title'), customTitle: true },
    ]);
  });

  it('drags the native conversation and its packaged title instead of a valid-looking online decoy', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const nativeRow = row(FIRST_ID, 'Real chat');
    const decoy = row(SECOND_ID, 'Different chat', false);
    decoy.className = 'online-decoy';
    recentsSection.append(decoy, nativeRow);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-decoy'] });
    const selected = new Set<string>();
    const selection: NativeRowSelection = {
      longPressMs: 600,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (timer) => window.clearTimeout(timer),
      isBatchDeleting: () => false,
      isMultiSelectMode: () => false,
      isSelected: (id) => selected.has(id),
      selectedIds: () => [...selected],
      enterMultiSelect: () => {},
      toggle: () => {},
      selectOnly: (id) => {
        selected.clear();
        selected.add(id);
      },
      refresh: () => {},
      endDrag: () => {},
      accountIsolationEnabled: () => false,
      findConversationElement: () => nativeRow,
      setDragImage: () => {},
    };
    for (const observed of getNativeConversationElements(sidebar)) {
      const release = bindNativeConversationRow(observed, () => selection);
      if (release) cleanups.push(release);
    }
    const setData = vi.fn();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { setData, effectAllowed: 'all' } });
    nativeRow.dispatchEvent(event);

    expect(nativeRow.draggable).toBe(true);
    expect(JSON.parse(setData.mock.calls[0][1])).toMatchObject({
      conversationId: `c_${FIRST_ID}`,
      title: 'Real chat',
      url: `${window.location.origin}/app/${FIRST_ID}`,
    });
    expect(decoy.draggable).toBe(false);
  });
});
