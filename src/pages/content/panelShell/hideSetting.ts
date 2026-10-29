/**
 * The floating button's hide setting (`gvHidePromptManager`, synced) as the
 * shell changes it. Bringing the ball back puts back exactly what the hide
 * replaced: the key removed when it was absent, its old value otherwise, so
 * settings backups and Chrome sync carry no value the user never chose.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

const KEY = StorageKeys.HIDE_PROMPT_MANAGER;

/** The setting as stored: absent, or the value it held. */
type Stored = { readonly present: false } | { readonly present: true; readonly value: unknown };

const ABSENT: Stored = { present: false };

export interface HideSetting {
  /** Hides the ball; the returned undo puts back what this hide replaced. */
  hide(): () => void;
  /**
   * Brings a hidden ball back, as the panel shortcut does: to what this page's
   * last hide replaced, or to the default (no key) when something else hid it.
   */
  show(): void;
}

function warn(message: string, error: unknown): void {
  if (!isExtensionContextInvalidatedError(error)) logger.warn(message, { error: String(error) });
}

async function read(): Promise<Stored> {
  const items: unknown = await chrome.storage.sync.get(KEY);
  return typeof items === 'object' && items !== null && KEY in items
    ? { present: true, value: items[KEY] }
    : ABSENT;
}

/** The ball reads only `true` as hidden. */
function hides(stored: Stored): boolean {
  return stored.present && stored.value === true;
}

export function createHideSetting(): HideSetting {
  // One step at a time, so no step reads the setting while another is changing it.
  let queue: Promise<void> = Promise.resolve();
  const step = (failure: string, run: () => Promise<void>): void => {
    queue = queue.then(run).catch((error: unknown) => warn(failure, error));
  };
  /** What this page's last hide replaced, while the ball may still be hidden by it. */
  let replaced: Stored | null = null;

  /** Puts `prior` back over the hide only: a choice made since, elsewhere, stands. */
  const putBack = async (prior: Stored): Promise<void> => {
    replaced = null;
    if (!hides(await read())) return;
    if (prior.present) await chrome.storage.sync.set({ [KEY]: prior.value });
    else await chrome.storage.sync.remove(KEY);
  };

  return {
    hide() {
      let prior: Stored | null = null;
      step('Could not hide the floating button', async () => {
        const before = await read();
        await chrome.storage.sync.set({ [KEY]: true });
        prior = before;
        if (!hides(before)) replaced = before;
      });
      return () => {
        step('Could not show the floating button again', async () => {
          if (prior) await putBack(prior);
        });
      };
    },
    show() {
      step('Could not show the floating button', async () => {
        await putBack(replaced ?? ABSENT);
      });
    },
  };
}
