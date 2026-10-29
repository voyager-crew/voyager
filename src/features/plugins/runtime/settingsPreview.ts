/**
 * The setting the Voyager panel previews while one of its sliders is held:
 * laid over the settings PluginHost resolved for that plugin, and never
 * written to storage. Ending the preview gives the page its stored value back.
 *
 * The panel saves on release, so ending with `settle` keeps the last value
 * until the stored settings catch up with it (or `SETTLE_MS` passes): the page
 * must not flash back to the old value while the save is on its way. Ending
 * with `now` (the panel closed, its frame went away) drops it at once.
 */
import { hasEnableBinding } from '../storage/legacySettingBindings';
import { acceptsLegacyLiveChange, legacyValueWrite } from '../storage/legacyValueBindings';
import type { PluginManifest, PluginSettingValue, PluginSettings } from '../types';

const SETTLE_MS = 800;

interface Preview {
  readonly pluginId: string;
  readonly settingKey: string;
  readonly value: PluginSettingValue;
  readonly settling: boolean;
}

export interface SettingsPreview {
  /** Show `value` for one setting until the preview ends; a later call replaces it. */
  set(pluginId: string, settingKey: string, value: PluginSettingValue): void;
  end(how: 'settle' | 'now'): void;
  /** `resolved` with the preview laid over it, checked the way the plugin reads that setting. */
  apply(manifest: PluginManifest, resolved: PluginSettings): PluginSettings;
  /** Runs whenever the settings `apply` returns may have changed. Returns the cleanup. */
  subscribe(listener: () => void): () => void;
}

/** The value `manifest` would run with for `key`, or undefined when it takes none from a preview. */
function checkedValue(
  manifest: PluginManifest,
  key: string,
  value: PluginSettingValue,
): PluginSettingValue | undefined {
  // A bound official plugin reads its legacy key, in the form its native module stores,
  // and ignores a value its live listener would ignore.
  if (hasEnableBinding(manifest.id)) {
    const [entry] = Object.entries(legacyValueWrite(manifest.id, key, value) ?? {});
    if (!entry || !acceptsLegacyLiveChange(entry[0], value)) return undefined;
    const stored = entry[1];
    return typeof stored === 'number' || typeof stored === 'boolean' || typeof stored === 'string'
      ? stored
      : undefined;
  }
  const field = manifest.contributes.settings?.[key];
  if (!field) return undefined;
  switch (field.type) {
    case 'number':
      return typeof value === 'number'
        ? Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value))
        : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'select':
      return field.options?.some((option) => option.value === value) ? value : undefined;
    case 'string':
    case 'color':
      return typeof value === 'string' ? value : undefined;
    default: {
      const exhaustive: never = field.type;
      return exhaustive;
    }
  }
}

export function createSettingsPreview(): SettingsPreview {
  let preview: Preview | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };
  const clearSettle = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  const drop = (): void => {
    clearSettle();
    preview = null;
    notify();
  };

  return {
    set(pluginId, settingKey, value) {
      clearSettle();
      const same =
        preview?.pluginId === pluginId &&
        preview.settingKey === settingKey &&
        preview.value === value &&
        !preview.settling;
      if (same) return;
      preview = { pluginId, settingKey, value, settling: false };
      notify();
    },
    end(how) {
      if (!preview) return;
      if (how === 'now') {
        drop();
        return;
      }
      if (preview.settling) return;
      preview = { ...preview, settling: true };
      settleTimer = setTimeout(drop, SETTLE_MS);
    },
    apply(manifest, resolved) {
      const current = preview;
      if (!current || current.pluginId !== manifest.id) return resolved;
      const value = checkedValue(manifest, current.settingKey, current.value);
      if (value === undefined) return resolved;
      if (current.settling && resolved[current.settingKey] === value) {
        // The save arrived: the stored value is the previewed one now.
        clearSettle();
        preview = null;
        return resolved;
      }
      return { ...resolved, [current.settingKey]: value };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's one preview: the panel shell feeds it, PluginHost lays it over what it runs. */
export const settingsPreview = createSettingsPreview();
