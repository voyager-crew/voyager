import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { KeyboardShortcutConfig } from '@/core/types/keyboardShortcut';

import { keyboardShortcutService } from '../KeyboardShortcutService';

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

const optionV = { key: '√', code: 'KeyV', altKey: true } satisfies KeyboardEventInit;

async function subscribePanel(callback = vi.fn()) {
  const lease = keyboardShortcutService.acquire();
  const off = keyboardShortcutService.on(callback, ['panel:toggle']);
  await lease.ready;
  return {
    callback,
    release: () => {
      off();
      lease.release();
    },
  };
}

function chooseVv() {
  return keyboardShortcutService.saveConfig({
    ...keyboardShortcutService.getConfig().config,
    panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
  });
}

beforeEach(async () => {
  keyboardShortcutService.destroy();
  vi.stubGlobal('chrome', undefined);
  localStorage.clear();
  await keyboardShortcutService.resetToDefaults();
});

afterEach(() => {
  keyboardShortcutService.destroy();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('panel shortcut at the page keyboard seam', () => {
  it.each(['input', 'textarea'] as const)(
    'Option+V opens once from a focused %s and cancels character insertion',
    async (tag) => {
      const composer = document.createElement(tag);
      composer.value = 'Voyager 测试';
      document.body.append(composer);
      composer.focus();
      composer.setSelectionRange(2, 5);
      const panel = document.createElement('aside');
      panel.hidden = true;
      document.body.append(panel);
      const { callback } = await subscribePanel(
        vi.fn(() => {
          panel.hidden = !panel.hidden;
        }),
      );

      const event = press(optionV, composer);
      // jsdom has no keyboard default action; emulate only the browser's uncanceled insertion.
      if (!event.defaultPrevented) composer.setRangeText(event.key);
      const repeat = press({ ...optionV, repeat: true }, composer);
      if (!repeat.defaultPrevented) composer.setRangeText(repeat.key);

      expect(callback).toHaveBeenCalledExactlyOnceWith('panel:toggle', event);
      expect(panel.hidden).toBe(false);
      expect(composer.value).toBe('Voyager 测试');
      expect([composer.selectionStart, composer.selectionEnd]).toEqual([2, 5]);
      expect(document.activeElement).toBe(composer);
      expect(event.defaultPrevented).toBe(true);
      expect(repeat.defaultPrevented).toBe(true);
    },
  );

  it('keeps a focused contenteditable composer and its selection unchanged', async () => {
    const composer = document.createElement('div');
    composer.setAttribute('contenteditable', 'true');
    composer.tabIndex = 0;
    composer.innerHTML = '<span>Voyager 测试</span>';
    document.body.append(composer);
    composer.focus();
    const text = composer.querySelector('span')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 5);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const { callback } = await subscribePanel();

    const event = press(optionV, composer.querySelector('span')!);

    expect(callback).toHaveBeenCalledExactlyOnceWith('panel:toggle', event);
    expect(event.defaultPrevented).toBe(true);
    expect(composer.textContent).toBe('Voyager 测试');
    expect(document.activeElement).toBe(composer);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(text);
    expect(selection?.focusNode).toBe(text);
    expect([selection?.anchorOffset, selection?.focusOffset]).toEqual([2, 5]);
  });

  it('recognizes the physical V key on Windows and rejects other keys and modifiers', async () => {
    const { callback } = await subscribePanel();
    const event = press({ key: 'v', code: 'KeyV', altKey: true });
    expect(callback).toHaveBeenCalledExactlyOnceWith('panel:toggle', event);
    expect(event.defaultPrevented).toBe(true);
    for (const init of [
      { ...optionV, ctrlKey: true },
      { ...optionV, metaKey: true },
      { ...optionV, shiftKey: true },
      { ...optionV, altKey: false },
      { ...optionV, code: 'KeyK' },
      { ...optionV, code: '' },
    ])
      expect(press(init).defaultPrevented).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
  });

  it.each([
    { isComposing: true },
    { key: 'Process' },
    { keyCode: 229 },
  ] satisfies KeyboardEventInit[])(
    'does not consume IME input signaled by %o',
    async (composition) => {
      const composer = document.createElement('textarea');
      document.body.append(composer);
      composer.focus();
      const { callback } = await subscribePanel();

      const event = press({ ...optionV, ...composition }, composer);

      expect(event.defaultPrevented).toBe(false);
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it('keeps all timeline actions out of editables, including modifier shortcuts', async () => {
    await keyboardShortcutService.saveConfig({
      ...keyboardShortcutService.getConfig().config,
      previous: { action: 'timeline:previous', modifiers: ['Alt'], key: 'ArrowUp' },
      next: { action: 'timeline:next', modifiers: ['Ctrl'], key: 'ArrowDown' },
    });
    const { callback: panel } = await subscribePanel();
    const timeline = vi.fn();
    keyboardShortcutService.on(timeline);
    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.focus();
    for (const init of [
      { key: 'ArrowUp', altKey: true },
      { key: 'ArrowDown', ctrlKey: true },
      { key: 'g' },
      { key: 'g' },
      { key: 'G', shiftKey: true },
      { key: 'G', shiftKey: true },
    ])
      expect(press(init, composer).defaultPrevented).toBe(false);
    expect(timeline).not.toHaveBeenCalled();
    expect(panel).not.toHaveBeenCalled();
    expect(press(optionV, composer).defaultPrevented).toBe(true);
    expect(panel).toHaveBeenCalledOnce();
  });

  it('ignores vv by default and uses it only outside editables after opt-in', async () => {
    const { callback } = await subscribePanel();
    expect(press({ key: 'v' }).defaultPrevented).toBe(false);
    expect(press({ key: 'v' }).defaultPrevented).toBe(false);
    expect(callback).not.toHaveBeenCalled();

    await chooseVv();
    expect(press(optionV).defaultPrevented).toBe(false);
    expect(press({ key: 'v' }).defaultPrevented).toBe(false);
    const second = press({ key: 'v' });
    expect(second.defaultPrevented).toBe(true);
    expect(callback).toHaveBeenCalledExactlyOnceWith('panel:toggle', second);

    const composer = document.createElement('input');
    document.body.append(composer);
    composer.focus();
    expect(press({ key: 'v' }, composer).defaultPrevented).toBe(false);
    expect(press({ key: 'v' }, composer).defaultPrevented).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
    composer.blur();
    expect(press({ key: 'v' }).defaultPrevented).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('resets vv across typing and composition and keeps the existing sequence timeout', async () => {
    vi.useFakeTimers();
    await chooseVv();
    const { callback } = await subscribePanel();
    press({ key: 'v' });
    press({ key: 'v', isComposing: true });
    expect(press({ key: 'v' }).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500);
    expect(press({ key: 'v' }).defaultPrevented).toBe(false);
    expect(press({ key: 'v', repeat: true }).defaultPrevented).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    expect(press({ key: 'v' }).defaultPrevented).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
  });
});

describe('independent panel and timeline holders', () => {
  it.each(['panel', 'timeline'] as const)(
    'releasing the %s holder preserves only the remaining holder’s actions',
    async (owner) => {
      const panel = await subscribePanel();
      const timelineLease = keyboardShortcutService.acquire();
      const timeline = vi.fn();
      const offTimeline = keyboardShortcutService.on(timeline);
      await timelineLease.ready;

      expect(press({ key: 'j' }).defaultPrevented).toBe(true);
      expect(timeline).toHaveBeenCalledOnce();
      expect(panel.callback).not.toHaveBeenCalled();
      expect(press(optionV).defaultPrevented).toBe(true);
      expect(panel.callback).toHaveBeenCalledOnce();
      expect(timeline).toHaveBeenCalledOnce();

      if (owner === 'panel') panel.release();
      else {
        offTimeline();
        timelineLease.release();
      }

      expect(press({ key: 'j' }).defaultPrevented).toBe(owner === 'panel');
      expect(press(optionV).defaultPrevented).toBe(owner === 'timeline');
      expect(timeline).toHaveBeenCalledTimes(owner === 'panel' ? 2 : 1);
      expect(panel.callback).toHaveBeenCalledTimes(owner === 'timeline' ? 2 : 1);
      panel.release();
      offTimeline();
      timelineLease.release();
      expect(press({ key: 'j' }).defaultPrevented).toBe(false);
      expect(press(optionV).defaultPrevented).toBe(false);
    },
  );

  it('loads an old disabled timeline config with the new panel default without rewriting storage', async () => {
    const old = {
      enabled: false,
      shortcuts: {
        previous: { action: 'timeline:previous', modifiers: [], key: 'p' },
        next: { action: 'timeline:next', modifiers: [], key: 'n' },
      },
    };
    localStorage.setItem(StorageKeys.TIMELINE_SHORTCUTS, JSON.stringify(old));
    const before = localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS);
    const { callback } = await subscribePanel();
    const timeline = vi.fn();
    keyboardShortcutService.on(timeline);

    expect(press({ key: 'n' }).defaultPrevented).toBe(false);
    const event = press(optionV);
    expect(event.defaultPrevented).toBe(true);
    expect(callback).toHaveBeenCalledExactlyOnceWith('panel:toggle', event);
    expect(timeline).not.toHaveBeenCalled();
    expect(keyboardShortcutService.getConfig().config.next.key).toBe('n');
    expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).toBe(before);
  });

  it('preserves the panel shortcut when an old editor saves or disables timeline', async () => {
    await chooseVv();
    const panel = keyboardShortcutService.getConfig().config.panelToggle;
    const { panelToggle: _panel, ...timeline } = keyboardShortcutService.getConfig().config;
    const oldEditorConfig: KeyboardShortcutConfig = timeline;
    await keyboardShortcutService.saveConfig(oldEditorConfig);
    expect(keyboardShortcutService.getConfig().config.panelToggle).toEqual(panel);

    await keyboardShortcutService.setEnabled(false);
    const { callback } = await subscribePanel();
    press({ key: 'v' });
    expect(press({ key: 'v' }).defaultPrevented).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(keyboardShortcutService.getConfig().config.panelToggle).toEqual(panel);

    await keyboardShortcutService.resetToDefaults();
    expect(press(optionV).defaultPrevented).toBe(true);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it.each([
    { action: 'panel:toggle', modifiers: ['Bogus'], key: 'V', code: 42 },
    { action: 'panel:toggle' },
    { action: 'panel:toggle', modifiers: ['Alt'], key: 'V' },
  ])(
    'keeps Option+V working with malformed or partial stored panel fields: %o',
    async (panelToggle) => {
      localStorage.setItem(
        StorageKeys.TIMELINE_SHORTCUTS,
        JSON.stringify({
          enabled: true,
          shortcuts: { next: { key: 'n', modifiers: [] }, panelToggle },
        }),
      );
      const { callback } = await subscribePanel();
      expect(press(optionV).defaultPrevented).toBe(true);
      expect(callback).toHaveBeenCalledOnce();
      expect(keyboardShortcutService.getConfig().config.next.key).toBe('n');
    },
  );
});
