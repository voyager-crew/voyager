/**
 * Prompt Manager's hold on the floating ball (`promptBall.ts`), which it shares
 * with the panel shell: the ball opens the Prompt Manager while Prompt Manager
 * holds it, and the shell keeps it on pages where Prompt Manager is off.
 *
 * Visibility follows one rule: the ball is hidden only when the user hid it
 * and there is no announcement to show. While an announcement is active, a
 * click opens the release notes instead of the panel.
 */
import type { PromptTriggerSpot } from '@/features/prompt/PromptSiteAdapter';

import { type BallLease, promptBall } from './promptBall';

export interface PromptTrigger {
  readonly element: HTMLButtonElement;
  /** True while the ball announces unread release notes. */
  readonly hasAttention: boolean;
  /**
   * Starts answering clicks and drags. Until then the ball is visible but
   * inert, so it cannot open a panel that is still being built. `open` opens
   * the panel without toggling it, for the slash menu's entry.
   */
  enable: (onActivate: () => void, open?: () => void) => void;
  /**
   * Drops the announcement and opens the release notes it announced.
   * Resolves to whether they opened; rejects when opening threw. Either way
   * the visibility rule is applied once opening has settled.
   */
  consumeAttention: () => Promise<boolean>;
  /** Pulls the ball back inside a viewport that shrank. */
  constrain: () => void;
  /** Records the user's hide setting. Returns true when the ball is now hidden. */
  setHiddenByUser: (hidden: boolean) => boolean;
  /** Follows logo and release-notes notification changes from storage. */
  applyStorageChange: BallLease['applyStorageChange'];
  /** Lets go of the ball; it leaves the page once no one else holds it. */
  destroy: () => void;
}

export interface PromptTriggerOptions {
  /** Accessible name; the Prompt Manager relabels `element` when the language changes. */
  label: string;
  mascotLogo: boolean;
  hiddenByUser: boolean;
  attention: boolean;
  /** Mirrors the announcement onto other surfaces (the panel's version badge). */
  onAttentionChange: (active: boolean) => void;
  /** The hide setting hid or showed the ball; the ball follows that setting itself. */
  onHiddenChange?: (hidden: boolean) => void;
  /** Where the ball sits until the user drags it; null keeps the stylesheet's corner. */
  defaultSpot: (ballHeight: number) => PromptTriggerSpot | null;
}

/**
 * Holds the page's ball (adding it, placed, when no one holds it yet) and labels it.
 * Throws when another script's ball is on the page.
 */
export async function mountPromptTrigger(options: PromptTriggerOptions): Promise<PromptTrigger> {
  const { label, mascotLogo, hiddenByUser, attention, defaultSpot } = options;
  const lease = await promptBall.acquire(
    {
      id: 'prompt-manager',
      onAttentionChange: options.onAttentionChange,
      onHiddenChange: options.onHiddenChange,
    },
    () => ({ label, mascotLogo, hiddenByUser, attention, defaultSpot }),
  );
  if (!lease) throw new Error('Another floating ball is already on the page');
  // Joining a ball the panel shell added: the click now opens the Prompt Manager.
  lease.element.setAttribute('aria-label', label);

  let enabled = false;
  return {
    element: lease.element,
    get hasAttention() {
      return lease.hasAttention;
    },
    enable: (onActivate, open) => {
      if (enabled) return;
      enabled = true;
      lease.setActivate(onActivate, open);
    },
    consumeAttention: () => lease.consumeAttention(),
    constrain: () => lease.constrain(),
    setHiddenByUser: (hidden) => lease.setHiddenByUser(hidden),
    applyStorageChange: (area, changes) => lease.applyStorageChange(area, changes),
    destroy: () => lease.release(),
  };
}
