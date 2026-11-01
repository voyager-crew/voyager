/**
 * The working switch a `:switch:` marker becomes in the extension's viewer: it
 * shows the setting's stored value, writes a click where the popup writes it
 * and follows changes made anywhere else while the viewer stays open.
 *
 * Every target is a legacy-bound official plugin (`switchTargets.ts`): its
 * sync key is the only authority over whether it runs, so the switch reads it
 * with the binding's `read`, writes `legacyEnableWrite` and listens to that key.
 */
import { logger } from '@/core/services/LoggerService';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import {
  legacyBindingFor,
  legacyEnableWrite,
  loadLegacySettingSnapshot,
  subscribeLegacySettings,
} from '@/features/plugins/storage/legacySettingBindings';

const CLASS = 'gv-changelog-switch';

export interface SettingSwitch {
  readonly element: HTMLButtonElement;
  /** Drops the storage listener; the viewer calls it when it closes. */
  readonly dispose: () => void;
}

export interface SettingSwitchLabels {
  /** The setting's name in the reader's language: the switch's visible and accessible name. */
  readonly name: string;
  /** What the switch does, read after its name. */
  readonly hint: string;
}

/** A switch for the legacy-bound plugin `pluginId`; `null` when it has no binding. */
export function createSettingSwitch(
  doc: Document,
  pluginId: string,
  labels: SettingSwitchLabels,
): SettingSwitch | null {
  const binding = legacyBindingFor(pluginId);
  if (!binding) return null;

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CLASS;
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', 'false');
  button.setAttribute('aria-description', labels.hint);
  button.title = labels.hint;
  // Disabled until the stored value is known, so the first click never acts on a guess.
  button.disabled = true;

  const track = doc.createElement('span');
  track.className = `${CLASS}__track`;
  track.setAttribute('aria-hidden', 'true');
  const thumb = doc.createElement('span');
  thumb.className = `${CLASS}__thumb`;
  track.appendChild(thumb);
  const name = doc.createElement('span');
  name.className = `${CLASS}__name`;
  name.textContent = labels.name;
  button.append(track, name);

  let disposed = false;
  const show = (enabled: boolean): void => {
    button.setAttribute('aria-checked', String(enabled));
  };
  const showStored = (stored: unknown): void => {
    show(binding.read(stored));
    button.disabled = false;
  };

  // A change from the popup, another tab or a synced device: a removed key arrives as
  // `undefined`, which `read` turns back into the binding's default.
  const unsubscribe = subscribeLegacySettings(
    (changed) => showStored(changed[binding.key]),
    [binding.key],
  );
  const dispose = (): void => {
    disposed = true;
    unsubscribe();
  };

  void loadLegacySettingSnapshot([binding.key])
    .then((snapshot) => {
      if (!disposed) showStored(snapshot[binding.key]);
    })
    .catch((error: unknown) => {
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('changelog switch read failed', { pluginId, error: String(error) });
      }
    });

  button.addEventListener('click', () => {
    if (button.disabled) return;
    const previous = button.getAttribute('aria-checked') === 'true';
    const next = !previous;
    show(next);
    chrome.storage.sync.set({ ...legacyEnableWrite(pluginId, next) }).catch((error: unknown) => {
      show(previous);
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('changelog switch write failed', { pluginId, error: String(error) });
      }
    });
  });

  return { element: button, dispose };
}
