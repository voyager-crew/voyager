import { useEffect, useRef, useState } from 'react';

import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import { DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcut } from '@/core/types/keyboardShortcut';
import { isMac } from '@/core/utils/browser';

import { shortcutLabel } from '../panelText';

/**
 * The panel shortcut while focus is inside this frame, where the page's own
 * listener cannot hear it: the service matches the saved binding as the page
 * does (physical key, ignored while composing, `vv` only outside text fields)
 * and keeps the key from being typed. Returns its label for the key cap
 * (⌥V on macOS, Alt+V elsewhere, unless the binding was changed).
 */
export function usePanelShortcut(onToggle: () => void): string {
  const [shortcut, setShortcut] = useState<KeyboardShortcut>(
    DEFAULT_KEYBOARD_SHORTCUTS.panelToggle,
  );
  const toggle = useRef(onToggle);
  useEffect(() => {
    toggle.current = onToggle;
  });

  useEffect(() => {
    let active = true;
    const lease = keyboardShortcutService.acquire();
    const off = keyboardShortcutService.on(() => toggle.current(), ['panel:toggle']);
    void lease.ready.then(() => {
      if (active) setShortcut(keyboardShortcutService.getConfig().config.panelToggle);
    });
    return () => {
      active = false;
      off();
      lease.release();
    };
  }, []);

  return shortcutLabel(shortcut, isMac());
}
