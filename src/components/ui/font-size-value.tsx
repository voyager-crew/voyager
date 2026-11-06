import { useEffect, useRef, useState } from 'react';

import { RotateCcw } from 'lucide-react';

interface FontSizeValueProps {
  readonly label: string;
  readonly resetLabel: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled?: boolean;
  readonly variant?: 'popup' | 'panel';
  readonly onCommit: (value: number) => void;
}

/** Keep a typing draft until blur/Enter, so intermediate digits never resize the page. */
export function FontSizeValue({
  label,
  resetLabel,
  value,
  min,
  max,
  disabled = false,
  variant = 'popup',
  onCommit,
}: FontSizeValueProps) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);

  const finish = () => {
    editing.current = false;
    if (disabled) {
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.round(Math.min(max, Math.max(min, parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const panel = variant === 'panel';
  return (
    <span className={panel ? 'font-size-value' : 'inline-flex items-center gap-1'}>
      <span
        className={
          panel
            ? 'font-size-number'
            : 'bg-secondary text-foreground focus-within:ring-ring/50 inline-flex h-6 items-center rounded-md px-1.5 text-xs tabular-nums focus-within:ring-2'
        }
        dir="ltr"
      >
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          inputMode="numeric"
          aria-label={label}
          value={draft}
          disabled={disabled}
          className={
            panel
              ? 'font-size-input'
              : 'w-10 min-w-0 border-0 bg-transparent p-0 text-end outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
          }
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(event) => {
            editing.current = true;
            setDraft(event.target.value);
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            // Nothing to cancel leaves Esc to its surroundings, so the panel can still close.
            if (event.key === 'Escape' && draft !== String(value)) {
              event.preventDefault();
              event.stopPropagation();
              editing.current = false;
              setDraft(String(value));
            }
          }}
        />
        <span aria-hidden="true">%</span>
      </span>
      <button
        type="button"
        aria-label={resetLabel}
        title={resetLabel}
        disabled={disabled}
        className={
          panel
            ? 'font-size-reset'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring/50 inline-flex h-6 w-6 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed'
        }
        // Keep a reset click from first blurring and saving an unfinished number.
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          editing.current = false;
          setDraft('100');
          if (value !== 100) onCommit(100);
        }}
      >
        <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  );
}
