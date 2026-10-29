import { useCallback, useEffect, useRef, useState } from 'react';

/** How long an undo offer stays up unless the pointer or focus rests on it. */
export const UNDO_TOAST_MS = 4000;

export interface UndoOffer {
  readonly message: string;
  /**
   * Puts back what the change replaced, through the same write the change used.
   * Left out, the toast only reports what happened.
   */
  readonly undo?: () => void;
  /** `error` when it reports something that did not happen. */
  readonly tone?: 'error';
  /** Where focus goes when the offer closes while it holds focus: the control that changed. */
  readonly returnFocus?: () => HTMLElement | null;
}

export interface ShownUndoOffer extends UndoOffer {
  /** New for every offer, so a repeated message is announced again. */
  readonly id: number;
}

/** Closes this offer if it is still the one shown; a later offer is left alone. */
export type WithdrawUndoOffer = () => void;

/**
 * One undo offer at a time: a newer one replaces it, and it closes by itself
 * after `durationMs` unless the pointer rests on it or focus is inside it.
 */
export function useUndoToast(durationMs: number = UNDO_TOAST_MS) {
  const [offer, setOffer] = useState<ShownUndoOffer | null>(null);
  const offerRef = useRef<ShownUndoOffer | null>(null);
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
    const closing = offerRef.current;
    const heldFocus =
      containerRef.current !== null && containerRef.current.contains(document.activeElement);
    offerRef.current = null;
    hovered.current = false;
    focused.current = false;
    setOffer(null);
    // Focus would otherwise drop to the page once the focused toast is gone.
    if (heldFocus) closing?.returnFocus?.()?.focus();
  }, [stopTimer]);

  const startTimer = useCallback(() => {
    stopTimer();
    if (!offerRef.current || hovered.current || focused.current) return;
    timer.current = setTimeout(dismiss, durationMs);
  }, [dismiss, durationMs, stopTimer]);

  const show = useCallback(
    (next: UndoOffer): WithdrawUndoOffer => {
      const shown = { ...next, id: ++nextId.current };
      offerRef.current = shown;
      setOffer(shown);
      startTimer();
      return () => {
        if (offerRef.current?.id === shown.id) dismiss();
      };
    },
    [dismiss, startTimer],
  );

  const undo = useCallback(() => {
    const current = offerRef.current;
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
