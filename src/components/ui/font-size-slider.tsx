import { useRef } from 'react';

import { Slider, type SliderProps } from './slider';

/** Preserve a typed fraction on the track; dragging picks whole percentages, arrows move by 1%. */
export function FontSizeSlider({ onValueChange, onValueCommit, ...props }: SliderProps) {
  const moved = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Slider
      {...props}
      ref={input}
      step="any"
      onValueChange={(next) => {
        moved.current = Math.round(next);
        // Native range input can move within the same rounded value without a React
        // render; keep its reading aligned with the visible percentage for arrow keys.
        if (input.current) input.current.value = String(moved.current);
        onValueChange?.(moved.current);
      }}
      onValueCommit={(next) => {
        // A sub-pixel pointer position may leave a fractional native range value even
        // when rounding did not change React state. Commit the value the person saw.
        onValueCommit?.(moved.current ?? next);
        moved.current = null;
      }}
      onKeyDown={(event) => {
        const direction =
          event.key === 'ArrowLeft' || event.key === 'ArrowDown'
            ? -1
            : event.key === 'ArrowRight' || event.key === 'ArrowUp'
              ? 1
              : 0;
        if (!direction) return;
        event.preventDefault();
        const input = event.currentTarget;
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        const delta =
          horizontal && getComputedStyle(input).direction === 'rtl' ? -direction : direction;
        const next = Math.round((Number(input.value) + delta) * 10) / 10;
        moved.current = Math.min(Number(input.max), Math.max(Number(input.min), next));
        onValueChange?.(moved.current);
      }}
    />
  );
}
