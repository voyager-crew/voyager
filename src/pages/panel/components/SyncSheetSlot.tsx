import type React from 'react';

export interface SyncSheetSlotProps {
  /** The top bar's cloud button, which the sheet hangs under and returns focus to. */
  readonly cloudButtonRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Where the cloud sync sheet goes (spec #1077 Part 2). Nothing is wired yet:
 * the cloud button has no action and this renders nothing. Part 2 fills this
 * component, opens it from the cloud button, and registers its Esc layer at
 * `ESCAPE_PRIORITY.syncSheet`, so Esc closes a menu, then the sheet, then search.
 */
export function SyncSheetSlot(_props: SyncSheetSlotProps): React.ReactElement | null {
  return null;
}
