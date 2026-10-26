import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { NativeConversationMenus } from '../../folder/NativeConversationMenus';
import { watchConversationMenusForExport } from '../conversationMenuExportObserver';
import { injectConversationMenuExportButton } from '../conversationMenuInjection';
import { alignToConversationCenter } from '../exportOverlayUi';
import { collectMenuPanels, getMenuPanels, usesOnlineMenuPanel } from '../menuTargets';

vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function startNativeMenus() {
  const menus = new NativeConversationMenus({
    getContext: () => ({
      sidebar: null,
      storageKey: 'gvFolderData',
      accountIsolationEnabled: false,
      isDestroyed: false,
    }),
    onMoveToFolder: vi.fn(),
    onConfirmedDelete: vi.fn(),
  });
  cleanups.push(() => menus.stop());
  menus.startTracking();
  menus.observePanels();
  return menus;
}

function appendMenu(renamed = false) {
  const trigger = document.createElement('button');
  trigger.dataset.testId = 'actions-menu-button';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', 'test-menu');
  const panel = document.createElement('div');
  panel.id = 'test-menu';
  panel.setAttribute('role', 'menu');
  panel.className = renamed ? 'new-panel' : 'mat-mdc-menu-panel';
  panel.innerHTML = `<div class="${renamed ? 'new-content' : 'mat-mdc-menu-content'}">
    <button class="mat-mdc-menu-item" data-test-id="pin-button"><mat-icon fonticon="keep"></mat-icon><span class="mat-mdc-menu-item-text">Pin</span></button>
  </div>`;
  document.body.append(trigger, panel);
  return { trigger, panel };
}

it.each([false, true])(
  'streamed text does not rescan every menu after an online profile is rejected: %s',
  async (rejected) => {
    vi.useFakeTimers();
    cleanups.push(
      await installGeminiSelectorPatch({
        'menu.panels': rejected ? ['.missing'] : ['.new-panel'],
        'menu.content': ['.new-content'],
      }),
    );
    // Exercise rejection once, before the chat begins streaming.
    expect(getMenuPanels()).toEqual([]);
    startNativeMenus();
    cleanups.push(watchConversationMenusForExport({ label: () => 'Export', onExport: vi.fn() }));
    const queries = vi.spyOn(document, 'querySelectorAll');
    for (let index = 0; index < 100; index++) {
      const text = document.createElement('span');
      text.textContent = `token ${index}`;
      document.body.append(text);
    }
    await Promise.resolve();
    expect(queries.mock.calls.length).toBe(0);
    queries.mockRestore();

    const { panel } = appendMenu(!rejected);
    await vi.advanceTimersByTimeAsync(40);
    expect(panel.querySelector('.gv-export-conversation-menu-btn')?.textContent).toContain(
      'Export',
    );
    expect(panel.querySelector('.gv-move-to-folder-btn')).not.toBeNull();
  },
);

it('discovers repaired and fallback menus when a candidate is added inside or around a panel', async () => {
  const { panel } = appendMenu(true);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const wrapper = document.createElement('section');
  panel.replaceWith(wrapper);
  wrapper.append(panel);
  expect(collectMenuPanels(wrapper)).toEqual(new Set([panel]));
  expect(collectMenuPanels(panel.firstElementChild as HTMLElement)).toEqual(new Set([panel]));
  expect(collectMenuPanels(panel)).toEqual(new Set([panel]));
});

it('bundled export injection does not run online menu collection scans while fixes are off', () => {
  const { panel } = appendMenu();
  const queries = vi.spyOn(document, 'querySelectorAll');
  expect(usesOnlineMenuPanel(panel)).toBe(false);
  const onClick = vi.fn();
  const button = injectConversationMenuExportButton(panel, {
    label: 'Export',
    tooltip: 'Export',
    onClick,
  });
  expect(button?.textContent).toContain('Export');
  expect(queries.mock.calls.length).toBe(0);
  button!.click();
  expect(onClick).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'removing unrelated content does not enumerate online panels with fixes enabled: %s',
  async (online) => {
    vi.useFakeTimers();
    if (online) cleanups.push(await installGeminiSelectorPatch({ 'menu.panels': ['.new-panel'] }));
    const text = document.createElement('p');
    text.innerHTML = '<span>streamed answer</span>';
    if (!online) {
      const retainedButton = document.createElement('button');
      retainedButton.className = 'gv-move-to-folder-btn';
      text.append(retainedButton);
    }
    document.body.append(text);
    startNativeMenus();
    const queries = vi.spyOn(text, 'querySelectorAll');
    text.remove();
    await Promise.resolve();
    expect(queries.mock.calls.length).toBe(0);

    const { panel, trigger } = appendMenu();
    await vi.advanceTimersByTimeAsync(40);
    expect(panel.querySelector('.gv-move-to-folder-btn')).not.toBeNull();
    trigger.focus();
    panel.remove();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(document.body);
  },
);

it('bundled export alignment scans its canvas once while fixes are off', () => {
  document.body.innerHTML = '<div id="chat-history"></div>';
  const canvas = document.getElementById('chat-history')!;
  canvas.getBoundingClientRect = () => ({
    left: 300,
    right: 900,
    width: 600,
    height: 600,
    top: 0,
    bottom: 600,
    x: 300,
    y: 0,
    toJSON: () => ({}),
  });
  const bar = document.createElement('div');
  document.body.append(bar);
  const queries = vi.spyOn(document, 'querySelectorAll');
  cleanups.push(
    alignToConversationCenter(bar, {
      conversationRoot: () => document.body,
      topUserElement: () => null,
    }),
  );
  expect(bar.style.left).toBe('600px');
  expect(queries).toHaveBeenCalledOnce();
});
