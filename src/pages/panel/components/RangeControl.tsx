import React, { useEffect, useRef, useState } from 'react';

import { PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';

import type { PanelSlider } from '../features/featureRows';
import type { PanelShell } from '../hooks/panelShell';

export interface RangeControlProps {
  readonly slider: PanelSlider;
  readonly disabled: boolean;
  /** The plugin the page previews while the thumb is held; null when viewing another site. */
  readonly previewPluginId: string | null;
  readonly shell: PanelShell;
}

interface Hold {
  /** Sends the latest value to the page; null when viewing another site. */
  readonly preview: (() => void) | null;
  /** Ends the hold; only a release saves. */
  readonly finish: (save: boolean) => void;
}

/**
 * A row's slider. Held on the page's own site, each frame's value goes to the
 * shell as a live preview while the panel fades; release saves once and ends
 * the preview. Keyboard steps save each step, without a preview.
 */
export function RangeControl({ slider, disabled, previewPluginId, shell }: RangeControlProps) {
  const [draft, setDraft] = useState(slider.value);
  const latest = useRef(slider.value);
  const moved = useRef(false);
  const frame = useRef<number | null>(null);
  const hold = useRef<Hold | null>(null);
  const { min, max, value } = slider;

  // Follow storage (a restore, another window) except while the thumb is held.
  useEffect(() => {
    if (!hold.current) {
      setDraft(value);
      latest.current = value;
    }
  }, [value]);

  // Closing the panel mid-drag ends the fade and the preview without saving.
  useEffect(() => () => hold.current?.finish(false), []);

  const onPointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || event.button !== 0 || hold.current) return;
    // Fixed for this hold: a re-render while dragging changes none of them.
    const { key, commit } = slider;
    const pluginId = previewPluginId;
    const stored = value;
    const preview = pluginId
      ? () => {
          frame.current = null;
          shell.post({
            kind: PANEL_SHELL_MESSAGE.preview,
            pluginId,
            settingKey: key,
            value: latest.current,
          });
        }
      : null;
    const finish = (save: boolean) => {
      hold.current = null;
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
        // The released value reaches the page before the preview settles on it.
        if (save) preview?.();
      }
      if (pluginId) shell.post({ kind: PANEL_SHELL_MESSAGE.fade, faded: false });
      // Only a value the user moved saves: a bare click must not store the browser's snapped reading.
      if (save && moved.current && latest.current !== stored) commit(latest.current);
      else {
        latest.current = stored;
        setDraft(stored);
      }
      if (pluginId) shell.post({ kind: PANEL_SHELL_MESSAGE.previewEnd });
    };
    const release = () => finish(true);
    // A cancelled pointer, lost capture or a frame that loses focus mid-drag puts the stored value back.
    const cancel = () => finish(false);
    hold.current = { preview, finish };
    moved.current = false;
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    if (pluginId) shell.post({ kind: PANEL_SHELL_MESSAGE.fade, faded: true });
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setDraft(next);
    latest.current = next;
    const held = hold.current;
    if (held) {
      moved.current = true;
      if (held.preview && frame.current === null)
        frame.current = requestAnimationFrame(held.preview);
      return;
    }
    // A keyboard step is a finished choice.
    if (next !== value) slider.commit(next);
  };

  const fill = max > min ? ((draft - min) / (max - min)) * 100 : 0;
  const shown = slider.format(draft);
  return (
    <>
      <input
        className="rng"
        type="range"
        min={min}
        max={max}
        step={slider.step}
        value={draft}
        disabled={disabled}
        aria-label={slider.label}
        aria-valuetext={shown}
        style={{ '--p': `${fill}%` } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onLostPointerCapture={() => hold.current?.finish(false)}
        onChange={onChange}
      />
      <span className="val">{shown}</span>
    </>
  );
}
