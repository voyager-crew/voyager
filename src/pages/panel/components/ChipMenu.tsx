import React, { useCallback, useRef, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import type { PanelChip } from '../features/featureRows';
import { PanelMenu } from './PanelMenu';

/** A row's choice: a chip showing the current option that opens a menu of the others. */
export function ChipMenu({ chip, disabled }: { chip: PanelChip; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const current = chip.options.find((option) => option.value === chip.value);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${chip.label}: ${current?.label ?? chip.value}`}
        title={chip.label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <span>{current?.label ?? chip.value}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <PanelMenu
        open={open}
        anchor={anchor}
        align="end"
        label={chip.label}
        items={chip.options.map((option) => ({
          value: option.value,
          label: option.label,
          checked: option.value === chip.value,
          disabled: option.disabled,
        }))}
        onPick={(value) => {
          if (value !== chip.value) chip.pick(value);
        }}
        onClose={close}
      />
    </>
  );
}
