import { useMemo } from 'react';

import { isFirefox } from '@/core/utils/browser';
import { normalizeCustomWebsite } from '@/core/utils/customWebsites';
import { promptCoverageBindingForUrl } from '@/features/plugins/storage/promptCoverageBinding';
import type { TranslationKey } from '@/utils/translations';

import { holdsOrigin, pageOrigin } from '../utils/sitePermissions';
import type { CoverageRefusal, useCustomWebsites } from './useCustomWebsites';
import type { UndoOffer, WithdrawUndoOffer } from './useUndoToast';

/** Prompt Manager's switch on a supported site: its catalog plugin's row, bound to the page host's coverage. */
export interface PromptSwitch {
  readonly pluginId: string;
  readonly enabled: boolean;
  /** Called from the switch's click: Firefox asks for access only inside the gesture. */
  readonly setEnabled: (enabled: boolean) => Promise<CoverageRefusal | null>;
}

/** The switch's element, where focus returns after its undo offer. */
export const PROMPT_SWITCH_ID = 'prompt-manager-site-enabled';

export interface PromptSwitchOptions {
  readonly activeUrl: string;
  readonly coverage: Pick<
    ReturnType<typeof useCustomWebsites>,
    'customWebsites' | 'setPromptCoverage' | 'restoreEntries'
  >;
  /** The page's own origin is granted, looked up before the click for Firefox. */
  readonly pageGranted: boolean | null;
  /** The plugin's name, for the undo offer. */
  readonly name: string;
  readonly t: (key: TranslationKey) => string;
  readonly onUndoOffer: (offer: UndoOffer) => WithdrawUndoOffer;
  /** Called once a switch has settled, so the site's access shows it. */
  readonly onSettled: () => void;
}

/**
 * The switch reads and writes coverage through the binding of the open page's
 * host. On, it reuses a grant the page already has (a plugin's), or else asks
 * for the host's coverage access, the grant Prompt Manager's own registration
 * runs on. Off removes every entry covering the host; when that took a parent
 * domain's entry (`deepseek.com` on `chat.deepseek.com`), turning on again
 * would not bring it back, so an undo restores exactly what was removed.
 */
export function usePromptSwitch({
  activeUrl,
  coverage,
  pageGranted,
  name,
  t,
  onUndoOffer,
  onSettled,
}: PromptSwitchOptions): PromptSwitch | null {
  const binding = useMemo(() => promptCoverageBindingForUrl(activeUrl), [activeUrl]);
  const { customWebsites, setPromptCoverage, restoreEntries } = coverage;
  return useMemo((): PromptSwitch | null => {
    if (!binding) return null;
    const own = normalizeCustomWebsite(binding.host);
    return {
      pluginId: binding.pluginId,
      enabled: binding.read(customWebsites),
      setEnabled: async (enabled) => {
        const origin = pageOrigin(activeUrl);
        // Firefox keeps the gesture only for a request made before any other await.
        const reachable =
          enabled &&
          origin !== null &&
          (isFirefox() ? pageGranted === true : await holdsOrigin(origin));
        const { refusal, removed } = await setPromptCoverage(binding, enabled, reachable);
        if (removed.some(({ entry }) => entry !== own)) {
          onUndoOffer({
            message: t('pluginToggleToastOff').replace('{name}', () => name),
            undo: () => void restoreEntries(removed).then(onSettled),
            returnFocus: () => document.getElementById(PROMPT_SWITCH_ID),
          });
        }
        onSettled();
        return refusal;
      },
    };
  }, [
    activeUrl,
    binding,
    customWebsites,
    name,
    onSettled,
    onUndoOffer,
    pageGranted,
    restoreEntries,
    setPromptCoverage,
    t,
  ]);
}
