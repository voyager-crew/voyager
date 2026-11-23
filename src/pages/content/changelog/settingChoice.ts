/**
 * The working control a `:choice:` marker becomes in the extension's viewer: a
 * native select for a `select` setting, the changelog switch for a `boolean`.
 * It shows the stored value, writes a change where the popup and the in-page
 * panel write it and follows changes made anywhere else while the viewer stays
 * open.
 *
 * Every target is a legacy-bound official plugin (`switchTargets.ts`), so the
 * value lives on its legacy value key: read with the binding's `read`, written
 * with `legacyValueWrite`, never through `gvPluginsState`. While the plugin is
 * off the control is disabled with a hint, and it comes back the moment the
 * plugin's own key turns on, from this note's switch or anywhere else.
 */
import { logger } from '@/core/services/LoggerService';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import {
  legacyBindingFor,
  loadLegacySettingSnapshot,
  subscribeLegacySettings,
} from '@/features/plugins/storage/legacySettingBindings';
import {
  legacyValueBindingsFor,
  legacyValueWrite,
} from '@/features/plugins/storage/legacyValueBindings';
import type { PluginSettingValue } from '@/features/plugins/types';

import { createSwitchButton } from './settingSwitch';
import type { ChoiceTarget } from './switchTargets';

const CLASS = 'gv-changelog-choice';

export interface SettingChoiceLabels {
  /** The setting's label in the reader's language. */
  readonly name: string;
  /** A `select` setting's options in the reader's language. */
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** Shown while the plugin is off: turn it on first. */
  readonly offHint: string;
}

export interface SettingChoice {
  readonly element: HTMLElement;
  /** Drops the storage listener; the viewer calls it when it closes. */
  readonly dispose: () => void;
}

/** The control for listed choice `choice`; `null` when the plugin has no enable or value binding. */
export function createSettingChoice(
  doc: Document,
  choice: ChoiceTarget,
  labels: SettingChoiceLabels,
): SettingChoice | null {
  const pluginId = choice.target.manifest.id;
  const enable = legacyBindingFor(pluginId);
  const value = legacyValueBindingsFor(pluginId).find((entry) => entry.settingKey === choice.key);
  if (!enable || !value) return null;
  const keys = [enable.key, value.legacyKey, ...(value.additionalKeys ?? [])];

  const root = doc.createElement('span');
  root.className = CLASS;
  const hint = doc.createElement('span');
  hint.className = `${CLASS}__hint`;
  hint.textContent = labels.offHint;
  hint.hidden = true;

  let control: HTMLButtonElement | HTMLSelectElement;
  if (choice.field.type === 'boolean') {
    control = createSwitchButton(doc, labels.name);
    root.append(control, hint);
  } else {
    const field = doc.createElement('label');
    field.className = `${CLASS}__field`;
    const name = doc.createElement('span');
    name.className = `${CLASS}__name`;
    name.textContent = labels.name;
    const select = doc.createElement('select');
    select.className = `${CLASS}__select`;
    for (const option of labels.options) {
      const element = doc.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    }
    // Disabled until the stored value is known, so the first change never acts on a guess.
    select.disabled = true;
    control = select;
    field.append(name, select);
    root.append(field, hint);
  }

  let snapshot: Record<string, unknown> = {};
  let loaded = false;
  let disposed = false;

  const current = (): PluginSettingValue => value.read(snapshot[value.legacyKey], snapshot);
  const render = (): void => {
    const on = enable.read(snapshot[enable.key]);
    if (control instanceof HTMLSelectElement) control.value = String(current());
    else control.setAttribute('aria-checked', String(current() === true));
    control.disabled = !loaded || !on;
    const off = loaded && !on;
    hint.hidden = !off;
    root.classList.toggle(`${CLASS}--off`, off);
    if (off) control.setAttribute('aria-description', labels.offHint);
    else control.removeAttribute('aria-description');
  };

  // A change from the popup, the panel, another tab or a synced device. A value
  // change the feature itself would ignore keeps the last one, as its runtime does.
  const unsubscribe = subscribeLegacySettings((changed) => {
    for (const [key, next] of Object.entries(changed)) {
      if (key === value.legacyKey && !value.acceptsLiveChange(next)) continue;
      snapshot[key] = next;
    }
    render();
  }, keys);
  const dispose = (): void => {
    disposed = true;
    unsubscribe();
  };

  void loadLegacySettingSnapshot(keys)
    .then((stored) => {
      if (disposed) return;
      // A live change that arrived during the read is newer than it.
      snapshot = { ...stored, ...snapshot };
      loaded = true;
      render();
    })
    .catch((error: unknown) => {
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('changelog choice read failed', { pluginId, error: String(error) });
      }
    });

  const commit = (next: PluginSettingValue): void => {
    const write = legacyValueWrite(pluginId, choice.key, next);
    if (!write) return;
    const previous = snapshot[value.legacyKey];
    snapshot = { ...snapshot, ...write };
    render();
    chrome.storage.sync.set({ ...write }).catch((error: unknown) => {
      snapshot = { ...snapshot, [value.legacyKey]: previous };
      render();
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('changelog choice write failed', { pluginId, error: String(error) });
      }
    });
  };

  if (control instanceof HTMLSelectElement) {
    const select = control;
    select.addEventListener('change', () => {
      if (!select.disabled) commit(select.value);
    });
  } else {
    const button = control;
    button.addEventListener('click', () => {
      if (!button.disabled) commit(button.getAttribute('aria-checked') !== 'true');
    });
  }

  return { element: root, dispose };
}
