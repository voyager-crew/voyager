import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { keyboardShortcutFromEvent } from '@/core/types/keyboardShortcut';

import { keyboardShortcutService } from '../KeyboardShortcutService';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(keydown(init));
}

async function subscribeBoth() {
  const timeline = vi.fn();
  const panel = vi.fn();
  const lease = keyboardShortcutService.acquire();
  keyboardShortcutService.on(timeline);
  keyboardShortcutService.on(panel, ['panel:toggle']);
  await lease.ready;
  return { timeline, panel };
}

beforeEach(async () => {
  keyboardShortcutService.destroy();
  vi.stubGlobal('chrome', undefined);
  localStorage.clear();
  await keyboardShortcutService.resetToDefaults();
});

afterEach(() => {
  keyboardShortcutService.destroy();
  vi.unstubAllGlobals();
});

describe('shortcut recording preserves the physical modifier binding', () => {
  it('refuses Previous recorded as Option+V before changing live or stored shortcuts', async () => {
    const { timeline, panel } = await subscribeBoth();
    const before = keyboardShortcutService.getConfig();
    const stored = localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS);
    const previous = keyboardShortcutFromEvent({
      event: keydown({ key: '√', code: 'KeyV', altKey: true }),
      action: 'timeline:previous',
    });
    await expect(
      keyboardShortcutService.saveConfig({ ...before.config, previous }),
    ).rejects.toThrow(/conflicting shortcut/i);
    expect(keyboardShortcutService.getConfig()).toEqual(before);
    expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).toBe(stored);
    press({ key: '√', code: 'KeyV', altKey: true });
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
    expect(timeline).not.toHaveBeenCalled();
  });

  it('keeps distinct physical keys distinct and matches after the layout character changes', async () => {
    const { timeline, panel } = await subscribeBoth();
    const before = keyboardShortcutService.getConfig().config;
    await keyboardShortcutService.saveConfig({
      ...before,
      previous: keyboardShortcutFromEvent({
        event: keydown({ key: '√', code: 'KeyB', altKey: true }),
        action: 'timeline:previous',
      }),
    });
    press({ key: '∫', code: 'KeyB', altKey: true });
    press({ key: '√', code: 'KeyV', altKey: true });
    expect(timeline).toHaveBeenCalledExactlyOnceWith(
      'timeline:previous',
      expect.any(KeyboardEvent),
    );
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
  });

  it('keeps an old Option+V character binding unchanged, with panel priority while subscribed', async () => {
    const stored = JSON.stringify({
      enabled: true,
      shortcuts: { previous: { action: 'timeline:previous', key: '√', modifiers: ['Alt'] } },
    });
    localStorage.setItem(StorageKeys.TIMELINE_SHORTCUTS, stored);
    const { timeline, panel } = await subscribeBoth();
    expect(keyboardShortcutService.getConfig().config.previous).not.toHaveProperty('code');
    press({ key: '√', code: 'KeyV', altKey: true });
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
    expect(timeline).not.toHaveBeenCalled();
    keyboardShortcutService.off(panel);
    press({ key: '√', code: 'KeyV', altKey: true });
    expect(timeline).toHaveBeenCalledExactlyOnceWith(
      'timeline:previous',
      expect.any(KeyboardEvent),
    );
    expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).toBe(stored);
  });

  it('records every held modifier and requires the complete combination', async () => {
    const { timeline } = await subscribeBoth();
    const combination = {
      key: 'X',
      code: 'KeyX',
      altKey: true,
      ctrlKey: true,
      shiftKey: true,
      metaKey: true,
    };
    await keyboardShortcutService.saveConfig({
      ...keyboardShortcutService.getConfig().config,
      previous: keyboardShortcutFromEvent({
        event: keydown(combination),
        action: 'timeline:previous',
      }),
    });
    press({ ...combination, ctrlKey: false });
    expect(timeline).not.toHaveBeenCalled();
    press(combination);
    expect(timeline).toHaveBeenCalledExactlyOnceWith(
      'timeline:previous',
      expect.any(KeyboardEvent),
    );
  });

  it('keeps unmodified vv as a character sequence when recorded with a physical code', async () => {
    const { panel } = await subscribeBoth();
    await keyboardShortcutService.saveConfig({
      ...keyboardShortcutService.getConfig().config,
      panelToggle: keyboardShortcutFromEvent({
        event: keydown({ key: 'v', code: 'KeyV' }),
        action: 'panel:toggle',
        sequenceLength: 2,
      }),
    });
    press({ key: 'v', code: 'KeyW' });
    expect(panel).not.toHaveBeenCalled();
    press({ key: 'v', code: 'KeyW' });
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
  });

  it.each(['', 'Unidentified'])(
    'uses the character when the recorded physical code is unknown (%s)',
    async (code) => {
      const { timeline } = await subscribeBoth();
      await keyboardShortcutService.saveConfig({
        ...keyboardShortcutService.getConfig().config,
        previous: keyboardShortcutFromEvent({
          event: keydown({ key: '§', code, altKey: true }),
          action: 'timeline:previous',
        }),
      });
      press({ key: '§', code: 'KeyQ', altKey: true });
      expect(timeline).toHaveBeenCalledExactlyOnceWith(
        'timeline:previous',
        expect.any(KeyboardEvent),
      );
    },
  );
});
