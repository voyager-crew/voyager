import React, { type Ref, useEffect, useState } from 'react';

import type { ShownUndoOffer } from '@/pages/popup/hooks/useUndoToast';

export interface PanelToastProps {
  readonly offer: ShownUndoOffer | null;
  readonly undoLabel: string;
  readonly onUndo: () => void;
  /** Whether the pointer rests on the toast; it stays up meanwhile. */
  readonly onHover: (hovered: boolean) => void;
  /** Whether focus is inside the toast; it stays up meanwhile. */
  readonly onFocusInside: (focused: boolean) => void;
  readonly containerRef: Ref<HTMLDivElement>;
}

/**
 * The prototype's 40px toast, bottom center of the panel, with an optional
 * 撤销. Offers come from the popup's own actions (site access, websites), so
 * their wording is the popup's. The status region stays mounted so each new
 * offer is announced; a closing toast keeps its text while it fades out.
 */
export function PanelToast({
  offer,
  undoLabel,
  onUndo,
  onHover,
  onFocusInside,
  containerRef,
}: PanelToastProps) {
  const [last, setLast] = useState<ShownUndoOffer | null>(null);
  useEffect(() => {
    if (offer) setLast(offer);
  }, [offer]);
  const shown = offer ?? last;
  return (
    <div ref={containerRef} role="status" className="toasts">
      {shown && (
        <div
          className={offer ? 'toast open' : 'toast'}
          data-tone={shown.tone}
          aria-hidden={offer ? undefined : true}
          inert={!offer}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onFocus={() => onFocusInside(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onFocusInside(false);
          }}
        >
          <span key={shown.id} className="msg" title={shown.message}>
            {shown.message}
          </span>
          {shown.undo && (
            <button type="button" onClick={onUndo}>
              {undoLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
