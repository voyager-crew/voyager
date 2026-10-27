import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { NativeConversationMenus } from '../NativeConversationMenus';

vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
  vi.useRealTimers();
});
async function open() {
  vi.useFakeTimers();
  const url = window.location.href;
  window.history.replaceState({}, '', '/app/a1b2c3d4e5f6a7b8');
  cleanups.push(() => window.history.replaceState({}, '', url));
  document.body.innerHTML =
    '<button data-test-id="actions-menu-button" aria-haspopup="menu" aria-expanded="true" aria-controls="menu"></button><div id="menu" role="menu" class="new-panel"><div class="new-content"><gem-menu-item data-test-id="pin-button"><mat-icon fonticon="keep"></mat-icon><span class="label-container"><span class="label">Pin</span></span></gem-menu-item></div></div>';
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  const onMove = vi.fn();
  const menus = new NativeConversationMenus({
    getContext: () => ({
      sidebar: null,
      storageKey: 'gvFolderData',
      accountIsolationEnabled: false,
      isDestroyed: false,
    }),
    onMoveToFolder: onMove,
    onConfirmedDelete: vi.fn(),
  });
  cleanups.push(() => menus.stop());
  menus.startTracking();
  menus.observePanels();
  const trigger = document.querySelector<HTMLButtonElement>('button')!;
  const panel = document.querySelector<HTMLElement>('#menu')!;
  trigger.click();
  await vi.advanceTimersByTimeAsync(40);
  expect(panel.querySelector('.gv-move-to-folder-btn')).not.toBeNull();
  trigger.focus();
  return { menus, trigger, panel, onMove };
}

it('releases pointer focus after a repaired panel closes but retains it through content repaint', async () => {
  const { trigger, panel } = await open();
  const oldContent = panel.firstElementChild!;
  const nextContent = oldContent.cloneNode(true);
  oldContent.replaceWith(nextContent);
  await vi.advanceTimersByTimeAsync(40);
  expect(document.activeElement).toBe(trigger);
  panel.remove();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(document.body);
});

it('keeps keyboard focus after a repaired panel closes', async () => {
  const { trigger, panel } = await open();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  panel.remove();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(trigger);
});

it('removes a move button when its owner stops and rebinds on restart', async () => {
  const { menus, panel, trigger, onMove } = await open();
  const old = panel.querySelector<HTMLElement>('.gv-move-to-folder-btn')!;
  menus.stop();
  old.click();
  expect(onMove).not.toHaveBeenCalled();
  expect(old.isConnected).toBe(false);
  menus.startTracking();
  menus.observePanels();
  trigger.click();
  await vi.advanceTimersByTimeAsync(40);
  const next = panel.querySelector<HTMLElement>('.gv-move-to-folder-btn')!;
  expect(next).not.toBe(old);
  expect(panel.querySelectorAll('.gv-move-to-folder-btn')).toHaveLength(1);
  next.click();
  expect(onMove).toHaveBeenCalledOnce();
  expect(onMove.mock.calls[0][0].id).toBe('a1b2c3d4e5f6a7b8');
});
