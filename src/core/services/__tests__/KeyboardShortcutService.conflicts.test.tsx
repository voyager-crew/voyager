import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '@/core/types/keyboardShortcut';
import { KeyboardShortcutSettings } from '@/pages/popup/components/KeyboardShortcutSettings';

import { keyboardShortcutService } from '../KeyboardShortcutService';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key: string) => key }),
}));

let root: Root | undefined;

function press(key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

async function subscribeBoth() {
  const timeline = vi.fn();
  const panel = vi.fn();
  const timelineLease = keyboardShortcutService.acquire();
  const panelLease = keyboardShortcutService.acquire();
  keyboardShortcutService.on(timeline);
  keyboardShortcutService.on(panel, ['panel:toggle']);
  await Promise.all([timelineLease.ready, panelLease.ready]);
  return { timeline, panel };
}

beforeEach(async () => {
  keyboardShortcutService.destroy();
  vi.stubGlobal('chrome', undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  await keyboardShortcutService.resetToDefaults();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  keyboardShortcutService.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('panel and timeline shortcut conflicts', () => {
  it.each(['first', 'previous'] as const)(
    'keeps the panel reachable with restored %s conflicts without rewriting stored choices',
    async (name) => {
      const stored = JSON.stringify({
        enabled: true,
        shortcuts: {
          ...DEFAULT_KEYBOARD_SHORTCUTS,
          [name]: { ...DEFAULT_KEYBOARD_SHORTCUTS[name], key: 'v' },
          panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
        },
      });
      localStorage.setItem(StorageKeys.TIMELINE_SHORTCUTS, stored);
      const { timeline, panel } = await subscribeBoth();
      press('v');
      press('v');
      expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
      expect(timeline).not.toHaveBeenCalled();
      press('j');
      expect(timeline).toHaveBeenCalledExactlyOnceWith('timeline:next', expect.any(KeyboardEvent));
      expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).toBe(stored);

      keyboardShortcutService.off(panel);
      timeline.mockClear();
      press('v');
      press('v');
      expect(timeline).toHaveBeenCalledTimes(name === 'first' ? 1 : 2);
    },
  );

  it('rejects a duplicate save before replacing live or stored bindings', async () => {
    await keyboardShortcutService.saveConfig({
      ...DEFAULT_KEYBOARD_SHORTCUTS,
      panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
    });
    const { timeline, panel } = await subscribeBoth();
    const previous = keyboardShortcutService.getConfig();
    const stored = localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS);
    await expect(
      keyboardShortcutService.saveConfig({
        ...previous.config,
        first: { action: 'timeline:first', modifiers: [], key: 'v', sequenceLength: 2 },
      }),
    ).rejects.toThrow(/conflicting shortcut/i);
    expect(keyboardShortcutService.getConfig()).toEqual(previous);
    expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).toBe(stored);
    press('v');
    press('v');
    press('g');
    press('g');
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
    expect(timeline).toHaveBeenCalledExactlyOnceWith('timeline:first', expect.any(KeyboardEvent));
  });

  it('keeps the enabled state when saving a restored conflict is refused', async () => {
    const stored = JSON.stringify({
      enabled: true,
      shortcuts: {
        ...DEFAULT_KEYBOARD_SHORTCUTS,
        first: { action: 'timeline:first', modifiers: [], key: 'v', sequenceLength: 2 },
        panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
      },
    });
    localStorage.setItem(StorageKeys.TIMELINE_SHORTCUTS, stored);
    const { timeline, panel } = await subscribeBoth();
    await expect(keyboardShortcutService.setEnabled(false)).rejects.toThrow(
      /conflicting shortcut/i,
    );
    press('j');
    press('v');
    press('v');
    expect(timeline).toHaveBeenCalledExactlyOnceWith('timeline:next', expect.any(KeyboardEvent));
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
    expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).toBe(stored);
  });

  it('keeps both actions reachable when the current popup swaps restored panel vv with timeline gg', async () => {
    localStorage.setItem(
      StorageKeys.TIMELINE_SHORTCUTS,
      JSON.stringify({
        enabled: true,
        shortcuts: {
          ...DEFAULT_KEYBOARD_SHORTCUTS,
          panelToggle: { action: 'panel:toggle', modifiers: [], key: 'v', sequenceLength: 2 },
        },
      }),
    );
    const { timeline, panel } = await subscribeBoth();
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<KeyboardShortcutSettings />);
    });
    const first = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'gg',
    );
    if (!first) throw new Error('Timeline first shortcut editor is missing');
    await act(async () => first.click());
    await act(async () => {
      press('v');
    });

    const saved = keyboardShortcutService.getConfig().config;
    expect(saved.first).toMatchObject({ action: 'timeline:first', key: 'v', sequenceLength: 2 });
    expect(saved.panelToggle).toMatchObject({
      action: 'panel:toggle',
      key: 'g',
      sequenceLength: 2,
    });
    expect(localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS)).not.toContain(
      'timeline:panelToggle',
    );
    timeline.mockClear();
    panel.mockClear();
    press('v');
    press('v');
    press('g');
    press('g');
    expect(timeline).toHaveBeenCalledExactlyOnceWith('timeline:first', expect.any(KeyboardEvent));
    expect(panel).toHaveBeenCalledExactlyOnceWith('panel:toggle', expect.any(KeyboardEvent));
  });
});
