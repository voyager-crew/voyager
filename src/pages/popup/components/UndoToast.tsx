import React, { type Ref } from 'react';

import type { ShownUndoOffer } from '../hooks/useUndoToast';

export interface UndoToastProps {
  readonly offer: ShownUndoOffer | null;
  readonly undoLabel: string;
  readonly onUndo: () => void;
  /** Whether the pointer rests on the toast; it stays up meanwhile. */
  readonly onHover: (hovered: boolean) => void;
  /** Whether focus is inside the toast; it stays up meanwhile. */
  readonly onFocusInside: (focused: boolean) => void;
  readonly containerRef: Ref<HTMLDivElement>;
  readonly dir?: 'rtl';
}

/**
 * The popup's undo offer (or a notice with nothing to undo, such as an access
 * change the browser refused), pinned to the bottom of whatever scrolls the popup
 * (the toolbar popup or the options page tab). The page toaster is not used
 * here: it sits where a host page's controls leave room and follows the host
 * page's theme, not the popup's. The status region stays mounted so a screen
 * reader hears each new offer.
 */
export function UndoToast({
  offer,
  undoLabel,
  onUndo,
  onHover,
  onFocusInside,
  containerRef,
  dir,
}: UndoToastProps) {
  return (
    <div className="pointer-events-none sticky bottom-0 z-30 h-0">
      <div ref={containerRef} role="status" dir={dir} className="absolute inset-x-5 bottom-4">
        {offer && (
          <div
            key={offer.id}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            onFocus={() => onFocusInside(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) onFocusInside(false);
            }}
            // The page toast's face: surface card, hairline border, tone dot.
            className="border-border bg-card text-card-foreground pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] leading-snug shadow-[0_6px_20px_oklch(0_0_0/0.16)] dark:shadow-[0_6px_20px_oklch(0_0_0/0.4)]"
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${offer.tone === 'error' ? 'bg-destructive' : 'bg-primary'}`}
            />
            <span className="min-w-0 flex-1">{offer.message}</span>
            {offer.undo && (
              <button
                type="button"
                onClick={onUndo}
                className="text-primary hover:bg-primary/10 focus-visible:ring-ring/60 -my-1 shrink-0 rounded-md px-2 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {undoLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
