import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * What Esc closes first: an open menu, then the sync sheet (Part 2 registers
 * it at this priority), then search, then the panel itself.
 */
export const ESCAPE_PRIORITY = { search: 1, syncSheet: 2, menu: 3 } as const;

interface EscapeLayer {
  readonly priority: number;
  /** False when the layer does not take this Esc (search only closes while focused). */
  readonly close: () => boolean;
}

type RegisterLayer = (layer: EscapeLayer) => () => void;

const EscapeLayersContext = createContext<RegisterLayer | null>(null);

/** Esc inside the page closes the topmost open layer, or else calls `onNothingOpen`. */
export function EscapeLayers({
  onNothingOpen,
  children,
}: {
  readonly onNothingOpen: () => void;
  readonly children: React.ReactNode;
}) {
  const layers = useRef(new Set<EscapeLayer>());
  const register = useCallback<RegisterLayer>((layer) => {
    layers.current.add(layer);
    return () => {
      layers.current.delete(layer);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      const open = [...layers.current].sort((a, b) => b.priority - a.priority);
      if (open.some((layer) => layer.close())) return;
      onNothingOpen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNothingOpen]);

  return <EscapeLayersContext.Provider value={register}>{children}</EscapeLayersContext.Provider>;
}

/** Registers a layer while `active`; `close` returns whether it handled the Esc. */
export function useEscapeLayer(priority: number, active: boolean, close: () => boolean): void {
  const register = useContext(EscapeLayersContext);
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!active || !register) return undefined;
    return register({ priority, close: () => latest.current() });
  }, [active, priority, register]);
}
