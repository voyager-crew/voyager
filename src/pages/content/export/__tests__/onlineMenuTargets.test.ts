import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { watchConversationMenusForExport } from '../conversationMenuExportObserver';
import {
  getConversationMenuContext,
  injectConversationMenuExportButton,
  injectConversationMenuMoveToFolderButton,
} from '../conversationMenuInjection';
import { getMenuPanels } from '../menuTargets';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mount(renamed = false) {
  document.body.innerHTML = `
    <button data-test-id="actions-menu-button" aria-haspopup="menu" aria-expanded="true" aria-controls="conversation-menu"></button>
    <div id="conversation-menu" role="menu" class="${renamed ? 'new-panel' : 'mat-mdc-menu-panel'} alias-panel">
      <div class="${renamed ? 'new-content' : 'mat-mdc-menu-content'} alias-content">
        <button class="mat-mdc-menu-item" role="menuitem" data-test-id="pin-button"><mat-icon fonticon="keep"></mat-icon><span class="mat-mdc-menu-item-text">Pin</span></button>
        <button class="mat-mdc-menu-item" role="menuitem" data-test-id="rename-button"><mat-icon fonticon="edit"></mat-icon><span class="mat-mdc-menu-item-text">Rename</span></button>
      </div>
    </div>`;
  return {
    panel: document.querySelector<HTMLElement>('#conversation-menu')!,
    trigger: document.querySelector<HTMLElement>('[aria-haspopup]')!,
    content: document.querySelector<HTMLElement>('.alias-content')!,
  };
}

function inject(panel: HTMLElement, onClick: () => void = vi.fn()) {
  return injectConversationMenuExportButton(panel, { label: 'Export', tooltip: 'Export', onClick });
}

it('keeps one export and folder button in the same position for bundled and online reads', async () => {
  const { panel, trigger, content } = mount();
  const off = inject(panel)!;
  const offPosition = Array.from(content.children).indexOf(off);
  off.remove();
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.alias-panel'],
      'menu.content': ['.alias-content'],
    }),
  );
  const online = inject(panel)!;
  const folder = injectConversationMenuMoveToFolderButton(panel, {
    label: 'Move',
    tooltip: 'Move',
    onClick: vi.fn(),
  })!;
  expect(getConversationMenuContext(panel)).toEqual({ menuType: 'top', trigger });
  expect(Array.from(content.children).indexOf(online)).toBe(offPosition);
  expect(online.nextElementSibling).toBe(folder);
  expect(inject(panel)).toBe(online);
  expect(content.querySelectorAll('.gv-export-conversation-menu-btn')).toHaveLength(1);
});

it('repairs renamed menu panel and content while retaining the original trigger', async () => {
  const { panel, trigger, content } = mount(true);
  expect(inject(panel)).toBeNull();
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const click = vi.fn();
  const item = inject(panel, click)!;
  expect(item.previousElementSibling).toBe(content.querySelector('[data-test-id="pin-button"]'));
  expect(getConversationMenuContext(panel)?.trigger).toBe(trigger);
  item.click();
  expect(click).toHaveBeenCalledOnce();
});

it('falls back to the complete menu list when an online profile omits a panel', async () => {
  const { panel } = mount();
  const settings = document.createElement('div');
  settings.className = 'mat-mdc-menu-panel';
  settings.setAttribute('role', 'menu');
  document.body.append(settings);
  cleanups.push(await installGeminiSelectorPatch({ 'menu.panels': ['.alias-panel'] }));
  expect(getMenuPanels()).toEqual([panel, settings]);
  expect(inject(panel)?.parentElement).toBe(panel.firstElementChild);
});

it('uses the full native insertion parent after an online locator selects one nested action', async () => {
  const { panel, content } = mount();
  const fragment = document.createElement('div');
  fragment.className = 'partial';
  fragment.append(content.firstElementChild!);
  content.prepend(fragment);
  cleanups.push(await installGeminiSelectorPatch({ 'menu.content': ['.partial'] }));
  const item = inject(panel)!;
  expect(item.parentElement).toBe(content);
  expect(item.nextElementSibling).toBe(fragment);
  expect(content.querySelector('[data-test-id="rename-button"]')?.parentElement).toBe(content);
});

it('ignores a settings trigger until the repaired panel belongs to its conversation trigger', async () => {
  const { panel, trigger } = mount(true);
  trigger.setAttribute('data-test-id', 'settings-button');
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  expect(inject(panel)).toBeNull();
  trigger.setAttribute('data-test-id', 'actions-menu-button');
  expect(inject(panel)).not.toBeNull();
});

describe('online menu cancellation', () => {
  it.each(['outside', 'Escape', 'account', 'replacement', 'profile'] as const)(
    'does not export from a retained menu item after %s invalidates its origin',
    async (reason) => {
      const { panel, trigger } = mount(true);
      cleanups.push(
        await installGeminiSelectorPatch({
          'menu.panels': ['.new-panel'],
          'menu.content': ['.new-content'],
        }),
      );
      const onClick = vi.fn();
      const item = inject(panel, onClick)!;
      expect(item.textContent).toContain('Export');
      if (reason === 'outside')
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (reason === 'Escape')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (reason === 'account') {
        const path = window.location.href;
        window.history.replaceState({}, '', '/u/1/app/another');
        cleanups.push(() => window.history.replaceState({}, '', path));
      }
      if (reason === 'replacement') {
        const other = trigger.cloneNode(true) as HTMLElement;
        trigger.replaceWith(other);
      }
      if (reason === 'profile') {
        const profile = document.createElement('button');
        profile.setAttribute('aria-haspopup', 'menu');
        profile.setAttribute('aria-expanded', 'true');
        document.body.append(profile);
      }
      item.click();
      expect(onClick).not.toHaveBeenCalled();
      expect(panel.isConnected).toBe(true);
      expect(panel.querySelector('[data-test-id="pin-button"]')?.textContent).toBe('Pin');
    },
  );

  it('cancels a pending injection on outside click and still injects after a fresh open', async () => {
    vi.useFakeTimers();
    const { panel, trigger } = mount(true);
    cleanups.push(
      await installGeminiSelectorPatch({
        'menu.panels': ['.new-panel'],
        'menu.content': ['.new-content'],
      }),
    );
    cleanups.push(watchConversationMenusForExport({ label: () => 'Export', onExport: vi.fn() }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(panel.querySelector('.gv-export-conversation-menu-btn')).toBeNull();
    trigger.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(panel.querySelector('.gv-export-conversation-menu-btn')?.textContent).toContain(
      'Export',
    );
  });
});

it('falls back when an online panel list adds an unrelated native menu', async () => {
  const { panel } = mount();
  const settings = document.createElement('div');
  settings.className = 'alias-panel';
  settings.setAttribute('role', 'menu');
  document.body.append(settings);
  cleanups.push(await installGeminiSelectorPatch({ 'menu.panels': ['.alias-panel'] }));
  expect(getMenuPanels()).toEqual([panel]);
  expect(inject(panel)?.parentElement).toBe(panel.firstElementChild);
});

it('retires a detached item at watcher stop and binds one new item after restart', async () => {
  vi.useFakeTimers();
  const { panel } = mount(true);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const oldExport = vi.fn();
  const stop = watchConversationMenusForExport({ label: () => 'Export', onExport: oldExport });
  await vi.advanceTimersByTimeAsync(40);
  const old = panel.querySelector<HTMLElement>('.gv-export-conversation-menu-btn')!;
  stop();
  old.click();
  expect(oldExport).not.toHaveBeenCalled();
  const onExport = vi.fn();
  cleanups.push(watchConversationMenusForExport({ label: () => 'Export again', onExport }));
  await vi.advanceTimersByTimeAsync(40);
  const next = panel.querySelector<HTMLElement>('.gv-export-conversation-menu-btn')!;
  expect(next.textContent).toContain('Export again');
  expect(panel.querySelectorAll('.gv-export-conversation-menu-btn')).toHaveLength(1);
  next.click();
  expect(onExport).toHaveBeenCalledOnce();
});

it('rebinds a recycled panel to its new trigger while the retained old button stays inert', async () => {
  const { panel, trigger } = mount(true);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const oldClick = vi.fn();
  const old = inject(panel, oldClick)!;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  const nextTrigger = trigger.cloneNode(true) as HTMLElement;
  trigger.replaceWith(nextTrigger);
  const nextClick = vi.fn();
  const next = inject(panel, nextClick)!;
  expect(next).not.toBe(old);
  expect(panel.querySelectorAll('.gv-export-conversation-menu-btn')).toHaveLength(1);
  expect(getConversationMenuContext(panel)?.trigger).toBe(nextTrigger);
  old.click();
  expect(oldClick).not.toHaveBeenCalled();
  next.click();
  expect(nextClick).toHaveBeenCalledOnce();
});

it('preserves bundled injection when an online alias cannot prove an ARIA association', async () => {
  const { panel, trigger } = mount();
  trigger.removeAttribute('aria-controls');
  const off = inject(panel)!;
  const parent = off.parentElement;
  off.remove();
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.alias-panel'],
      'menu.content': ['.alias-content'],
    }),
  );
  expect(inject(panel)?.parentElement).toBe(parent);
  expect(getConversationMenuContext(panel)?.trigger).toBe(trigger);
});

it('retires a retained button moved outside its panel and creates a fresh action inside', async () => {
  const { panel, trigger } = mount(true);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const oldClick = vi.fn();
  const old = inject(panel, oldClick)!;
  trigger.append(old);
  old.click();
  expect(oldClick).not.toHaveBeenCalled();
  const nextClick = vi.fn();
  const next = inject(panel, nextClick)!;
  expect(panel.contains(next)).toBe(true);
  next.click();
  expect(nextClick).toHaveBeenCalledOnce();
});

it('does not export a recycled sidebar row until a new menu action captures its conversation', async () => {
  const { panel, trigger } = mount(true);
  const sidebar = document.createElement('nav');
  sidebar.setAttribute('data-test-id', 'overflow-container');
  const row = document.createElement('div');
  row.setAttribute('data-test-id', 'conversation');
  const link = document.createElement('a');
  link.href = '/app/first-chat';
  link.textContent = 'First chat';
  row.append(link, trigger);
  sidebar.append(row);
  document.body.prepend(sidebar);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const oldClick = vi.fn();
  const old = inject(panel, oldClick)!;
  link.href = '/app/second-chat';
  old.click();
  expect(oldClick).not.toHaveBeenCalled();
  const nextClick = vi.fn();
  const next = inject(panel, nextClick)!;
  expect(next).not.toBe(old);
  next.click();
  expect(nextClick).toHaveBeenCalledOnce();
});

it('does not close a new overlay created by the export callback and still closes the original one', async () => {
  const { panel, trigger } = mount(true);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const backdrop = document.createElement('div');
  backdrop.className = 'cdk-overlay-backdrop';
  const close = vi.fn();
  backdrop.addEventListener('click', close);
  document.body.append(backdrop);
  const item = inject(panel, () => trigger.setAttribute('aria-expanded', 'false'))!;
  item.click();
  expect(close).not.toHaveBeenCalled();
  trigger.setAttribute('aria-expanded', 'true');
  const next = inject(panel)!;
  next.click();
  expect(close).toHaveBeenCalledOnce();
});

it('does not export after the same trigger moves to a different native owner', async () => {
  const { panel, trigger } = mount(true);
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const oldClick = vi.fn();
  const old = inject(panel, oldClick)!;
  const owner = document.createElement('div');
  document.body.append(owner);
  owner.append(trigger);
  old.click();
  expect(oldClick).not.toHaveBeenCalled();
  const nextClick = vi.fn();
  const next = inject(panel, nextClick)!;
  next.click();
  expect(nextClick).toHaveBeenCalledOnce();
});
