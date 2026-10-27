import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { extractNativeConversationId } from '../nativeConversationIds';
import { collectAllSidebarConversations, getNativeConversationElements } from '../nativeSidebarDom';
import { findSidebarMount } from '../sidebarMountDom';
import { createSidebarRuntimeHarness, mountSidebar } from './sidebarRuntimeHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));

function row(id: string, title: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'online-row';
  element.setAttribute('data-test-id', 'conversation');
  element.setAttribute('jslog', `["c_${id}"]`);
  element.innerHTML = `<a href="/app/${id}"><span class="title-text online-title">${title}</span></a>`;
  return element;
}

describe('Gemini sidebar online observations', () => {
  let stopSnapshot: (() => void) | undefined;
  let harness: ReturnType<typeof createSidebarRuntimeHarness> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    harness?.runtime.stop();
    harness = undefined;
    stopSnapshot?.();
    stopSnapshot = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the same nodes, row order, IDs and anchors through equivalent online names', async () => {
    const { sidebar, recentsSection, notebooksSection } = mountSidebar();
    sidebar.className = 'online-sidebar';
    recentsSection.className = 'online-recents online-section';
    notebooksSection.className = 'online-notebooks online-section';
    const rows = [row('abcdef0123456789', 'First'), row('fedcba9876543210', 'Second')];
    recentsSection.append(...rows);
    const context = () => ({ sidebar, accountIsolationEnabled: false, isDestroyed: false });
    const bundledRows = getNativeConversationElements(sidebar);
    const bundledRecords = await collectAllSidebarConversations(context);
    const bundledMount = findSidebarMount('above-notebooks');

    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.overflow': ['.online-sidebar'],
      'sidebar.notebooks': ['.online-notebooks'],
      'sidebar.recents': ['.online-recents'],
      'sidebar.section': ['.online-section'],
      'sidebar.row': ['.online-row'],
      'sidebar.title': ['.online-title'],
    });

    const onlineRows = getNativeConversationElements(sidebar);
    expect(onlineRows).toHaveLength(bundledRows.length);
    onlineRows.forEach((element, index) => expect(element).toBe(bundledRows[index]));
    expect(onlineRows.map(extractNativeConversationId)).toEqual(
      bundledRows.map(extractNativeConversationId),
    );
    expect(await collectAllSidebarConversations(context)).toEqual(bundledRecords);
    const onlineMount = findSidebarMount('above-notebooks');
    expect(onlineMount?.sidebar).toBe(bundledMount?.sidebar);
    expect(onlineMount?.anchor).toBe(bundledMount?.anchor);
  });

  it('rereads rows and titles together when a matching online row has no usable conversation ID', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const original = row('abcdef0123456789', 'Stored conversation');
    const stub = document.createElement('div');
    stub.className = 'online-stub';
    stub.innerHTML = '<span class="online-title">Still loading</span>';
    recentsSection.append(stub, original);
    const context = () => ({ sidebar, accountIsolationEnabled: false, isDestroyed: false });
    const bundled = await collectAllSidebarConversations(context);
    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.row': ['.online-stub'],
      'sidebar.title': ['.online-title'],
    });

    expect(await collectAllSidebarConversations(context)).toEqual(bundled);
    expect(getNativeConversationElements(sidebar)).toEqual([original]);
  });

  it('collects the real native record when an unrelated online row carries a parseable chat link', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const original = row('abcdef0123456789', 'Actual conversation');
    const decoy = row('fedcba9876543210', 'Unrelated conversation');
    decoy.removeAttribute('data-test-id');
    decoy.className = 'online-decoy';
    recentsSection.append(decoy, original);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-decoy'] });

    const records = await collectAllSidebarConversations(() => ({
      sidebar,
      accountIsolationEnabled: false,
      isDestroyed: false,
    }));

    expect(records).toEqual([
      {
        id: 'abcdef0123456789',
        title: 'Actual conversation',
        url: 'https://gemini.google.com/app/abcdef0123456789',
      },
    ]);
  });

  it('keeps the native title when an online label names a different control in the same row', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const original = row('abcdef0123456789', 'Actual conversation');
    original.insertAdjacentHTML('beforeend', '<button class="online-control">Delete</button>');
    recentsSection.append(original);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.title': ['.online-control'] });

    const records = await collectAllSidebarConversations(() => ({
      sidebar,
      accountIsolationEnabled: false,
      isDestroyed: false,
    }));

    expect(records).toEqual([
      {
        id: 'abcdef0123456789',
        title: 'Actual conversation',
        url: 'https://gemini.google.com/app/abcdef0123456789',
      },
    ]);
  });

  it('keeps populated records and real titles when an online conversation link matches a button', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const original = row('abcdef0123456789', 'Actual conversation');
    original.prepend(document.createElement('button'));
    recentsSection.append(original);
    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.conversationLinks': ['button'],
      'sidebar.title': ['.missing-title'],
      'sidebar.titleFallback': ['.missing-label'],
    });

    const records = await collectAllSidebarConversations(() => ({
      sidebar,
      accountIsolationEnabled: false,
      isDestroyed: false,
    }));

    expect(records).toEqual([
      {
        id: 'abcdef0123456789',
        title: 'Actual conversation',
        url: 'https://gemini.google.com/app/abcdef0123456789',
      },
    ]);
  });

  it('mounts the folder panel beside native Recents after the sidebar container changes its marker', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    sidebar.removeAttribute('data-test-id');
    sidebar.className = 'online-sidebar';
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.online-sidebar'] });
    harness = createSidebarRuntimeHarness();

    await harness.runtime.start('sidebar');

    expect(harness.runtime.sidebar).toBe(sidebar);
    expect(harness.runtime.panel?.parentElement).toBe(recentsSection.parentElement);
    expect(harness.runtime.panel?.nextElementSibling).toBe(recentsSection);
  });

  it('keeps mounting the folder panel in a sidebar drawer dialog with online fixes off', async () => {
    const { host, recentsSection } = mountSidebar();
    const drawer = document.createElement('div');
    drawer.setAttribute('role', 'dialog');
    document.body.append(drawer);
    drawer.append(host);
    harness = createSidebarRuntimeHarness();

    await harness.runtime.start('sidebar');

    expect(harness.runtime.panel?.nextElementSibling).toBe(recentsSection);
    expect(harness.floating.open).not.toHaveBeenCalled();
  });

  it('keeps mounting above the first chat link row with online fixes off', async () => {
    const { sidebar, sectionParent } = mountSidebar();
    sectionParent.replaceChildren();
    const link = document.createElement('a');
    link.className = 'conversation';
    link.setAttribute('data-test-id', 'conversation');
    link.href = '/app/abcdef0123456789';
    sidebar.append(link);
    harness = createSidebarRuntimeHarness();

    await harness.runtime.start('sidebar');

    expect(harness.runtime.panel?.nextElementSibling).toBe(link);
    expect(harness.floating.open).not.toHaveBeenCalled();
  });

  it('keeps the Notebooks mount and move button when the online Notebooks name has no match', async () => {
    const { notebooksSection } = mountSidebar();
    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.notebooks': ['.missing-notebooks'],
    });
    harness = createSidebarRuntimeHarness();
    harness.runtime.setAnchor('above-notebooks');

    await harness.runtime.start('sidebar');

    expect(harness.runtime.panel?.nextElementSibling).toBe(notebooksSection);
    expect(notebooksSection.querySelector('.gv-folders-anchor-toggle')?.parentElement).toBe(
      notebooksSection,
    );
  });

  it('keeps the bundled mount stable after an online root miss despite a matching decoy anchor', async () => {
    const { sidebar, recentsSection, sectionParent } = mountSidebar();
    const decoy = document.createElement('div');
    decoy.className = 'online-anchor';
    sectionParent.prepend(decoy);
    const wrongRoot = document.createElement('aside');
    wrongRoot.className = 'online-wrong-root';
    document.body.append(wrongRoot);
    stopSnapshot = await installGeminiSelectorPatch({
      'sidebar.overflow': ['.online-wrong-root'],
      'sidebar.recents': ['.online-anchor'],
    });
    harness = createSidebarRuntimeHarness();
    await harness.runtime.start('sidebar');
    const panel = harness.runtime.panel;
    expect(harness.runtime.sidebar).toBe(sidebar);
    expect(panel?.nextElementSibling).toBe(recentsSection);

    sectionParent.prepend(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(8000);

    expect(harness.runtime.panel).toBe(panel);
    expect(panel?.isConnected).toBe(true);
    expect(panel?.nextElementSibling).toBe(recentsSection);
    expect(sidebar.querySelectorAll('.gv-folder-container')).toHaveLength(1);
  });

  it('keeps every native row draggable and in sweeps when an online row name matches only some of them', async () => {
    const { sidebar, recentsSection } = mountSidebar();
    const matched = row('abcdef0123456789', 'Matched by the fix');
    const missed = row('fedcba9876543210', 'Missed by the fix');
    missed.className = '';
    recentsSection.append(matched, missed);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });
    harness = createSidebarRuntimeHarness();

    await harness.runtime.start('sidebar');
    await vi.advanceTimersByTimeAsync(600);

    expect(getNativeConversationElements(sidebar)).toEqual([matched, missed]);
    expect(missed.draggable).toBe(true);
    expect(matched.draggable).toBe(true);
    const records = await collectAllSidebarConversations(() => ({
      sidebar,
      accountIsolationEnabled: false,
      isDestroyed: false,
    }));
    expect(records.map((record) => record.id)).toEqual(['abcdef0123456789', 'fedcba9876543210']);
  });

  it('makes a newly added native row draggable when an online row name matches its nested title', async () => {
    const { recentsSection } = mountSidebar();
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-title'] });
    harness = createSidebarRuntimeHarness();
    await harness.runtime.start('sidebar');
    const added = row('abcdef0123456789', 'A newly rendered chat');
    recentsSection.append(added);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(600);

    expect(added.draggable).toBe(true);
    expect(added.querySelector<HTMLElement>('.online-title')?.draggable).toBe(false);
    expect(extractNativeConversationId(added)).toBe('abcdef0123456789');
  });
});
