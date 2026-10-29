import React from 'react';

export interface PanelSwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onToggle: (next: boolean) => void;
  readonly disabled?: boolean;
  /** The browser's permission prompt is up: the knob breathes until it answers. */
  readonly waiting?: boolean;
  readonly title?: string;
  readonly id?: string;
}

/** The prototype's 36×22 switch: a button with `role="switch"`, knob on `--spring`. */
export function PanelSwitch({
  checked,
  label,
  onToggle,
  disabled = false,
  waiting = false,
  title,
  id,
}: PanelSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className={waiting ? 'sw wait' : 'sw'}
      aria-checked={checked}
      aria-label={label}
      aria-busy={waiting || undefined}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(!checked);
      }}
    />
  );
}
