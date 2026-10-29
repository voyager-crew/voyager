/**
 * Live preview from the panel's sliders to the page: at most one value per
 * animation frame reaches PluginHost, page transitions stay off while a
 * slider is held, and nothing is ever written to storage here (the panel
 * saves on release; the stored value then arrives the normal way).
 */
import type { PanelSettingValue } from '@/features/panel/protocol';
import { settingsPreview } from '@/features/plugins/runtime/settingsPreview';

/** On `<html>` while a slider is held: the stylesheet turns the page's transitions off. */
export const LIVE_CLASS = 'gv-ps-live';

interface PendingValue {
  readonly pluginId: string;
  readonly settingKey: string;
  readonly value: PanelSettingValue;
}

export interface PreviewRelay {
  push(value: PendingValue): void;
  /** `settle` keeps the last value until the save lands; `now` drops it at once. */
  end(how: 'settle' | 'now'): void;
}

export function createPreviewRelay(): PreviewRelay {
  let pending: PendingValue | null = null;
  let frame: number | null = null;

  const flush = (): void => {
    frame = null;
    const next = pending;
    pending = null;
    if (next) settingsPreview.set(next.pluginId, next.settingKey, next.value);
  };

  const cancelFrame = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  return {
    push(value) {
      pending = value;
      document.documentElement.classList.add(LIVE_CLASS);
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    end(how) {
      cancelFrame();
      // The release value must land before the preview starts settling on it.
      if (how === 'settle') flush();
      pending = null;
      document.documentElement.classList.remove(LIVE_CLASS);
      settingsPreview.end(how);
    },
  };
}
