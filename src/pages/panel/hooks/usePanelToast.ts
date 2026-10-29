import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ShownUndoOffer,
  UndoOffer,
  WithdrawUndoOffer,
} from '@/pages/popup/hooks/useUndoToast';

/** A toast that only reports. */
export const PANEL_TOAST_MS = 4200;
/** A toast with 撤销 stays long enough to reach it (decision Q17). */
export const PANEL_UNDO_TOAST_MS = 10_000;

/**
 * The panel's toasts, with the popup's undo offers (`UndoOffer`), so the
 * popup's actions report here unchanged. One at a time: a newer one replaces
 * it. It closes by itself, 10s with 撤销 and 4.2s without, and waits while
 * the pointer rests on it or focus is inside it.
 */
export function usePanelToast() {
  const [offer, setOffer] = useState<ShownUndoOffer | null>(null);
  const shown = useRef<ShownUndoOffer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);
  /** The toast's element, to tell whether it holds focus as it closes. */
  const containerRef = useRef<HTMLDivElement | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const dismiss = useCallback(() => {
    stopTimer();
    const closing = shown.current;
    const heldFocus = containerRef.current?.contains(document.activeElement) ?? false;
    shown.current = null;
    hovered.current = false;
    focused.current = false;
    setOffer(null);
    // Focus would otherwise drop to the page once the focused toast is gone.
    if (heldFocus) closing?.returnFocus?.()?.focus();
  }, [stopTimer]);

  const startTimer = useCallback(() => {
    stopTimer();
    const current = shown.current;
    if (!current || hovered.current || focused.current) return;
    timer.current = setTimeout(dismiss, current.undo ? PANEL_UNDO_TOAST_MS : PANEL_TOAST_MS);
  }, [dismiss, stopTimer]);

  const show = useCallback(
    (next: UndoOffer): WithdrawUndoOffer => {
      const current = { ...next, id: ++nextId.current };
      shown.current = current;
      setOffer(current);
      startTimer();
      return () => {
        if (shown.current?.id === current.id) dismiss();
      };
    },
    [dismiss, startTimer],
  );

  const undo = useCallback(() => {
    const current = shown.current;
    dismiss();
    current?.undo?.();
  }, [dismiss]);

  const setHovered = useCallback(
    (value: boolean) => {
      hovered.current = value;
      startTimer();
    },
    [startTimer],
  );
  const setFocused = useCallback(
    (value: boolean) => {
      focused.current = value;
      startTimer();
    },
    [startTimer],
  );

  useEffect(() => stopTimer, [stopTimer]);

  return { offer, show, dismiss, undo, setHovered, setFocused, containerRef };
}

export type PanelToastState = ReturnType<typeof usePanelToast>;
