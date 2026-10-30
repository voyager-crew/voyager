import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ESCAPE_PRIORITY, useEscapeLayer } from '../hooks/escapeLayers';

export interface PanelMenuItem {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly checked: boolean;
  readonly disabled?: boolean;
  /** Before the label (a site logo). */
  readonly leading?: React.ReactNode;
  /** At the inline end (the "This page" mark). */
  readonly trailing?: React.ReactNode;
}

export interface PanelMenuProps {
  readonly open: boolean;
  readonly anchor: React.RefObject<HTMLElement | null>;
  readonly items: readonly PanelMenuItem[];
  /** Which edge of the anchor the menu lines up with, in the reading direction. */
  readonly align: 'start' | 'end';
  readonly label: string;
  readonly onPick: (value: string) => void;
  readonly onClose: () => void;
  /** Actions (the sync sheet's ⋯ menu) have no checked state. */
  readonly kind?: 'choice' | 'action';
}

interface Placement {
  readonly style: React.CSSProperties;
}

const GAP = 6;

function place(anchor: HTMLElement, menu: HTMLElement, align: 'start' | 'end'): Placement {
  const rect = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const below = rect.bottom + GAP + menu.offsetHeight < window.innerHeight;
  const toLeftEdge = (align === 'start') !== rtl;
  const vertical = below ? 'top' : 'bottom';
  return {
    style: {
      transformOrigin: `${vertical} ${toLeftEdge ? 'left' : 'right'}`,
      top: below ? rect.bottom + GAP : 'auto',
      bottom: below ? 'auto' : window.innerHeight - rect.top + GAP,
      left: toLeftEdge ? Math.max(8, rect.left) : 'auto',
      right: toLeftEdge ? 'auto' : Math.max(8, window.innerWidth - rect.right),
    },
  };
}

/**
 * A choice menu under (or above) its anchor: springs in, moves with the arrow
 * keys, closes on Esc (before search and the panel), a pick or a click outside,
 * and hands focus back to its anchor.
 */
export function PanelMenu({
  open,
  anchor,
  items,
  align,
  label,
  onPick,
  onClose,
  kind = 'choice',
}: PanelMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [shown, setShown] = useState(false);

  const closeToAnchor = () => {
    onClose();
    anchor.current?.focus({ preventScroll: true });
  };
  useEscapeLayer(ESCAPE_PRIORITY.menu, open, () => {
    closeToAnchor();
    return true;
  });

  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) {
      setShown(false);
      return undefined;
    }
    setPlacement(place(anchor.current, menu.current, align));
    const items = [...menu.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({
      preventScroll: true,
    });
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [align, anchor, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menu.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, onClose, open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      onClose();
      return;
    }
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target =
      event.key === 'ArrowDown'
        ? buttons[(index + 1) % buttons.length]
        : event.key === 'ArrowUp'
          ? buttons[(index - 1 + buttons.length) % buttons.length]
          : event.key === 'Home'
            ? buttons[0]
            : event.key === 'End'
              ? buttons[buttons.length - 1]
              : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return createPortal(
    <div
      ref={menu}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      className={open && shown ? 'menu open' : 'menu'}
      style={placement?.style}
      hidden={!open}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role={kind === 'action' ? 'menuitem' : 'menuitemradio'}
          aria-checked={kind === 'action' ? undefined : item.checked}
          disabled={item.disabled}
          onClick={() => {
            closeToAnchor();
            onPick(item.value);
          }}
        >
          {item.leading}
          <span className="ml">{item.label}</span>
          {item.trailing}
        </button>
      ))}
    </div>,
    document.body,
  );
}
