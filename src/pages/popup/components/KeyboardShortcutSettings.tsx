import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  type KeyboardShortcut,
  type ModifierKey,
  type ResolvedKeyboardShortcutConfig,
  type ShortcutKey,
  keyboardShortcutBindingsEqual,
  keyboardShortcutFromEvent,
} from '@/core/types/keyboardShortcut';
import type { TranslationKey } from '@/utils/translations';

type ShortcutSlot = keyof ResolvedKeyboardShortcutConfig;

interface RecordingState {
  action: ShortcutSlot | null;
  modifiers: ModifierKey[];
  key: ShortcutKey | null;
}

/** The optional `vv` alternative to the panel's ⌥V / Alt+V, outside text fields only. */
const PANEL_VV: KeyboardShortcut = {
  action: 'panel:toggle',
  modifiers: [],
  key: 'v',
  sequenceLength: 2,
};

/** `slot` takes `nextShortcut`; a slot that already had it takes `slot`'s old binding. */
function buildUpdatedConfig(
  currentConfig: ResolvedKeyboardShortcutConfig,
  slot: ShortcutSlot,
  nextShortcut: KeyboardShortcut,
): ResolvedKeyboardShortcutConfig {
  const nextConfig: ResolvedKeyboardShortcutConfig = {
    ...currentConfig,
    [slot]: nextShortcut,
  };
  const currentShortcut = currentConfig[slot];

  (Object.keys(currentConfig) as ShortcutSlot[]).forEach((candidateAction) => {
    if (candidateAction === slot) return;
    if (!keyboardShortcutBindingsEqual(currentConfig[candidateAction], nextShortcut)) return;

    // Each slot keeps its own action: the binding moves, the action does not.
    nextConfig[candidateAction] = {
      ...currentShortcut,
      action: currentConfig[candidateAction].action,
    };
  });

  return nextConfig;
}

const TIMELINE_SLOTS = [
  { slot: 'previous', label: 'previousNode' },
  { slot: 'next', label: 'nextNode' },
  { slot: 'first', label: 'firstNode' },
  { slot: 'last', label: 'lastNode' },
] as const satisfies ReadonlyArray<{ slot: ShortcutSlot; label: TranslationKey }>;

const RECORDER_CLASS =
  'focus-visible:ring-ring/60 flex h-9 w-full items-center justify-center rounded-lg border px-3 font-mono text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none';

export function KeyboardShortcutSettings() {
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [config, setConfig] = useState<ResolvedKeyboardShortcutConfig | null>(null);
  /** The last save was refused (the key is taken); recording stays open for another key. */
  const [refused, setRefused] = useState<boolean>(false);
  const [recording, setRecording] = useState<RecordingState>({
    action: null,
    modifiers: [],
    key: null,
  });
  const [loading, setLoading] = useState<boolean>(true);

  // Use refs to avoid stale closures in event handlers
  const configRef = useRef<ResolvedKeyboardShortcutConfig | null>(null);
  const enabledRef = useRef<boolean>(true);
  const recordingRef = useRef<RecordingState>({ action: null, modifiers: [], key: null });

  // Keep refs in sync with state
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // Load configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Initialize service first to load from storage
        await keyboardShortcutService.init();

        // Then get the loaded config
        const { config: currentConfig, enabled: currentEnabled } =
          keyboardShortcutService.getConfig();
        setConfig(currentConfig);
        setEnabled(currentEnabled);
      } catch (error) {
        console.error('[KeyboardShortcut] Failed to load config:', error);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  // Toggle enabled state
  const handleToggleEnabled = useCallback(async (checked: boolean) => {
    setEnabled(checked);
    try {
      await keyboardShortcutService.setEnabled(checked);
    } catch (error) {
      console.error('[KeyboardShortcut] Failed to toggle enabled:', error);
    }
  }, []);

  // Start recording shortcut
  const startRecording = useCallback((action: ShortcutSlot) => {
    setRefused(false);
    setRecording({ action, modifiers: [], key: null });
  }, []);

  /** Saves `slot` = `nextShortcut`; a refusal keeps the editor where it was and says so. */
  const saveSlot = useCallback(
    async (slot: ShortcutSlot, nextShortcut: KeyboardShortcut): Promise<boolean> => {
      const currentConfig = configRef.current;
      if (!currentConfig) return false;
      const updatedConfig = buildUpdatedConfig(currentConfig, slot, nextShortcut);
      try {
        await keyboardShortcutService.saveConfig(updatedConfig, enabledRef.current);
        setConfig(updatedConfig);
        setRefused(false);
        return true;
      } catch (error) {
        console.error('[KeyboardShortcut] Failed to save shortcut:', error);
        setRefused(true);
        return false;
      }
    },
    [],
  );

  // Handle key press during recording
  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const currentRecording = recordingRef.current;
      const currentConfig = configRef.current;

      if (!currentRecording.action) return;

      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === 'Escape') {
        setRefused(false);
        setRecording({ action: null, modifiers: [], key: null });
        return;
      }

      // Ignore modifier keys alone (they can't be shortcuts by themselves)
      if (['Alt', 'Control', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) {
        return;
      }

      // Accept any key; the slot keeps its action and its sequence length (gg / GG).
      if (!currentConfig) return;
      const slot = currentRecording.action;
      const nextShortcut = keyboardShortcutFromEvent({
        event: e,
        action: currentConfig[slot].action,
        sequenceLength: slot === 'first' || slot === 'last' ? 2 : 1,
      });

      if (await saveSlot(slot, nextShortcut)) {
        setRecording({ action: null, modifiers: [], key: null });
      }
    },
    [saveSlot],
  );

  const handlePanelVv = useCallback(
    async (checked: boolean) => {
      await saveSlot('panelToggle', checked ? PANEL_VV : DEFAULT_KEYBOARD_SHORTCUTS.panelToggle);
    },
    [saveSlot],
  );

  // Attach/detach keydown listener
  useEffect(() => {
    if (recording.action) {
      window.addEventListener('keydown', handleKeyDown, { capture: true });
      return () => {
        window.removeEventListener('keydown', handleKeyDown, { capture: true });
      };
    }
  }, [recording.action, handleKeyDown]);

  // Reset to defaults
  const handleReset = useCallback(async () => {
    try {
      await keyboardShortcutService.resetToDefaults();
      const { config: currentConfig } = keyboardShortcutService.getConfig();
      setConfig(currentConfig);
    } catch (error) {
      console.error('[KeyboardShortcut] Failed to reset shortcuts:', error);
    }
  }, []);

  const recorder = (slot: ShortcutSlot) => (
    <button
      type="button"
      onClick={() => startRecording(slot)}
      className={`${RECORDER_CLASS} ${
        recording.action === slot
          ? 'border-primary text-primary bg-card'
          : 'border-border bg-secondary/40 text-foreground hover:bg-secondary'
      } `}
    >
      {recording.action === slot
        ? t('shortcutPressKey')
        : config
          ? keyboardShortcutService.formatShortcut(config[slot])
          : ''}
    </button>
  );

  if (loading || !config) {
    return (
      <Card className="p-4">
        <CardTitle className="mb-4">{t('keyboardShortcuts')}</CardTitle>
        <CardContent className="p-0">
          <p className="text-muted-foreground text-xs">{t('loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <CardTitle className="mb-4">{t('keyboardShortcuts')}</CardTitle>
      <CardContent className="space-y-4 p-0">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="shortcuts-enabled" className="cursor-pointer text-sm font-medium">
            {t('enableShortcuts')}
          </Label>
          <Switch
            id="shortcuts-enabled"
            checked={enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
          />
        </div>

        {/* Timeline shortcuts */}
        {enabled && (
          <div className="grid grid-cols-2 gap-3">
            {TIMELINE_SLOTS.map(({ slot, label }) => (
              <div key={slot} className="space-y-2">
                <Label className="text-muted-foreground text-xs font-medium">{t(label)}</Label>
                {recorder(slot)}
              </div>
            ))}
          </div>
        )}

        {/* The panel shortcut works whether or not the timeline shortcuts are on. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs font-medium">
              {t('shortcutPanelToggle')}
            </Label>
            {recorder('panelToggle')}
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="shortcuts-panel-vv"
              className="text-muted-foreground cursor-pointer text-xs font-medium"
            >
              {t('shortcutPanelVv')}
            </Label>
            <div className="flex h-9 items-center">
              <Switch
                id="shortcuts-panel-vv"
                checked={keyboardShortcutBindingsEqual(config.panelToggle, PANEL_VV)}
                onChange={(e) => handlePanelVv(e.target.checked)}
              />
            </div>
          </div>
        </div>

        {refused && (
          <p role="alert" className="text-destructive text-center text-xs">
            {t('shortcutInUse')}
          </p>
        )}

        {/* Hint text */}
        {recording.action && (
          <p className="text-muted-foreground text-center text-xs">{t('shortcutEscToCancel')}</p>
        )}

        {/* Reset button */}
        {enabled && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
            >
              {t('resetShortcuts')}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
