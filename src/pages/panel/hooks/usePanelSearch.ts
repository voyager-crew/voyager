import { useCallback, useEffect, useRef, useState } from 'react';

import { ESCAPE_PRIORITY, useEscapeLayer } from './escapeLayers';

/** The prototype focuses the field once it has started to open. */
const FOCUS_DELAY_MS = 60;

/**
 * The top bar's search: the icon opens a field and focuses it; with the field
 * empty the icon closes it again. Esc closes it only while the field has focus
 * (otherwise Esc goes on to close the panel), and gives focus back to the icon.
 */
export function usePanelSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => input.current?.focus({ preventScroll: true }), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open]);

  const toggle = useCallback(() => {
    if (open && !query) close();
    else if (open) input.current?.focus({ preventScroll: true });
    else setOpen(true);
  }, [close, open, query]);

  useEscapeLayer(ESCAPE_PRIORITY.search, open, () => {
    if (document.activeElement !== input.current) return false;
    close();
    button.current?.focus({ preventScroll: true });
    return true;
  });

  return {
    state: { open, query, setQuery, toggle },
    inputRef: input,
    buttonRef: button,
    close,
  };
}
